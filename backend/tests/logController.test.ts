import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response } from 'express';
import { getUserLogs, getEntityLogs } from '../src/controllers/logController.js';
import { ActivityLogService } from '../src/services/activityLogService.js';
import { AppError } from '../src/utils/errors.js';

vi.mock('../src/services/activityLogService.js');
vi.mock('../src/utils/logger.js');

describe('LogController', () => {
  let mockReq: any;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      params: {},
      query: {},
      userId: 'user123',
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('getUserLogs', () => {
    it('should get user logs with default pagination', async () => {
      mockReq.query = {};

      const mockLogs = [
        { id: 'log1', action: 'draft_created' },
        { id: 'log2', action: 'draft_approved' },
      ];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);
      (ActivityLogService.countUserActivityLogs as unknown as Mock).mockResolvedValue(42);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 100, 0, undefined);
      expect(ActivityLogService.countUserActivityLogs).toHaveBeenCalledWith('user123', undefined);
      // total is every log of the user, not the size of this page
      expect(mockRes.json).toHaveBeenCalledWith({ logs: mockLogs, total: 42 });
    });

    it('should get user logs with custom limit', async () => {
      mockReq.query = { limit: '50' };

      const mockLogs: any[] = [];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 50, 0, undefined);
    });

    it('should cap limit at 200', async () => {
      mockReq.query = { limit: '500' };

      const mockLogs: any[] = [];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 200, 0, undefined);
    });

    it('should use skip parameter for pagination', async () => {
      mockReq.query = { limit: '20', skip: '40' };

      const mockLogs: any[] = [];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 20, 40, undefined);
    });

    it('filters by action, counting only the matching logs', async () => {
      mockReq.query = { action: 'DRAFT_SENT', limit: '25', skip: '25' };
      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue([]);
      (ActivityLogService.countUserActivityLogs as unknown as Mock).mockResolvedValue(3);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 25, 25, 'DRAFT_SENT');
      expect(ActivityLogService.countUserActivityLogs).toHaveBeenCalledWith('user123', 'DRAFT_SENT');
      expect(mockRes.json).toHaveBeenCalledWith({ logs: [], total: 3 });
    });

    it.each([['an unknown action', 'DROP_TABLE'], ['an operator object', { $ne: null }], ['a repeated parameter', ['DRAFT_SENT', 'DRAFT_EDITED']]])(
      'returns 400 for %s',
      async (_label, action) => {
        mockReq.query = { action };

        await getUserLogs(mockReq, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(ActivityLogService.getUserActivityLogs).not.toHaveBeenCalled();
      }
    );

    it('should handle errors during retrieval', async () => {
      mockReq.query = {};

      const error = new AppError('Database error', 500);
      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockRejectedValue(error);

      await getUserLogs(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database error' });
    });
  });

  describe('getEntityLogs', () => {
    it('should get entity logs successfully', async () => {
      mockReq.params = { entityType: 'draft', entityId: 'draft123' };
      mockReq.query = {};

      const mockLogs = [
        { id: 'log1', action: 'created', entityType: 'draft' },
        { id: 'log2', action: 'approved', entityType: 'draft' },
      ];

      (ActivityLogService.getEntityLogs as unknown as Mock).mockResolvedValue(mockLogs);
      (ActivityLogService.countEntityLogs as unknown as Mock).mockResolvedValue(7);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'draft', 'draft123', 50);
      expect(ActivityLogService.countEntityLogs).toHaveBeenCalledWith('user123', 'draft', 'draft123');
      expect(mockRes.json).toHaveBeenCalledWith({ logs: mockLogs, total: 7 });
    });

    it('should get entity logs with custom limit', async () => {
      mockReq.params = { entityType: 'email', entityId: 'email456' };
      mockReq.query = { limit: '100' };

      const mockLogs: any[] = [];

      (ActivityLogService.getEntityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'email', 'email456', 100);
    });

    it('should cap limit at 100 for entity logs', async () => {
      mockReq.params = { entityType: 'draft', entityId: 'draft123' };
      mockReq.query = { limit: '200' };

      const mockLogs: any[] = [];

      (ActivityLogService.getEntityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'draft', 'draft123', 100);
    });

    it('should handle array params', async () => {
      mockReq.params = { entityType: ['draft'], entityId: ['draft123'] };
      mockReq.query = {};

      const mockLogs: any[] = [];

      (ActivityLogService.getEntityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'draft', 'draft123', 50);
    });

    it('should handle errors during retrieval', async () => {
      mockReq.params = { entityType: 'draft', entityId: 'draft123' };
      mockReq.query = {};

      const error = new AppError('Entity not found', 404);
      (ActivityLogService.getEntityLogs as unknown as Mock).mockRejectedValue(error);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Entity not found' });
    });
  });
});
