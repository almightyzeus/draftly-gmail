import { UserPreference } from '../models/UserPreference.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, InternalServerError } from '../utils/errors.js';
/**
 * PreferenceService - Handles user preferences
 */
export class PreferenceService {
    /**
     * Get user preferences
     */
    static async getUserPreferences(userId) {
        try {
            const prefs = await UserPreference.findOne({ userId });
            if (!prefs) {
                throw new NotFoundError('User preferences not found');
            }
            return prefs;
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                throw error;
            }
            logger.error({ error, userId }, 'Failed to fetch user preferences');
            throw new InternalServerError('Failed to fetch preferences');
        }
    }
    /**
     * Update user preferences
     */
    static async updateUserPreferences(userId, updates) {
        try {
            const prefs = await UserPreference.findOneAndUpdate({ userId }, { $set: updates }, { new: true, runValidators: true });
            if (!prefs) {
                throw new NotFoundError('User preferences not found');
            }
            logger.info({ userId }, 'User preferences updated');
            return prefs;
        }
        catch (error) {
            if (error instanceof NotFoundError) {
                throw error;
            }
            logger.error({ error, userId }, 'Failed to update preferences');
            throw new InternalServerError('Failed to update preferences');
        }
    }
}
