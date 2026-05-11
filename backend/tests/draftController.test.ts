import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response } from 'express';
import {
  generateDraft,
  getAllDrafts,
  getDraftById,
  updateDraft,
  approveDraft,
  rejectDraft,
  sendDraft,
} from '../src/controllers/draftController';
import { DraftService } from '../src/services/draftService';
import { AppError } from '../src/utils/errors';

vi.mock('../src/services/draftService');

describe('DraftController', () => {
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

  describe('generateDraft', () => {
    it('should generate a draft successfully', async () => {
      mockReq.body = {
        gmailMessageId: 'msg123',
        tone: 'formal',
      };

      const mockDraft = {
        id: 'draft123',
        userId: 'user123',
        draftBody: 'This is a draft response.',
        status: 'pending',
      };

      (DraftService.generateDraft as unknown as Mock).mockResolvedValue(mockDraft);

      await generateDraft(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(mockDraft);
    });

    it('should return 400 if neither gmailMessageId nor threadId is provided', async () => {
      mockReq.body = {
        tone: 'formal',
      };

      await generateDraft(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Either gmailMessageId or threadId is required',
      });
    });

    it('should return 400 for invalid tone', async () => {
      mockReq.body = {
        gmailMessageId: 'msg123',
        tone: 'invalid',
      };

      await generateDraft(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid tone. Must be one of: formal, concise, friendly',
      });
    });
  });

  describe('getAllDrafts', () => {
    it('should get all drafts successfully', async () => {
      mockReq.query = { status: 'pending' };

      const mockDrafts = [
        { id: 'draft1', status: 'pending' },
        { id: 'draft2', status: 'pending' },
      ];

      (DraftService.getUserDrafts as unknown as Mock).mockResolvedValue(mockDrafts);

      await getAllDrafts(mockReq, mockRes as Response);

      expect(DraftService.getUserDrafts).toHaveBeenCalledWith('user123', 'pending', 20);
      expect(mockRes.json).toHaveBeenCalledWith(mockDrafts);
    });

    it('should use default limit of 20', async () => {
      mockReq.query = {};

      (DraftService.getUserDrafts as unknown as Mock).mockResolvedValue([]);

      await getAllDrafts(mockReq, mockRes as Response);

      expect(DraftService.getUserDrafts).toHaveBeenCalledWith('user123', undefined, 20);
    });

    it('should parse custom limit from query', async () => {
      mockReq.query = { limit: '50' };

      (DraftService.getUserDrafts as unknown as Mock).mockResolvedValue([]);

      await getAllDrafts(mockReq, mockRes as Response);

      expect(DraftService.getUserDrafts).toHaveBeenCalledWith('user123', undefined, 50);
    });
  });

  describe('getDraftById', () => {
    it('should get a draft by ID successfully', async () => {
      mockReq.params = { id: 'draft123' };

      const mockDraft = { id: 'draft123', draftBody: 'Sample draft' };

      (DraftService.getDraftById as unknown as Mock).mockResolvedValue(mockDraft);

      await getDraftById(mockReq, mockRes as Response);

      expect(DraftService.getDraftById).toHaveBeenCalledWith('user123', 'draft123');
      expect(mockRes.json).toHaveBeenCalledWith(mockDraft);
    });

    it('should handle array params', async () => {
      mockReq.params = { id: ['draft123'] };

      const mockDraft = { id: 'draft123', draftBody: 'Sample draft' };

      (DraftService.getDraftById as unknown as Mock).mockResolvedValue(mockDraft);

      await getDraftById(mockReq, mockRes as Response);

      expect(DraftService.getDraftById).toHaveBeenCalledWith('user123', 'draft123');
    });
  });

  describe('updateDraft', () => {
    it('should update a draft successfully', async () => {
      mockReq.params = { id: 'draft123' };
      mockReq.body = { draftBody: 'Updated content' };

      const mockUpdatedDraft = { id: 'draft123', draftBody: 'Updated content' };

      (DraftService.updateDraft as unknown as Mock).mockResolvedValue(mockUpdatedDraft);

      await updateDraft(mockReq, mockRes as Response);

      expect(DraftService.updateDraft).toHaveBeenCalledWith('user123', 'draft123', 'Updated content');
      expect(mockRes.json).toHaveBeenCalledWith(mockUpdatedDraft);
    });

    it('should return 400 if draftBody is missing', async () => {
      mockReq.params = { id: 'draft123' };
      mockReq.body = {};

      await updateDraft(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'draftBody is required',
      });
    });
  });

  describe('approveDraft', () => {
    it('should approve a draft successfully', async () => {
      mockReq.params = { id: 'draft123' };

      const mockApprovedDraft = { id: 'draft123', status: 'approved' };

      (DraftService.approveDraft as unknown as Mock).mockResolvedValue(mockApprovedDraft);

      await approveDraft(mockReq, mockRes as Response);

      expect(DraftService.approveDraft).toHaveBeenCalledWith('user123', 'draft123');
      expect(mockRes.json).toHaveBeenCalledWith(mockApprovedDraft);
    });
  });

  describe('rejectDraft', () => {
    it('should reject a draft successfully', async () => {
      mockReq.params = { id: 'draft123' };

      const mockRejectedDraft = { id: 'draft123', status: 'rejected' };

      (DraftService.rejectDraft as unknown as Mock).mockResolvedValue(mockRejectedDraft);

      await rejectDraft(mockReq, mockRes as Response);

      expect(DraftService.rejectDraft).toHaveBeenCalledWith('user123', 'draft123');
      expect(mockRes.json).toHaveBeenCalledWith(mockRejectedDraft);
    });
  });

  describe('sendDraft', () => {
    it('should send a draft successfully', async () => {
      mockReq.params = { id: 'draft123' };
      mockReq.body = { idempotencyKey: 'key123' };

      const mockSentDraft = { id: 'draft123', status: 'sent' };

      (DraftService.sendDraft as unknown as Mock).mockResolvedValue(mockSentDraft);

      await sendDraft(mockReq, mockRes as Response);

      expect(DraftService.sendDraft).toHaveBeenCalledWith('user123', 'draft123', 'key123');
      expect(mockRes.json).toHaveBeenCalledWith(mockSentDraft);
    });

    it('should return 400 if idempotencyKey is missing', async () => {
      mockReq.params = { id: 'draft123' };
      mockReq.body = {};

      await sendDraft(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'idempotencyKey is required',
      });
    });
  });
});
