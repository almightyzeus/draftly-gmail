import { Router } from 'express';
import {
  generateDraft,
  getAllDrafts,
  getDraftById,
  updateDraft,
  approveDraft,
  rejectDraft,
  sendDraft,
} from '../controllers/draftController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/drafts/generate
 * Generate a draft reply for a given email or thread
 * Either gmailMessageId or threadId can be provided
 * If threadId is provided, will consolidate multiple unread emails
 */
router.post('/generate', authenticateJWT, generateDraft);

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
