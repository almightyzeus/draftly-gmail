import { Response, NextFunction } from 'express';
import { GmailOAuthService } from '../services/gmailOAuthService.js';
import { GmailService } from '../services/gmailService.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Redirect user to Google OAuth consent screen
 */
export const connectOAuth = (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const userEmail = req.email;
    const url = GmailOAuthService.generateAuthUrl(userId, userEmail);
    res.redirect(url);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Handle OAuth callback from Google
 * Verifies the state parameter to ensure secure user identification
 */
export const handleOAuthCallback = async (req: any, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Verify state token and extract userId
    let userId: string;
    try {
      userId = GmailOAuthService.verifyOAuthStateToken(state);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid OAuth state';
      logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth state verification failed');
      return res.redirect(`${env.frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`);
    }

    await GmailOAuthService.handleCallback(code, state);

    // Redirect to dashboard using configured FRONTEND_URL
    res.redirect(`${env.frontendUrl}/dashboard`);
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth callback error');
    res.redirect(`${env.frontendUrl}/login?error=${encodeURIComponent('gmail_connection_failed')}`);
  }
};

/**
 * Revoke Gmail account access
 */
export const revokeOAuth = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    await GmailOAuthService.revoke(userId);
    res.json({ message: 'Gmail account revoked' });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Fetch emails from Gmail
 * Query params: label, unread, limit
 */
export const fetchEmails = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { label = 'INBOX', unread, limit = 20 } = req.query;

    const options = {
      label: label as string,
      unread: unread === 'true',
      limit: parseInt(limit as string) || 20,
    };

    const emails = await GmailService.fetchEmails(userId, options);
    res.json(emails);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Get a single email
 */
export const getEmail = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const gmailMessageId = req.params.gmailMessageId as string;

    const email = await GmailService.getEmail(userId, gmailMessageId);
    res.json(email);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Generic error handler for gmail controller
 */
function handleError(error: any, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
  } else {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Gmail controller error');
    res.status(500).json({ error: 'Failed to process Gmail request' });
  }
}
