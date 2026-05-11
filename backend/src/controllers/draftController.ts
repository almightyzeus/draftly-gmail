import { Response } from 'express';
import { DraftService } from '../services/draftService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Generate a draft reply for a given email or thread
 * Either gmailMessageId or threadId can be provided
 * If threadId is provided, will consolidate multiple unread emails
 */
export const generateDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { gmailMessageId, threadId, tone, customContext } = req.body;

    if (!gmailMessageId && !threadId) {
      return res.status(400).json({ error: 'Either gmailMessageId or threadId is required' });
    }

    const validTones = ['formal', 'concise', 'friendly'];
    if (tone && !validTones.includes(tone)) {
      return res.status(400).json({
        error: `Invalid tone. Must be one of: ${validTones.join(', ')}`,
      });
    }

    const draft = await DraftService.generateDraft(
      userId,
      gmailMessageId,
      tone || 'formal',
      threadId,
      customContext
    );

    res.status(201).json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Get all drafts for the user with optional status filter
 */
export const getAllDrafts = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { status, limit } = req.query;

    const limitNum = limit ? parseInt(limit as string) : 20;
    const statusStr = typeof status === 'string' ? status : undefined;

    const drafts = await DraftService.getUserDrafts(userId, statusStr, limitNum);

    res.json(drafts);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Get a specific draft by ID
 */
export const getDraftById = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const draft = await DraftService.getDraftById(userId, id);

    res.json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Update draft content
 */
export const updateDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { draftBody } = req.body;

    if (!draftBody) {
      return res.status(400).json({ error: 'draftBody is required' });
    }

    const draft = await DraftService.updateDraft(userId, id, draftBody);

    res.json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Approve a draft
 */
export const approveDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const draft = await DraftService.approveDraft(userId, id);

    res.json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Reject a draft
 */
export const rejectDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const draft = await DraftService.rejectDraft(userId, id);

    res.json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Send an approved draft
 */
export const sendDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { idempotencyKey } = req.body;

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    const draft = await DraftService.sendDraft(userId, id, idempotencyKey);

    res.json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Generic error handler for draft controller
 */
function handleError(error: any, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
  } else {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Draft controller error');
    res.status(500).json({ error: 'Failed to process draft request' });
  }
}
