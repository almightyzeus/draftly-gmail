import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PreferenceService } from '../src/services/preferenceService.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { NotFoundError, InternalServerError } from '../src/utils/errors.js';

vi.mock('../src/models/UserPreference');
vi.mock('../src/utils/logger');

describe('PreferenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserPreferences', () => {
    it('should retrieve user preferences successfully', async () => {
      const userId = 'user123';
      const mockPreferences = {
        _id: 'pref123',
        userId,
        defaultTone: 'formal',
        signature: 'Best regards, John',
        learningEmailCount: 5,
      };

      (UserPreference.findOne as unknown as Mock).mockResolvedValue(mockPreferences);

      const result = await PreferenceService.getUserPreferences(userId);

      expect(result).toEqual(mockPreferences);
      expect(UserPreference.findOne).toHaveBeenCalledWith({ userId });
    });

    it('should throw NotFoundError if preferences do not exist', async () => {
      const userId = 'user123';

      (UserPreference.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(PreferenceService.getUserPreferences(userId)).rejects.toThrow(NotFoundError);
      await expect(PreferenceService.getUserPreferences(userId)).rejects.toThrow(
        'User preferences not found'
      );
    });

    it('should throw InternalServerError on database error', async () => {
      const userId = 'user123';
      const dbError = new Error('Database connection failed');

      (UserPreference.findOne as unknown as Mock).mockRejectedValue(dbError);

      await expect(PreferenceService.getUserPreferences(userId)).rejects.toThrow(InternalServerError);
    });

    it('should handle different tone preferences', async () => {
      const userId = 'user123';
      const tones = ['formal', 'friendly', 'concise'];

      for (const tone of tones) {
        const mockPreferences = {
          _id: 'pref123',
          userId,
          defaultTone: tone,
          signature: 'Sig',
          learningEmailCount: 5,
        };

        (UserPreference.findOne as unknown as Mock).mockResolvedValue(mockPreferences);

        const result = await PreferenceService.getUserPreferences(userId);

        expect(result.defaultTone).toBe(tone);
      }
    });
  });

  describe('updateUserPreferences', () => {
    it('should update user preferences successfully', async () => {
      const userId = 'user123';
      const updates = {
        defaultTone: 'friendly' as const,
        signature: 'Updated signature',
        learningEmailCount: 10,
      };

      const updatedPreferences = {
        _id: 'pref123',
        userId,
        ...updates,
      };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue(updatedPreferences);

      const result = await PreferenceService.updateUserPreferences(userId, updates);

      expect(result).toEqual(updatedPreferences);
      expect(UserPreference.findOneAndUpdate).toHaveBeenCalledWith(
        { userId },
        { $set: updates },
        { new: true, runValidators: true }
      );
    });

    it('should update only provided fields', async () => {
      const userId = 'user123';
      const partialUpdates = {
        defaultTone: 'concise' as const,
      };

      const updatedPreferences = {
        _id: 'pref123',
        userId,
        defaultTone: 'concise',
        signature: 'Existing signature',
        learningEmailCount: 5,
      };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue(updatedPreferences);

      const result = await PreferenceService.updateUserPreferences(userId, partialUpdates);

      expect(UserPreference.findOneAndUpdate).toHaveBeenCalledWith(
        { userId },
        { $set: partialUpdates },
        { new: true, runValidators: true }
      );
      expect(result).toEqual(updatedPreferences);
    });

    it('should throw NotFoundError if preferences do not exist', async () => {
      const userId = 'user123';
      const updates = { defaultTone: 'friendly' as const };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue(null);

      await expect(PreferenceService.updateUserPreferences(userId, updates)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw InternalServerError on database error', async () => {
      const userId = 'user123';
      const updates = { defaultTone: 'friendly' as const };
      const dbError = new Error('Database update failed');

      (UserPreference.findOneAndUpdate as unknown as Mock).mockRejectedValue(dbError);

      await expect(PreferenceService.updateUserPreferences(userId, updates)).rejects.toThrow(
        InternalServerError
      );
    });

    it('should run validators on updates', async () => {
      const userId = 'user123';
      const updates = {
        learningEmailCount: 15,
      };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue({
        _id: 'pref123',
        userId,
        ...updates,
      });

      await PreferenceService.updateUserPreferences(userId, updates);

      expect(UserPreference.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ runValidators: true })
      );
    });

    it('should handle signature update with special characters', async () => {
      const userId = 'user123';
      const specialSignature = 'Best regards,\nJohn Doe\n+1 (555) 123-4567';
      const updates = { signature: specialSignature };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue({
        _id: 'pref123',
        userId,
        defaultTone: 'formal',
        signature: specialSignature,
        learningEmailCount: 5,
      });

      const result = await PreferenceService.updateUserPreferences(userId, updates);

      expect(result.signature).toBe(specialSignature);
    });

    it('should handle large learningEmailCount values', async () => {
      const userId = 'user123';
      const updates = { learningEmailCount: 1000 };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue({
        _id: 'pref123',
        userId,
        defaultTone: 'formal',
        signature: 'Sig',
        learningEmailCount: 1000,
      });

      const result = await PreferenceService.updateUserPreferences(userId, updates);

      expect(result.learningEmailCount).toBe(1000);
    });

    it('should preserve unmodified fields when updating', async () => {
      const userId = 'user123';
      const originalSignature = 'Original signature';
      const updates = { defaultTone: 'friendly' as const };

      const updatedPreferences = {
        _id: 'pref123',
        userId,
        defaultTone: 'friendly',
        signature: originalSignature,
        learningEmailCount: 5,
      };

      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue(updatedPreferences);

      const result = await PreferenceService.updateUserPreferences(userId, updates);

      expect(result.signature).toBe(originalSignature);
      expect(result.learningEmailCount).toBe(5);
    });
  });
});
