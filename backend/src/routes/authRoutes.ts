import { Router } from 'express';
import { register, login, refresh, me } from '../controllers/authController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', register);

/**
 * POST /api/auth/login
 * Login user and return JWT tokens
 */
router.post('/login', login);

/**
 * POST /api/auth/refresh
 * Rotate a refresh token into a new access/refresh token pair.
 */
router.post('/refresh', refresh);

/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
router.get('/me', authenticateJWT, me);

export default router;
