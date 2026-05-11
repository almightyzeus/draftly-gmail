import { Response, NextFunction } from 'express';
import { GmailOAuthService } from '../services/gmailOAuthService.js';
import { GmailService } from '../services/gmailService.js';
import { AppError } from '../utils/errors.js';
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
 * Note: No auth middleware - userId comes from state parameter
 */
export const handleOAuthCallback = async (req: any, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    const userId = req.query.state as string;

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID missing in state' });
    }

    await GmailOAuthService.handleCallback(code, userId);

    // Redirect to dashboard
    res.redirect('http://localhost:4200/dashboard');
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth callback error');
    res.redirect('http://localhost:4200/login?error=gmail_connection_failed');
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
