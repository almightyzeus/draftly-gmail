import { google } from 'googleapis';
import { Types } from 'mongoose';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { createOAuth2Client, oauth2Client } from './googleClient.js';
import {GmailAccount} from '../models/GmailAccount.js';
import { User } from '../models/User.js';
import { CryptoService } from './cryptoService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface OAuthStatePayload extends JwtPayload {
  userId: string;
  type: 'gmail_oauth';
}

export class GmailOAuthService {
  /**
   * Persist refreshed tokens to the database
   * Called after Google OAuth2 client auto-refreshes an access token
   */
  private static async persistRefreshedTokens(
    userId: string,
    gmailEmail: string,
    accessToken: string,
    refreshToken: string | undefined,
    expiryDate: number | null | undefined
  ): Promise<void> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const account = await GmailAccount.findOne({ userId: userObjectId, gmailEmail });

      if (!account) {
        logger.warn(`Cannot persist refreshed tokens: GmailAccount not found for user ${userId}, email ${gmailEmail}`);
        return;
      }

      // Only update if values have changed
      const accessTokenEnc = CryptoService.encryptToken(accessToken);
      const updates: any = {
        accessTokenEnc,
      };

      // Only update refresh token if Google provided a new one
      if (refreshToken) {
        updates.refreshTokenEnc = CryptoService.encryptToken(refreshToken);
      }

      // Only update expiry if it's provided
      if (expiryDate) {
        updates.tokenExpiry = new Date(expiryDate);
      }

      await GmailAccount.findOneAndUpdate(
        { userId: userObjectId, gmailEmail },
        updates,
        { new: true }
      );

