import { UserPreference, IUserPreference, ToneType } from '../models/UserPreference.js';
import { logger } from '../utils/logger.js';
import { InternalServerError } from '../utils/errors.js';

type PreferenceFields = {
  defaultTone: ToneType;
  signature: string;
  learningEmailCount: number;
};

/** Values for a user who has never saved preferences (same as at registration). */
export const DEFAULT_PREFERENCES: PreferenceFields = {
  defaultTone: 'formal',
  signature: '',
  learningEmailCount: 5,
};

/**
 * PreferenceService - Handles user preferences
 *
 * Registration creates a preference document, but reads and writes never
 * depend on it: a missing document is created with the defaults (atomically,
 * via upsert), so the Preferences page always has something to show and save.
 */
export class PreferenceService {
  /**
   * Get user preferences, creating the defaults if none are stored.
   */
  static async getUserPreferences(userId: string): Promise<IUserPreference> {
    try {
      const prefs = await UserPreference.findOneAndUpdate(
        { userId },
        { $setOnInsert: DEFAULT_PREFERENCES },
        { upsert: true, returnDocument: 'after' }
      );
      return prefs as IUserPreference;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to fetch user preferences');
      throw new InternalServerError('Failed to fetch preferences');
    }
  }

  /**
   * Update user preferences. Fields not given keep their value (or the
   * default, if the user had no preferences yet).
   */
  static async updateUserPreferences(
    userId: string,
    updates: Partial<PreferenceFields>
  ): Promise<IUserPreference> {
    try {
      // A path may not appear in both $set and $setOnInsert.
      const insertDefaults = Object.fromEntries(
        Object.entries(DEFAULT_PREFERENCES).filter(([key]) => !(key in updates))
      );

      const prefs = await UserPreference.findOneAndUpdate(
        { userId },
        {
          $set: updates,
          ...(Object.keys(insertDefaults).length > 0 && { $setOnInsert: insertDefaults }),
        },
        { upsert: true, returnDocument: 'after', runValidators: true }
      );

      logger.info({ userId }, 'User preferences updated');
      return prefs as IUserPreference;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to update preferences');
      throw new InternalServerError('Failed to update preferences');
    }
  }
}
