import { Response } from 'express';
import { ActivityLogService } from '../services/activityLogService.js';
import { sendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Actions the activity screen can filter by (the ones the backend records). */
export const LOG_ACTIONS = [
  'DRAFT_GENERATED',
  'DRAFT_EDITED',
  'DRAFT_APPROVED',
  'DRAFT_REJECTED',
  'DRAFT_SUPERSEDED',
  'DRAFT_SENT',
];

/**
 * Get activity logs for the current user, newest first. Optional `action`
 * filter (one of LOG_ACTIONS); `total` counts the matching logs.
 */
export const getUserLogs = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 200);
    const skip = Math.max(parseInt(req.query.skip as string) || 0, 0);
    const action = req.query.action;

    if (action !== undefined && (typeof action !== 'string' || !LOG_ACTIONS.includes(action))) {
      return res.status(400).json({ error: `action must be one of: ${LOG_ACTIONS.join(', ')}` });
    }

    const [logs, total] = await Promise.all([
      ActivityLogService.getUserActivityLogs(userId, limit, skip, action),
      ActivityLogService.countUserActivityLogs(userId, action),
    ]);

    // total counts all of the user's logs, not just this page.
    res.json({ logs, total });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Get activity logs for a specific entity
 */
export const getEntityLogs = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const entityType = Array.isArray(req.params.entityType)
      ? req.params.entityType[0]
      : req.params.entityType;
    const entityId = Array.isArray(req.params.entityId)
      ? req.params.entityId[0]
      : req.params.entityId;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);

    const [logs, total] = await Promise.all([
      ActivityLogService.getEntityLogs(userId, entityType, entityId, limit),
      ActivityLogService.countEntityLogs(userId, entityType, entityId),
    ]);

    res.json({ logs, total });
  } catch (error) {
    handleError(error, res);
  }
};

function handleError(error: unknown, res: Response): void {
  sendError(res, error, 'Failed to fetch logs', (err, message) => logger.error(err, message));
}
