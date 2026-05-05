import { ActivityLog } from '../models/ActivityLog.js';
import { logger } from '../utils/logger.js';
import { InternalServerError } from '../utils/errors.js';
/**
 * ActivityLogService - Handles activity logging
 */
export class ActivityLogService {
    /**
     * Log an activity
     */
    static async logActivity(userId, action, entityType, level = 'info', entityId, meta) {
        try {
            const log = new ActivityLog({
                userId,
                action,
                entityType,
                level,
                entityId,
                meta,
            });
            await log.save();
            return log;
        }
        catch (error) {
            logger.error({ error, userId, action }, 'Failed to log activity');
            throw new InternalServerError('Failed to log activity');
        }
    }
    /**
     * Get user's activity logs
     */
    static async getUserActivityLogs(userId, limit = 100, skip = 0) {
        try {
            const logs = await ActivityLog.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip)
                .exec();
            return logs;
        }
        catch (error) {
            logger.error({ error, userId }, 'Failed to fetch activity logs');
            throw new InternalServerError('Failed to fetch activity logs');
        }
    }
    /**
     * Get logs for specific entity
     */
    static async getEntityLogs(userId, entityType, entityId, limit = 50) {
        try {
            const logs = await ActivityLog.find({
                userId,
                entityType,
                entityId,
            })
                .sort({ createdAt: -1 })
                .limit(limit)
                .exec();
            return logs;
        }
        catch (error) {
            logger.error({ error, userId, entityType, entityId }, 'Failed to fetch entity logs');
            throw new InternalServerError('Failed to fetch entity logs');
        }
    }
}
