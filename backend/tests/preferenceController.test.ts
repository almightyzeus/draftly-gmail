import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response } from 'express';
import { getUserPreferences, updateUserPreferences } from '../src/controllers/preferenceController';
import { PreferenceService } from '../src/services/preferenceService';
import { AppError } from '../src/utils/errors';

vi.mock('../src/services/preferenceService');
vi.mock('../src/utils/logger');

describe('PreferenceController', () => {
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

  describe('getUserPreferences', () => {
    it('should get user preferences successfully', async () => {
      const mockPreferences = {
        _id: 'pref123',
        userId: 'user123',
        defaultTone: 'formal',
        signature: 'Best regards',
        learningEmailCount: 10,
      };

      (PreferenceService.getUserPreferences as unknown as Mock).mockResolvedValue(mockPreferences);

      await getUserPreferences(mockReq, mockRes as Response);

      expect(PreferenceService.getUserPreferences).toHaveBeenCalledWith('user123');
      expect(mockRes.json).toHaveBeenCalledWith({
        defaultTone: 'formal',
        signature: 'Best regards',
        learningEmailCount: 10,
      });
    });

    it('should handle errors during retrieval', async () => {
      const error = new AppError('User not found', 404);
      (PreferenceService.getUserPreferences as unknown as Mock).mockRejectedValue(error);

      await getUserPreferences(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User not found' });
    });
  });

  describe('updateUserPreferences', () => {
    it('should update all preferences successfully', async () => {
      mockReq.body = {
        defaultTone: 'concise',
        signature: 'Kind regards',
        learningEmailCount: 20,
      };

      const mockUpdatedPreferences = {
        _id: 'pref123',
        userId: 'user123',
        defaultTone: 'concise',
        signature: 'Kind regards',
        learningEmailCount: 20,
      };

      (PreferenceService.updateUserPreferences as unknown as Mock).mockResolvedValue(mockUpdatedPreferences);

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(PreferenceService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        defaultTone: 'concise',
        signature: 'Kind regards',
        learningEmailCount: 20,
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        defaultTone: 'concise',
        signature: 'Kind regards',
        learningEmailCount: 20,
      });
    });

    it('should update only provided preferences', async () => {
      mockReq.body = {
        defaultTone: 'friendly',
      };

      const mockUpdatedPreferences = {
        _id: 'pref123',
        userId: 'user123',
        defaultTone: 'friendly',
        signature: 'Regards',
        learningEmailCount: 10,
      };

      (PreferenceService.updateUserPreferences as unknown as Mock).mockResolvedValue(mockUpdatedPreferences);

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(PreferenceService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        defaultTone: 'friendly',
      });
    });

    it('should return 400 for invalid tone', async () => {
      mockReq.body = {
        defaultTone: 'invalid_tone',
      };

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'defaultTone must be formal, concise, or friendly',
      });
    });

    it('should update signature when provided as string', async () => {
      mockReq.body = {
        signature: 'New Signature',
      };

      const mockUpdatedPreferences = {
        _id: 'pref123',
        userId: 'user123',
        defaultTone: 'formal',
        signature: 'New Signature',
        learningEmailCount: 10,
      };

      (PreferenceService.updateUserPreferences as unknown as Mock).mockResolvedValue(mockUpdatedPreferences);

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(PreferenceService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        signature: 'New Signature',
      });
    });

    it('should update learningEmailCount when provided', async () => {
      mockReq.body = {
        learningEmailCount: 25,
      };

      const mockUpdatedPreferences = {
        _id: 'pref123',
        userId: 'user123',
        defaultTone: 'formal',
        signature: 'Regards',
        learningEmailCount: 25,
      };

      (PreferenceService.updateUserPreferences as unknown as Mock).mockResolvedValue(mockUpdatedPreferences);

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(PreferenceService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        learningEmailCount: 25,
      });
    });

    it('should not include signature if not a string', async () => {
      mockReq.body = {
        signature: null,
        defaultTone: 'concise',
      };

      const mockUpdatedPreferences = {
        _id: 'pref123',
        userId: 'user123',
        defaultTone: 'concise',
        signature: 'Regards',
        learningEmailCount: 10,
      };

      (PreferenceService.updateUserPreferences as unknown as Mock).mockResolvedValue(mockUpdatedPreferences);

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(PreferenceService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        defaultTone: 'concise',
      });
    });

    it('should handle errors during update', async () => {
      mockReq.body = {
        defaultTone: 'formal',
      };

      const error = new AppError('Failed to update preferences', 500);
      (PreferenceService.updateUserPreferences as unknown as Mock).mockRejectedValue(error);

      await updateUserPreferences(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to update preferences' });
    });
  });
});
