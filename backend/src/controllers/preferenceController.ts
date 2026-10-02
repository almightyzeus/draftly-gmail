import { Response } from 'express';
import { PreferenceService } from '../services/preferenceService.js';
import { sendError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const MAX_SIGNATURE_LENGTH = 1_000;

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
    if (signature != null && (typeof signature !== 'string' || signature.length > MAX_SIGNATURE_LENGTH)) {
      return res.status(400).json({ error: `signature must be a string of at most ${MAX_SIGNATURE_LENGTH} characters` });
    }
    if (
      learningEmailCount !== undefined &&
      (!Number.isInteger(learningEmailCount) || learningEmailCount < 1 || learningEmailCount > 20)
    ) {
      return res.status(400).json({ error: 'learningEmailCount must be an integer between 1 and 20' });
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

function handleError(error: unknown, res: Response): void {
  sendError(res, error, 'Failed to process preferences', (err, message) => logger.error(err, message));
}
