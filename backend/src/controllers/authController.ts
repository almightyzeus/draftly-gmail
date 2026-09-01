import { Response } from 'express';
import { AuthService } from '../services/authService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

/**
 * Handle user registration
 */
export const register = async (req: any, res: Response) => {
  try {
    const { name, email, password } = req.body;

    const result = await AuthService.register(name, email, password);

    res.status(201).json({
      message: 'User registered successfully',
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Handle user login
 */
export const login = async (req: any, res: Response) => {
  try {
    const { email, password } = req.body;

    const result = await AuthService.login(email, password);

    res.json({
      message: 'Login successful',
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Exchange a refresh token for a new access/refresh token pair.
 * The cookie fallback supports the full-page Gmail OAuth redirect flow.
 */
export const refresh = async (req: any, res: Response) => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
    const tokens = await AuthService.refreshTokens(refreshToken);
    res.json(tokens);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Get authenticated user info
 */
export const me = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await AuthService.getUserById(req.userId);

    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        googleConnected: user.googleConnected || false,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Generic error handler for auth controller
 */
function handleError(error: any, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
}