      logger.info(`Refreshed tokens persisted for user ${userId}, email ${gmailEmail}`);
    } catch (error) {
      // Log error but don't throw - token refresh succeeded, only persistence failed
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to persist refreshed tokens for user ${userId}`
      );
    }
  }

  /**
   * Generate a signed, short-lived OAuth state token
   * The state token contains the user ID and expires in 10 minutes
   */
  static generateOAuthStateToken(userId: string): string {
    const payload: OAuthStatePayload = {
      userId,
      type: 'gmail_oauth',
    };

    return jwt.sign(payload, env.jwt.accessSecret, {
      expiresIn: '10m',
      algorithm: 'HS256',
    });
  }

  /**
   * Verify and extract userId from OAuth state token
   * Throws if token is invalid, expired, malformed, or missing
   */
  static verifyOAuthStateToken(state: string | undefined): string {
    if (!state) {
      throw new Error('Missing OAuth state parameter');
    }

    try {
      const decoded = jwt.verify(state, env.jwt.accessSecret, {
        algorithms: ['HS256'],
      }) as OAuthStatePayload;

      if (decoded.type !== 'gmail_oauth') {
        throw new Error('Invalid state token type');
      }

      return decoded.userId;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('OAuth state token has expired. Please try connecting Gmail again.');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid or tampered OAuth state parameter');
      }
      throw error;
    }
  }

  /**
   * Generate Google OAuth authorization URL with signed state and email hint
   */
  static generateAuthUrl(userId: string, userEmail: string): string {
    const stateToken = this.generateOAuthStateToken(userId);
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      prompt: 'consent', // Force refresh token
      state: stateToken, // Pass signed state token instead of raw userId
      login_hint: userEmail, // Pre-fill email on consent screen
    });
  }

  /**
   * Handle OAuth callback and save tokens
   * Verifies the state token before processing the authorization code
   */
  static async handleCallback(code: string, state: string): Promise<void> {
    // Verify state token and extract userId
    const userId = this.verifyOAuthStateToken(state);
    try {
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Missing access_token or refresh_token');
      }

      // Get Gmail email
      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const gmailEmail = profile.data.emailAddress;

      // Encrypt tokens
      const accessTokenEnc = CryptoService.encryptToken(tokens.access_token);
      const refreshTokenEnc = CryptoService.encryptToken(tokens.refresh_token);

      // Save or update in DB
      const userObjectId = new Types.ObjectId(userId);
      await GmailAccount.findOneAndUpdate(
        { userId: userObjectId, gmailEmail },
        {
          userId: userObjectId,
          accessTokenEnc,
          revokedAt: null, // Clear revokedAt if reconnecting
          refreshTokenEnc,
          tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600000),
          scopes: tokens.scope?.split(' ') || [],
        },
        { upsert: true, new: true }
      );

      // Update User model - set googleConnected flag and gmailEmail
      await User.findByIdAndUpdate(
        userObjectId,
        {
          googleConnected: true,
          gmailEmail: gmailEmail,
        },
        { new: true }
      );

      logger.info(`Gmail account connected for user ${userId} with email ${gmailEmail}`);
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth callback error');
      throw error;
    }
  }

  /**
   * Get and refresh tokens for user
   * Sets up a token refresh listener that persists refreshed credentials after Google's API call.
   * Note: If the returned tokens are used by the caller to create a different OAuth2 client,
   * the persistence will not be triggered. For Gmail operations, use gmailService.getGmailClient()
   * which properly sets up the listener before making API calls.
   */
  static async getValidTokens(userId: string): Promise<{ access_token: string; refresh_token: string }> {
    const userObjectId = new Types.ObjectId(userId);
    const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });

    if (!account) {
      throw new Error('Gmail account not connected');
    }

    const accessToken = CryptoService.decryptToken(account.accessTokenEnc);
    const refreshToken = CryptoService.decryptToken(account.refreshTokenEnc);

    // Create a fresh OAuth2 client for this user to avoid credential mixing
    const userClient = createOAuth2Client();
    
    // Set up listener for token refresh events (fired AFTER Google's API call)
    // This listener will only fire if the caller makes API calls using this same OAuth2 client
    userClient.on('tokens', async (tokens: any) => {
      try {
        await this.persistRefreshedTokens(
          userId,
          account.gmailEmail,
          tokens.access_token,
          tokens.refresh_token,
          tokens.expiry_date
        );
      } catch (error) {
        // Log but don't throw - we don't want to break the caller's operation
        logger.error(
          error instanceof Error ? error : new Error(String(error)),
          `Failed to persist refreshed tokens in token event listener for user ${userId}`
        );
      }
    });
    
    userClient.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiry.getTime(),
    });

    // Return the tokens from the client (these may have been refreshed by the listener)
    return { 
      access_token: userClient.credentials.access_token || accessToken, 
      refresh_token: userClient.credentials.refresh_token || refreshToken 
    };
  }

  /**
   * Revoke Gmail account access
   * Calls Google's token revocation endpoint, then marks the account as revoked locally
   * Throws if Google revocation fails with a transient error
   */
  static async revoke(userId: string): Promise<void> {
    const userObjectId = new Types.ObjectId(userId);
    const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });

    if (!account) {
      // No active account to revoke
      logger.info(`No active Gmail account found for user ${userId} to revoke`);
      return;
    }

    try {
      // Decrypt the refresh token
      const refreshToken = CryptoService.decryptToken(account.refreshTokenEnc);

      // Create a fresh OAuth2 client for this revocation
      const userClient = createOAuth2Client();
      userClient.setCredentials({
        refresh_token: refreshToken,
      });

      // Call Google's revoke endpoint with the refresh token
      // This revokes all access and refresh tokens for this application
      try {
        await userClient.revokeToken(refreshToken);
        logger.info(`Successfully revoked refresh token for user ${userId}`);
      } catch (revokeError: any) {
        // Check if the error is because the token is already invalid/revoked
        // Google returns 400 with error_description containing "invalid_grant" for already-revoked tokens
        const isAlreadyRevoked = 
          revokeError.status === 400 || 
          revokeError.message?.includes('invalid_grant') ||
          revokeError.message?.includes('Token has been revoked');
        
        if (isAlreadyRevoked) {
          logger.info(`Token already revoked for user ${userId}, proceeding with cleanup`);
        } else {
          // Unexpected error - propagate it
          throw revokeError;
        }
      }

      // Mark account as revoked in database
      account.revokedAt = new Date();
      await account.save();

      // Update User model - set googleConnected to false and clear gmailEmail
      await User.findByIdAndUpdate(
        userObjectId,
        {
          googleConnected: false,
          gmailEmail: null,
        },
        { new: true }
      );

      logger.info(`Gmail account revoked for user ${userId}`);
    } catch (error) {
      // Don't silently fail - propagate errors so user knows revocation didn't complete
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to revoke Gmail account for user ${userId}`
      );
      throw error;
    }
  }
}
