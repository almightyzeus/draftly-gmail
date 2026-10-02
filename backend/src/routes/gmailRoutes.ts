import { Router } from 'express';
import {
  getOAuthUrl,
  handleOAuthCallback,
  revokeOAuth,
  fetchEmails,
  getEmail,
} from '../controllers/gmailController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/gmail/oauth/url
 * Returns { url } for the Google OAuth consent screen (Bearer auth; the
 * frontend navigates to it)
 */
router.get('/oauth/url', authenticateJWT, getOAuthUrl);

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
 * Fetch one page of emails from Gmail
 * Query params: q (Gmail search syntax), pageToken, limit, label, unread
 * Response: { emails, nextPageToken }
 */
router.get('/emails', authenticateJWT, fetchEmails);

/**
 * GET /api/gmail/emails/:gmailMessageId
 * Get a single email
 */
router.get('/emails/:gmailMessageId', authenticateJWT, getEmail);

export default router;
