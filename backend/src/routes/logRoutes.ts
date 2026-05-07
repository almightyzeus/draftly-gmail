import { Router, Request, Response } from 'express';
import { ActivityLogService } from '../services/activityLogService.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
    const skip = parseInt(req.query.skip as string) || 0;
    const logs = await ActivityLogService.getUserActivityLogs(userId, limit, skip);

    res.json({ logs, total: logs.length });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Get logs error');
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

router.get('/:entityType/:entityId', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const entityType = Array.isArray(req.params.entityType)
      ? req.params.entityType[0]
      : req.params.entityType;
    const entityId = Array.isArray(req.params.entityId)
      ? req.params.entityId[0]
      : req.params.entityId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const logs = await ActivityLogService.getEntityLogs(userId, entityType, entityId, limit);

    res.json({ logs, total: logs.length });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Get entity logs error');
    res.status(500).json({ error: 'Failed to get entity logs' });
  }
});

export default router;
