import { Router } from 'express';
import { getUserLogs, getEntityLogs } from '../controllers/logController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateJWT, getUserLogs);

router.get('/:entityType/:entityId', authenticateJWT, getEntityLogs);

export default router;
