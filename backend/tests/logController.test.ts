import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response } from 'express';
import { getUserLogs, getEntityLogs } from '../src/controllers/logController';
import { ActivityLogService } from '../src/services/activityLogService';
import { AppError } from '../src/utils/errors';

vi.mock('../src/services/activityLogService');
vi.mock('../src/utils/logger');

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

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 100, 0);
      expect(mockRes.json).toHaveBeenCalledWith({ logs: mockLogs, total: mockLogs.length });
    });

    it('should get user logs with custom limit', async () => {
      mockReq.query = { limit: '50' };

      const mockLogs = [];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 50, 0);
    });

    it('should cap limit at 200', async () => {
      mockReq.query = { limit: '500' };

      const mockLogs = [];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 200, 0);
    });

    it('should use skip parameter for pagination', async () => {
      mockReq.query = { limit: '20', skip: '40' };

      const mockLogs = [];

      (ActivityLogService.getUserActivityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getUserLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getUserActivityLogs).toHaveBeenCalledWith('user123', 20, 40);
    });

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

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'draft', 'draft123', 50);
      expect(mockRes.json).toHaveBeenCalledWith({ logs: mockLogs, total: mockLogs.length });
    });

    it('should get entity logs with custom limit', async () => {
      mockReq.params = { entityType: 'email', entityId: 'email456' };
      mockReq.query = { limit: '100' };

      const mockLogs = [];

      (ActivityLogService.getEntityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'email', 'email456', 100);
    });

    it('should cap limit at 100 for entity logs', async () => {
      mockReq.params = { entityType: 'draft', entityId: 'draft123' };
      mockReq.query = { limit: '200' };

      const mockLogs = [];

      (ActivityLogService.getEntityLogs as unknown as Mock).mockResolvedValue(mockLogs);

      await getEntityLogs(mockReq, mockRes as Response);

      expect(ActivityLogService.getEntityLogs).toHaveBeenCalledWith('user123', 'draft', 'draft123', 100);
    });

    it('should handle array params', async () => {
      mockReq.params = { entityType: ['draft'], entityId: ['draft123'] };
      mockReq.query = {};

      const mockLogs = [];

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
