import { Router } from 'express';
import {
  connectOAuth,
  handleOAuthCallback,
  revokeOAuth,
  fetchEmails,
  getEmail,
} from '../controllers/gmailController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/gmail/oauth/connect
 * Redirects user to Google OAuth consent screen
 */
router.get('/oauth/connect', authenticateJWT, connectOAuth);

/**
 * GET /api/gmail/oauth/callback
 * Handles OAuth callback from Google
 * Note: No auth middleware - userId comes from state parameter
 */
router.get('/oauth/callback', handleOAuthCallback);

/**
 * POST /api/gmail/oauth/revoke
 * Revoke Gmail account access
 */
router.post('/oauth/revoke', authenticateJWT, revokeOAuth);

/**
 * GET /api/gmail/emails
 * Fetch emails from Gmail
 * Query params: label, unread, limit
 */
router.get('/emails', authenticateJWT, fetchEmails);

/**
 * GET /api/gmail/emails/:gmailMessageId
 * Get a single email
 */
router.get('/emails/:gmailMessageId', authenticateJWT, getEmail);

export default router;
