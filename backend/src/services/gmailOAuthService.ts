import { google } from 'googleapis';
import { Types } from 'mongoose';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { oauth2Client } from './googleClient.js';
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
   */
  static async getValidTokens(userId: string): Promise<{ access_token: string; refresh_token: string }> {
    const userObjectId = new Types.ObjectId(userId);
    const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });

    if (!account) {
      throw new Error('Gmail account not connected');
    }

    const accessToken = CryptoService.decryptToken(account.accessTokenEnc);
    const refreshToken = CryptoService.decryptToken(account.refreshTokenEnc);

    // Set credentials for potential refresh
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiry.getTime(),
    });

    // Google client auto-refreshes if needed
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  /**
   * Revoke Gmail account access
   */
  static async revoke(userId: string): Promise<void> {
    const userObjectId = new Types.ObjectId(userId);
    const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });

    if (account) {
      account.revokedAt = new Date();
      await account.save();

      // Update User model - set googleConnected to false
      await User.findByIdAndUpdate(
        userObjectId,
        {
          googleConnected: false,
          gmailEmail: null,
        },
        { new: true }
      );

      logger.info(`Gmail account revoked for user ${userId}`);
    }
  }
}
