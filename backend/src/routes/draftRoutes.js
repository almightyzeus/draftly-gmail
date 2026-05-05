import { Router } from 'express';
import { DraftService } from '../services/draftService.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
const router = Router();
/**
 * POST /api/drafts/generate
 * Generate a draft reply for a given email
 */
router.post('/generate', authenticateJWT, async (req, res) => {
    try {
        const userId = req.userId;
        const { gmailMessageId, tone } = req.body;
        if (!gmailMessageId) {
            return res.status(400).json({ error: 'gmailMessageId is required' });
        }
        const validTones = ['formal', 'concise', 'friendly'];
        if (tone && !validTones.includes(tone)) {
            return res.status(400).json({
                error: `Invalid tone. Must be one of: ${validTones.join(', ')}`,
            });
        }
        const draft = await DraftService.generateDraft(userId, gmailMessageId, tone || 'formal');
        res.status(201).json(draft);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Draft generation error');
        res.status(500).json({ error: 'Failed to generate draft' });
    }
});
/**
 * GET /api/drafts
 * Get all drafts for the user with optional status filter
 */
router.get('/', authenticateJWT, async (req, res) => {
    try {
        const userId = req.userId;
        const { status, limit } = req.query;
        const limitNum = limit ? parseInt(limit) : 20;
        const statusStr = typeof status === 'string' ? status : undefined;
        const drafts = await DraftService.getUserDrafts(userId, statusStr, limitNum);
        res.json(drafts);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Get drafts error');
        res.status(500).json({ error: 'Failed to get drafts' });
    }
});
/**
 * GET /api/drafts/:id
 * Get a specific draft
 */
router.get('/:id', authenticateJWT, async (req, res) => {
    try {
        const userId = req.userId;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draft = await DraftService.getDraftById(userId, id);
        res.json(draft);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Get draft error');
        res.status(500).json({ error: 'Failed to get draft' });
    }
});
/**
 * PUT /api/drafts/:id
 * Update draft content
 */
router.put('/:id', authenticateJWT, async (req, res) => {
    try {
        const userId = req.userId;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { draftBody } = req.body;
        if (!draftBody) {
            return res.status(400).json({ error: 'draftBody is required' });
        }
        const draft = await DraftService.updateDraft(userId, id, draftBody);
        res.json(draft);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Update draft error');
        res.status(500).json({ error: 'Failed to update draft' });
    }
});
/**
 * POST /api/drafts/:id/approve
 * Approve a draft
 */
router.post('/:id/approve', authenticateJWT, async (req, res) => {
    try {
        const userId = req.userId;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draft = await DraftService.approveDraft(userId, id);
        res.json(draft);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Approve draft error');
        res.status(500).json({ error: 'Failed to approve draft' });
    }
});
/**
 * POST /api/drafts/:id/reject
 * Reject a draft
 */
router.post('/:id/reject', authenticateJWT, async (req, res) => {
    try {
        const userId = req.userId;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const draft = await DraftService.rejectDraft(userId, id);
        res.json(draft);
    }
    catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)), 'Reject draft error');
        res.status(500).json({ error: 'Failed to reject draft' });
    }
});
export default router;
