import { Router, Request, Response, NextFunction } from 'express';
import { GmailOAuthService } from '../services/gmailOAuthService.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/gmail/oauth/connect
 * Redirects user to Google OAuth consent screen
 */
router.get('/oauth/connect', authenticateJWT, (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const userEmail = (req as any).email;
    const url = GmailOAuthService.generateAuthUrl(userId, userEmail);
    res.redirect(url);
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth connect error');
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * GET /api/gmail/oauth/callback
 * Handles OAuth callback from Google
 * Note: No auth middleware - userId comes from state parameter
 */
router.get('/oauth/callback', async (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * POST /api/gmail/oauth/revoke
 * Revoke Gmail account access
 */
router.post('/oauth/revoke', authenticateJWT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    await GmailOAuthService.revoke(userId);
    res.json({ message: 'Gmail account revoked' });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Revoke error');
    res.status(500).json({ error: 'Failed to revoke account' });
  }
});

export default router;
