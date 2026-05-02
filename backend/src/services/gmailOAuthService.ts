import { google } from 'googleapis';
import { Types } from 'mongoose';
import { oauth2Client } from './googleClient.js';
import {GmailAccount} from '../models/GmailAccount.js';
import { User } from '../models/User.js';
import { CryptoService } from './cryptoService.js';
import { logger } from '../utils/logger.js';

export class GmailOAuthService {
  /**
   * Generate Google OAuth authorization URL with user ID in state and email hint
   */
  static generateAuthUrl(userId: string, userEmail: string): string {
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      prompt: 'consent', // Force refresh token
      state: userId, // Pass userId via state parameter
      login_hint: userEmail, // Pre-fill email on consent screen
    });
  }

  /**
   * Handle OAuth callback and save tokens
   */
  static async handleCallback(code: string, userId: string): Promise<void> {
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
