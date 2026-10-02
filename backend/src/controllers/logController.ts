import { Response } from 'express';
import { ActivityLogService } from '../services/activityLogService.js';
import { sendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Get activity logs for the current user
 */
export const getUserLogs = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 200);
    const skip = Math.max(parseInt(req.query.skip as string) || 0, 0);

    const logs = await ActivityLogService.getUserActivityLogs(userId, limit, skip);

    res.json({ logs, total: logs.length });
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

    const logs = await ActivityLogService.getEntityLogs(userId, entityType, entityId, limit);

    res.json({ logs, total: logs.length });
  } catch (error) {
    handleError(error, res);
  }
};

function handleError(error: unknown, res: Response): void {
  sendError(res, error, 'Failed to fetch logs', (err, message) => logger.error(err, message));
}
