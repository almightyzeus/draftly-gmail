import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import authRoutes from './routes/authRoutes.js';
import gmailRoutes from './routes/gmailRoutes.js';
import draftRoutes from './routes/draftRoutes.js';
import preferenceRoutes from './routes/preferenceRoutes.js';
import logRoutes from './routes/logRoutes.js';

export const app: Express = express();

// Middleware: Security
app.use(helmet());

// Middleware: CORS
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  })
);

// Middleware: Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Middleware: Logging
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// Middleware: Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later',
});

// Routes
if (env.nodeEnv === 'test') {
  app.use('/api/auth', authRoutes);
} else {
  app.use('/api/auth', authLimiter, authRoutes);
}
app.use('/api/gmail', gmailRoutes);
app.use('/api/drafts', draftRoutes);
app.use('/api/preferences', preferenceRoutes);
app.use('/api/logs', logRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method,
  });
});

// Global error handler middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn(
      { error: err.message, statusCode: err.statusCode, path: req.path },
      'Application error'
    );
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error({ error: err, path: req.path }, 'Unhandled error');

  const status = 500;
  const message = 'Internal Server Error';

  res.status(status).json({
    error: message,
    ...(env.nodeEnv === 'development' && { stack: err?.stack }),
  });
});

export default app;
