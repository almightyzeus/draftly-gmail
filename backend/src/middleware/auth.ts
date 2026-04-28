import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
  email?: string;
}

export const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    logger.warn({ path: req.path }, 'No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, env.jwt.accessSecret) as {
      userId: string;
      email: string;
    };
    req.userId = decoded.userId;
    req.email = decoded.email;
    next();
  } catch (error) {
    logger.warn({ error }, 'Invalid or expired token');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
