import { Router } from 'express';
import { GmailOAuthService } from '../services/gmailOAuthService.js';
import { GmailService } from '../services/gmailService.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
const router = Router();
/**
 * GET /api/gmail/oauth/connect
 * Redirects user to Google OAuth consent screen
 */
router.get('/oauth/connect', authenticateJWT, (req, res) => {
    try {
        const userId = req.userId;
        const userEmail = req.email;
        const url = GmailOAuthService.generateAuthUrl(userId, userEmail);
        res.redirect(url);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth connect error');
        res.status(500).json({ error: 'Failed to generate auth URL' });
    }
});
/**
 * GET /api/gmail/oauth/callback
 * Handles OAuth callback from Google
 * Note: No auth middleware - userId comes from state parameter
 */
router.get('/oauth/callback', async (req, res, next) => {
    try {
        const code = req.query.code;
        const userId = req.query.state;
        if (!code) {
            return res.status(400).json({ error: 'Missing authorization code' });
        }
        if (!userId) {
            return res.status(400).json({ error: 'User ID missing in state' });
        }
        await GmailOAuthService.handleCallback(code, userId);
        // Redirect to dashboard
        res.redirect('http://localhost:4200/dashboard');
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth callback error');
        res.redirect('http://localhost:4200/login?error=gmail_connection_failed');
    }
});
/**
 * POST /api/gmail/oauth/revoke
 * Revoke Gmail account access
 */
router.post('/oauth/revoke', authenticateJWT, async (req, res, next) => {
    try {
        const userId = req.userId;
        await GmailOAuthService.revoke(userId);
        res.json({ message: 'Gmail account revoked' });
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Revoke error');
        res.status(500).json({ error: 'Failed to revoke account' });
    }
});
/**
 * GET /api/gmail/emails
 * Fetch emails from Gmail
 * Query params: label, unread, limit
 */
router.get('/emails', authenticateJWT, async (req, res, next) => {
    try {
        const userId = req.userId;
        const { label = 'INBOX', unread, limit = 20 } = req.query;
        const options = {
            label: label,
            unread: unread === 'true',
            limit: parseInt(limit) || 20,
        };
        const emails = await GmailService.fetchEmails(userId, options);
        res.json(emails);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to fetch emails');
        res.status(500).json({ error: 'Failed to fetch emails' });
    }
});
/**
 * GET /api/gmail/emails/:gmailMessageId
 * Get a single email
 */
router.get('/emails/:gmailMessageId', authenticateJWT, async (req, res, next) => {
    try {
        const userId = req.userId;
        const gmailMessageId = req.params.gmailMessageId;
        const email = await GmailService.getEmail(userId, gmailMessageId);
        res.json(email);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to get email');
        res.status(500).json({ error: 'Failed to get email' });
    }
});
export default router;
