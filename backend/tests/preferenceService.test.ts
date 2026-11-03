import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PreferenceService, DEFAULT_PREFERENCES } from '../src/services/preferenceService.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { InternalServerError } from '../src/utils/errors.js';

vi.mock('../src/models/UserPreference');
vi.mock('../src/utils/logger');

const userId = 'user123';

describe('PreferenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserPreferences', () => {
    it('returns stored preferences, creating the defaults only if none exist (atomic upsert)', async () => {
      const stored = { _id: 'pref123', userId, defaultTone: 'friendly', signature: 'Best, John', learningEmailCount: 7 };
      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue(stored);

      await expect(PreferenceService.getUserPreferences(userId)).resolves.toEqual(stored);
      expect(UserPreference.findOneAndUpdate).toHaveBeenCalledWith(
        { userId },
        { $setOnInsert: DEFAULT_PREFERENCES },
        { upsert: true, returnDocument: 'after' }
      );
    });

    it('uses the registration defaults', () => {
      expect(DEFAULT_PREFERENCES).toEqual({ defaultTone: 'formal', signature: '', learningEmailCount: 5 });
    });

    it('reports database errors as internal errors', async () => {
      (UserPreference.findOneAndUpdate as unknown as Mock).mockRejectedValue(new Error('Database connection failed'));

      await expect(PreferenceService.getUserPreferences(userId)).rejects.toThrow(InternalServerError);
    });
  });

  describe('updateUserPreferences', () => {
    it('sets every given field and runs validators', async () => {
      const updates = { defaultTone: 'friendly' as const, signature: 'Updated signature', learningEmailCount: 10 };
      const updated = { _id: 'pref123', userId, ...updates };
      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue(updated);

      await expect(PreferenceService.updateUserPreferences(userId, updates)).resolves.toEqual(updated);
      // Every field is given, so nothing is left for $setOnInsert.
      expect(UserPreference.findOneAndUpdate).toHaveBeenCalledWith(
        { userId },
        { $set: updates },
        { upsert: true, returnDocument: 'after', runValidators: true }
      );
    });

    it('fills only the fields not given with defaults when creating (no $set/$setOnInsert conflict)', async () => {
      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue({ userId, defaultTone: 'concise', signature: '', learningEmailCount: 5 });

      await PreferenceService.updateUserPreferences(userId, { defaultTone: 'concise' });

      expect(UserPreference.findOneAndUpdate).toHaveBeenCalledWith(
        { userId },
        { $set: { defaultTone: 'concise' }, $setOnInsert: { signature: '', learningEmailCount: 5 } },
        { upsert: true, returnDocument: 'after', runValidators: true }
      );
    });

    it('keeps multi-line signatures as given', async () => {
      const signature = 'Best regards,\nJohn Doe\n+1 (555) 123-4567';
      (UserPreference.findOneAndUpdate as unknown as Mock).mockResolvedValue({ userId, defaultTone: 'formal', signature, learningEmailCount: 5 });

      const result = await PreferenceService.updateUserPreferences(userId, { signature });

      expect(result.signature).toBe(signature);
      expect((UserPreference.findOneAndUpdate as unknown as Mock).mock.calls[0][1].$set).toEqual({ signature });
    });

    it('reports database and validation errors as internal errors', async () => {
      (UserPreference.findOneAndUpdate as unknown as Mock).mockRejectedValue(new Error('Database update failed'));

      await expect(PreferenceService.updateUserPreferences(userId, { defaultTone: 'friendly' })).rejects.toThrow(InternalServerError);
    });
  });
});
