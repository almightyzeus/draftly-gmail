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
    // Bearer header only. Cookies are not accepted: they outlive logout and
    // would make state-changing endpoints reachable by cross-site requests.
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      logger.warn({ path: req.path }, 'No token provided');
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, env.jwt.accessSecret, { algorithms: ['HS256'] }) as {
      userId: string;
      email: string;
      type?: string;
      aud?: string | string[];
    };

    // Other tokens signed with the access secret (e.g. the Gmail OAuth state,
    // which travels through URLs and logs) carry a type/audience and must never
    // authenticate API requests.
    if (decoded.type !== undefined || decoded.aud !== undefined) {
      logger.warn({ path: req.path }, 'Rejected non-access token');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

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

