import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  generateDraft,
  getAllDrafts,
  getDraftById,
  updateDraft,
  approveDraft,
  rejectDraft,
  sendDraft,
} from '../controllers/draftController.js';
import { authenticateJWT, AuthRequest } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();

/**
 * Each generation is a paid OpenAI call: cap it per user (not per IP), so one
 * account cannot run up cost or exhaust the API quota.
 */
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).userId ?? 'anonymous',
  skip: () => env.nodeEnv === 'test',
  message: { error: 'Too many draft generations. Please wait a minute and try again.' },
});

/**
 * POST /api/drafts/generate
 * Generate a draft reply for a given email or thread
 * Either gmailMessageId or threadId can be provided
 * If threadId is provided, will consolidate multiple unread emails
 */
router.post('/generate', authenticateJWT, generateLimiter, generateDraft);

/**
 * GET /api/drafts
 * Get all drafts for the user with optional status filter
 */
router.get('/', authenticateJWT, getAllDrafts);

/**
 * GET /api/drafts/:id
 * Get a specific draft
 */
router.get('/:id', authenticateJWT, getDraftById);

/**
 * PUT /api/drafts/:id
 * Update draft content
 */
router.put('/:id', authenticateJWT, updateDraft);

/**
 * POST /api/drafts/:id/approve
 * Approve a draft
 */
router.post('/:id/approve', authenticateJWT, approveDraft);

/**
 * POST /api/drafts/:id/reject
 * Reject a draft
 */
router.post('/:id/reject', authenticateJWT, rejectDraft);

/**
 * POST /api/drafts/:id/send
 * Send an approved draft
 */
router.post('/:id/send', authenticateJWT, sendDraft);

export default router;
