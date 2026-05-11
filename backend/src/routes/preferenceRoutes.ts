import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../controllers/preferenceController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateJWT, getUserPreferences);

router.put('/', authenticateJWT, updateUserPreferences);

export default router;
