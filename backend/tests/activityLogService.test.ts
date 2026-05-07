import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ActivityLogService } from '../src/services/activityLogService';
import { ActivityLog } from '../src/models/ActivityLog';
import { InternalServerError } from '../src/utils/errors';

vi.mock('../src/models/ActivityLog');
vi.mock('../src/utils/logger');

describe('ActivityLogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logActivity', () => {
    it('should log an activity successfully', async () => {
      const userId = 'user123';
      const action = 'DRAFT_GENERATED';
      const entityType = 'Draft';
      const entityId = 'draft123';
      const meta = { draftStatus: 'PENDING' };

      const mockLog = {
        userId,
        action,
        entityType,
        level: 'info',
        entityId,
        meta,
        save: vi.fn().mockResolvedValue(true),
      };

      (ActivityLog as any).mockReturnValue(mockLog);

      const result = await ActivityLogService.logActivity(userId, action, entityType, 'info', entityId, meta);

      expect(result).toBeDefined();
      expect(mockLog.save).toHaveBeenCalled();
    });

    it('should log activity with default level', async () => {
      const userId = 'user123';
      const action = 'EMAIL_FETCHED';
      const entityType = 'Email';

      const mockLog = {
        userId,
        action,
        entityType,
        level: 'info',
        save: vi.fn().mockResolvedValue(true),
      };

      (ActivityLog as any).mockReturnValue(mockLog);

      await ActivityLogService.logActivity(userId, action, entityType);

      expect(ActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
        })
      );
    });

    it('should log activity with custom level', async () => {
      const userId = 'user123';
      const action = 'AUTH_FAILED';
      const entityType = 'User';
      const level = 'warn';

      const mockLog = {
        userId,
        action,
        entityType,
        level,
        save: vi.fn().mockResolvedValue(true),
      };

      (ActivityLog as any).mockReturnValue(mockLog);

      await ActivityLogService.logActivity(userId, action, entityType, level);

      expect(ActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level,
        })
      );
    });

    it('should throw InternalServerError on database failure', async () => {
      const userId = 'user123';
      const action = 'DRAFT_APPROVED';
      const entityType = 'Draft';
      const dbError = new Error('Database error');

      const mockLog = {
        save: vi.fn().mockRejectedValue(dbError),
      };

      (ActivityLog as any).mockReturnValue(mockLog);

      await expect(ActivityLogService.logActivity(userId, action, entityType)).rejects.toThrow(
        InternalServerError
      );
    });

    it('should handle optional entityId and meta', async () => {
      const userId = 'user123';
      const action = 'OAUTH_CONNECTED';
      const entityType = 'GmailAccount';

      const mockLog = {
        userId,
        action,
        entityType,
        save: vi.fn().mockResolvedValue(true),
      };

      (ActivityLog as any).mockReturnValue(mockLog);

      await ActivityLogService.logActivity(userId, action, entityType);

      expect(ActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          action,
          entityType,
          entityId: undefined,
          meta: undefined,
        })
      );
    });

    it('should log activity with complex metadata', async () => {
      const userId = 'user123';
      const action = 'DRAFT_GENERATED';
      const entityType = 'Draft';
      const meta = {
        tone: 'formal',
        threadId: 'thread_123',
        emailCount: 3,
        duration: 1250,
        model: 'gpt-4-turbo',
      };

      const mockLog = {
        save: vi.fn().mockResolvedValue(true),
      };

      (ActivityLog as any).mockReturnValue(mockLog);

      await ActivityLogService.logActivity(userId, action, entityType, 'info', undefined, meta);

      expect(ActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          meta,
        })
      );
    });

    it('should support different log levels', async () => {
      const userId = 'user123';
      const levels: Array<'info' | 'warn' | 'error' | 'debug'> = ['info', 'warn', 'error', 'debug'];

      for (const level of levels) {
        const mockLog = {
          save: vi.fn().mockResolvedValue(true),
        };

        (ActivityLog as any).mockReturnValue(mockLog);

        await ActivityLogService.logActivity(userId, 'TEST_ACTION', 'TestEntity', level);

        expect(ActivityLog).toHaveBeenCalledWith(
          expect.objectContaining({ level })
        );
      }
    });
  });

  describe('getUserActivityLogs', () => {
    it('should retrieve user activity logs', async () => {
      const userId = 'user123';
      const mockLogs = [
        {
          _id: 'log1',
          userId,
          action: 'DRAFT_GENERATED',
          entityType: 'Draft',
          createdAt: new Date('2025-01-20'),
        },
        {
          _id: 'log2',
          userId,
          action: 'DRAFT_APPROVED',
          entityType: 'Draft',
          createdAt: new Date('2025-01-19'),
        },
      ];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      const result = await ActivityLogService.getUserActivityLogs(userId);

      expect(result).toEqual(mockLogs);
      expect(ActivityLog.find).toHaveBeenCalledWith({ userId });
    });

    it('should sort logs by createdAt in descending order', async () => {
      const userId = 'user123';
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await ActivityLogService.getUserActivityLogs(userId);

      expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('should apply pagination with limit and skip', async () => {
      const userId = 'user123';
      const limit = 50;
      const skip = 100;
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await ActivityLogService.getUserActivityLogs(userId, limit, skip);

      expect(mockQuery.limit).toHaveBeenCalledWith(limit);
      expect(mockQuery.skip).toHaveBeenCalledWith(skip);
    });

    it('should use default pagination values', async () => {
      const userId = 'user123';
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await ActivityLogService.getUserActivityLogs(userId);

      expect(mockQuery.limit).toHaveBeenCalledWith(100);
      expect(mockQuery.skip).toHaveBeenCalledWith(0);
    });

    it('should throw InternalServerError on database failure', async () => {
      const userId = 'user123';
      const dbError = new Error('Query failed');

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(dbError),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await expect(ActivityLogService.getUserActivityLogs(userId)).rejects.toThrow(InternalServerError);
    });
  });

  describe('getEntityLogs', () => {
    it('should retrieve logs for specific entity', async () => {
      const userId = 'user123';
      const entityType = 'Draft';
      const entityId = 'draft123';
      const mockLogs = [
        {
          _id: 'log1',
          userId,
          entityType,
          entityId,
          action: 'CREATED',
          createdAt: new Date('2025-01-20'),
        },
        {
          _id: 'log2',
          userId,
          entityType,
          entityId,
          action: 'APPROVED',
          createdAt: new Date('2025-01-19'),
        },
      ];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      const result = await ActivityLogService.getEntityLogs(userId, entityType, entityId);

      expect(result).toEqual(mockLogs);
      expect(ActivityLog.find).toHaveBeenCalledWith({
        userId,
        entityType,
        entityId,
      });
    });

    it('should sort entity logs by createdAt descending', async () => {
      const userId = 'user123';
      const entityType = 'Email';
      const entityId = 'email123';
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await ActivityLogService.getEntityLogs(userId, entityType, entityId);

      expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('should apply default limit to entity logs', async () => {
      const userId = 'user123';
      const entityType = 'GmailAccount';
      const entityId = 'account123';
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await ActivityLogService.getEntityLogs(userId, entityType, entityId);

      expect(mockQuery.limit).toHaveBeenCalledWith(50);
    });

    it('should apply custom limit to entity logs', async () => {
      const userId = 'user123';
      const entityType = 'Draft';
      const entityId = 'draft123';
      const customLimit = 25;
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await ActivityLogService.getEntityLogs(userId, entityType, entityId, customLimit);

      expect(mockQuery.limit).toHaveBeenCalledWith(customLimit);
    });

    it('should throw InternalServerError on database failure', async () => {
      const userId = 'user123';
      const entityType = 'Draft';
      const entityId = 'draft123';
      const dbError = new Error('Query failed');

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(dbError),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      await expect(ActivityLogService.getEntityLogs(userId, entityType, entityId)).rejects.toThrow(
        InternalServerError
      );
    });

    it('should return empty array if no logs found', async () => {
      const userId = 'user123';
      const entityType = 'Draft';
      const entityId = 'nonexistent123';
      const mockLogs: any[] = [];

      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockLogs),
      };

      (ActivityLog.find as unknown as Mock).mockReturnValue(mockQuery);

      const result = await ActivityLogService.getEntityLogs(userId, entityType, entityId);

      expect(result).toEqual([]);
    });
  });
});
