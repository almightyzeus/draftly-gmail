import { Router, Request, Response } from 'express';
import { PreferenceService } from '../services/preferenceService.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const preferences = await PreferenceService.getUserPreferences(userId);

    res.json({
      defaultTone: preferences.defaultTone,
      signature: preferences.signature,
      learningEmailCount: preferences.learningEmailCount,
    });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Get preferences error');
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

router.put('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
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
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Update preferences error');
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;
