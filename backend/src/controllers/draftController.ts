import { Response } from 'express';
import { DraftService } from '../services/draftService.js';
import { AuthRequest } from '../middleware/auth.js';
import { sendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const MAX_ID_LENGTH = 256;
const MAX_CUSTOM_CONTEXT_LENGTH = 2_000;
const MAX_DRAFT_BODY_LENGTH = 50_000;
const DRAFT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SENT'];

/**
 * Generate a draft reply for a given email or thread
 * Either gmailMessageId or threadId can be provided
 * If threadId is provided, will consolidate multiple unread emails
 */
export const generateDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { gmailMessageId, threadId, tone, customContext } = req.body ?? {};

    // Ids are used in Mongo filters: only plain strings are accepted, so an
    // object such as {"$ne": null} can never act as a query operator.
    const isOptionalId = (value: unknown) =>
      value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH);
    if (!isOptionalId(gmailMessageId) || !isOptionalId(threadId)) {
      return res.status(400).json({ error: 'gmailMessageId and threadId must be non-empty strings' });
    }

    if (!gmailMessageId && !threadId) {
      return res.status(400).json({ error: 'Either gmailMessageId or threadId is required' });
    }

    if (
      customContext !== undefined &&
      (typeof customContext !== 'string' || customContext.length > MAX_CUSTOM_CONTEXT_LENGTH)
    ) {
      return res.status(400).json({
        error: `customContext must be a string of at most ${MAX_CUSTOM_CONTEXT_LENGTH} characters`,
      });
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

    // Stored statuses are upper-case; accept any case from the query string.
    const statusStr = typeof status === 'string' && status !== '' ? status.toUpperCase() : undefined;
    if (statusStr !== undefined && !DRAFT_STATUSES.includes(statusStr)) {
      return res.status(400).json({ error: `status must be one of: ${DRAFT_STATUSES.join(', ')}` });
    }

    const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : NaN;
    const limitNum = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;

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
    const { draftBody } = req.body ?? {};

    if (!draftBody) {
      return res.status(400).json({ error: 'draftBody is required' });
    }
    if (typeof draftBody !== 'string' || draftBody.length > MAX_DRAFT_BODY_LENGTH) {
      return res.status(400).json({
        error: `draftBody must be a string of at most ${MAX_DRAFT_BODY_LENGTH} characters`,
      });
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

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Send an approved draft
 * The idempotency key comes from the `Idempotency-Key` header, falling back to
 * the legacy `idempotencyKey` body field.
 */
export const sendDraft = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const idempotencyKey = req.headers?.['idempotency-key'] ?? req.body?.idempotencyKey;

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    if (
      typeof idempotencyKey !== 'string' ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
      return res.status(400).json({
        error: `idempotencyKey must be a non-empty string of at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      });
    }

    const draft = await DraftService.sendDraft(userId, id, idempotencyKey);

    res.json(draft);
  } catch (error) {
    handleError(error, res);
  }
};

function handleError(error: unknown, res: Response): void {
  sendError(res, error, 'Failed to process draft request', (err, message) => logger.error(err, message));
}
