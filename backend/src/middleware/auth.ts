import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { UnauthorizedError } from '../utils/errors.js';

export interface AuthRequest extends Request {
  userId?: string;
  email?: string;
}

export const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Check Authorization header first
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fallback to cookie if no header
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      logger.warn({ path: req.path }, 'No token provided');
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, env.jwt.accessSecret) as {
      userId: string;
      email: string;
    };

    req.userId = decoded.userId;
    req.email = decoded.email;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn({ path: req.path }, 'Token expired');
      return res.status(401).json({ error: 'Token expired' });
    }

    logger.warn({ error, path: req.path }, 'Invalid token');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

