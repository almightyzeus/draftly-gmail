import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { DraftService } from '../src/services/draftService.js';
import { Draft } from '../src/models/Draft.js';
import { EmailMessage } from '../src/models/EmailMessage.js';

vi.mock('../src/models/Draft');
vi.mock('../src/models/EmailMessage');
vi.mock('../src/services/openaiService');
vi.mock('../src/services/gmailService');
vi.mock('../src/utils/logger');

describe('DraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateDraft', () => {
    it('should generate a draft from an email', async () => {
      const mockEmail = {
        _id: 'email123',
        userId: 'user123',
        gmailMessageId: 'msg123',
        threadId: 'thread123',
        from: 'sender@example.com',
        to: 'user@gmail.com',
        subject: 'Test Email',
        bodyPlain: 'This is a test email',
        direction: 'INBOUND',
      };

      (EmailMessage.findById as unknown as Mock).mockResolvedValue(mockEmail);
      (Draft as unknown as Mock).mockReturnValue({
        userId: 'user123',
        gmailMessageId: 'msg123',
        draftBody: 'Generated reply...',
        status: 'PENDING',
        tone: 'formal',
        save: vi.fn().mockResolvedValue(true),
      });

      const result = await DraftService.generateDraft('user123', 'email123', 'formal');

      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
    });

    it('should throw error if email not found', async () => {
      (EmailMessage.findById as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.generateDraft('user123', 'nonexistent', 'formal')
      ).rejects.toThrow();
    });
  });

  describe('approveDraft', () => {
    it('should approve a draft', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'user123',
        status: 'PENDING',
        save: vi.fn().mockResolvedValue(true),
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      const result = await DraftService.approveDraft('draft123', 'user123');

      expect(result).toBeDefined();
    });

    it('should throw error if draft not found', async () => {
      (Draft.findById as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.approveDraft('nonexistent', 'user123')
      ).rejects.toThrow();
    });
  });

  describe('rejectDraft', () => {
    it('should reject a draft', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'user123',
        status: 'PENDING',
        save: vi.fn().mockResolvedValue(true),
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      const result = await DraftService.rejectDraft('draft123', 'user123');

      expect(result).toBeDefined();
    });
  });

  describe('editDraft', () => {
    it('should update draft body', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'user123',
        draftBody: 'Original text',
        gmailDraftId: null,
        save: vi.fn().mockResolvedValue(true),
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      const newBody = 'Updated text';
      const result = await DraftService.editDraft('draft123', 'user123', newBody);

      expect(result).toBeDefined();
    });

    it('should throw error if draft not found', async () => {
      (Draft.findById as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.editDraft('nonexistent', 'user123', 'new text')
      ).rejects.toThrow();
    });
  });

  describe('getDraft', () => {
    it('should retrieve a draft by ID', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'user123',
        draftBody: 'Reply text',
        status: 'PENDING',
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      const result = await DraftService.getDraft('draft123', 'user123');

      expect(result).toBeDefined();
      expect(result._id).toBe('draft123');
    });

    it('should throw error if user does not own draft', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'otheruser',
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      await expect(
        DraftService.getDraft('draft123', 'user123')
      ).rejects.toThrow();
    });
  });

  describe('sendDraft', () => {
    it('should send approved draft', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'user123',
        status: 'APPROVED',
        save: vi.fn().mockResolvedValue(true),
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      const result = await DraftService.sendDraft('draft123', 'user123', 'unique-key-123');

      expect(result).toBeDefined();
    });

    it('should throw error if draft not approved', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'user123',
        status: 'PENDING',
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      await expect(
        DraftService.sendDraft('draft123', 'user123', 'unique-key')
      ).rejects.toThrow();
    });

    it('should throw error if draft not found', async () => {
      (Draft.findById as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.sendDraft('nonexistent', 'user123', 'unique-key')
      ).rejects.toThrow();
    });

    it('should throw error if user does not own draft', async () => {
      const mockDraft = {
        _id: 'draft123',
        userId: 'other-user',
        status: 'APPROVED',
      };

      (Draft.findById as unknown as Mock).mockResolvedValue(mockDraft);

      await expect(
        DraftService.sendDraft('draft123', 'user123', 'unique-key')
      ).rejects.toThrow();
    });
  });

  describe('getUserDrafts', () => {
    it('should retrieve all drafts for a user', async () => {
      const userId = 'user123';
      const mockDrafts = [
        { _id: 'draft1', userId, status: 'PENDING', draftBody: 'Draft 1' },
        { _id: 'draft2', userId, status: 'APPROVED', draftBody: 'Draft 2' },
      ];

      (Draft.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockDrafts),
      });

      const result = await DraftService.getUserDrafts(userId);

      expect(result).toEqual(mockDrafts);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should filter drafts by status', async () => {
      const userId = 'user123';
      const status = 'APPROVED';
      const mockDrafts = [
        { _id: 'draft2', userId, status: 'APPROVED', draftBody: 'Draft 2' },
      ];

      (Draft.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockDrafts),
      });

      const result = await DraftService.getUserDrafts(userId, status);

      expect(result).toEqual(mockDrafts);
      expect(Draft.find).toHaveBeenCalledWith(
        expect.objectContaining({ status })
      );
    });

    it('should apply custom limit', async () => {
      const userId = 'user123';
      const customLimit = 50;
      const mockDrafts: any[] = [];

      (Draft.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockDrafts),
      });

      await DraftService.getUserDrafts(userId, undefined, customLimit);

      const query = (Draft.find as unknown as Mock).mock.results[0].value;
      expect(query.limit).toHaveBeenCalledWith(customLimit);
    });

    it('should return empty array if no drafts found', async () => {
      const userId = 'user123';
      const mockDrafts: any[] = [];

      (Draft.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockDrafts),
      });

      const result = await DraftService.getUserDrafts(userId);

      expect(result).toEqual([]);
    });
  });

  describe('getDraftById', () => {
    it('should retrieve a draft by ID', async () => {
      const userId = 'user123';
      const draftId = 'draft123';
      const mockDraft = {
        _id: draftId,
        userId,
        draftBody: 'Reply text',
        status: 'PENDING',
      };

      (Draft.findOne as unknown as Mock).mockResolvedValue(mockDraft);

      const result = await DraftService.getDraftById(userId, draftId);

      expect(result).toEqual(mockDraft);
      expect(Draft.findOne).toHaveBeenCalledWith({
        _id: expect.any(Object),
        userId: expect.any(Object),
      });
    });

    it('should throw error if draft not found', async () => {
      const userId = 'user123';
      const draftId = 'nonexistent';

      (Draft.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.getDraftById(userId, draftId)
      ).rejects.toThrow('Draft not found');
    });

    it('should throw error if draft belongs to different user', async () => {
      const userId = 'user123';
      const draftId = 'draft456';
      const mockDraft = {
        _id: draftId,
        userId: 'other-user',
        draftBody: 'Another user draft',
      };

      (Draft.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.getDraftById(userId, draftId)
      ).rejects.toThrow();
    });
  });

  describe('updateDraft', () => {
    it('should update draft content', async () => {
      const userId = 'user123';
      const draftId = 'draft123';
      const newBody = 'Updated draft content';
      const mockDraft = {
        _id: draftId,
        userId,
        draftBody: 'Original content',
        save: vi.fn().mockResolvedValue(true),
      };

      (Draft.findOne as unknown as Mock).mockResolvedValue(mockDraft);

      const result = await DraftService.updateDraft(userId, draftId, newBody);

      expect(result).toBeDefined();
      expect(mockDraft.save).toHaveBeenCalled();
    });

    it('should throw error if draft not found', async () => {
      const userId = 'user123';
      const draftId = 'nonexistent';

      (Draft.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.updateDraft(userId, draftId, 'new content')
      ).rejects.toThrow();
    });

    it('should throw error if user does not own draft', async () => {
      const userId = 'user123';
      const draftId = 'draft123';
      const mockDraft = {
        _id: draftId,
        userId: 'other-user',
      };

      (Draft.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        DraftService.updateDraft(userId, draftId, 'new content')
      ).rejects.toThrow();
    });

    it('should reject update if draft is already sent', async () => {
      const userId = 'user123';
      const draftId = 'draft123';
      const mockDraft = {
        _id: draftId,
        userId,
        status: 'SENT',
        draftBody: 'Original',
      };

      (Draft.findOne as unknown as Mock).mockResolvedValue(mockDraft);

      await expect(
        DraftService.updateDraft(userId, draftId, 'new content')
      ).rejects.toThrow();
    });
  });
});
