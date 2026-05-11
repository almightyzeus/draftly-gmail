import { Response } from 'express';
import { PreferenceService } from '../services/preferenceService.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Get user preferences
 */
export const getUserPreferences = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const preferences = await PreferenceService.getUserPreferences(userId);

    res.json({
      defaultTone: preferences.defaultTone,
      signature: preferences.signature,
      learningEmailCount: preferences.learningEmailCount,
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Update user preferences
 */
export const updateUserPreferences = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const { defaultTone, signature, learningEmailCount } = req.body;

    if (defaultTone && !['formal', 'concise', 'friendly'].includes(defaultTone)) {
      return res.status(400).json({ error: 'defaultTone must be formal, concise, or friendly' });
    }

    const preferences = await PreferenceService.updateUserPreferences(userId, {
      ...(defaultTone && { defaultTone }),
      ...(typeof signature === 'string' && { signature }),
      ...(learningEmailCount !== undefined && { learningEmailCount }),
    });

    res.json({
      defaultTone: preferences.defaultTone,
      signature: preferences.signature,
      learningEmailCount: preferences.learningEmailCount,
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Generic error handler for preference controller
 */
function handleError(error: any, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
  } else {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Preference controller error');
    res.status(500).json({ error: 'Failed to process preferences' });
  }
}
