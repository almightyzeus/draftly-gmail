import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import { redactUrl } from './utils/redact.js';
import authRoutes from './routes/authRoutes.js';
import gmailRoutes from './routes/gmailRoutes.js';
import draftRoutes from './routes/draftRoutes.js';
import preferenceRoutes from './routes/preferenceRoutes.js';
import logRoutes from './routes/logRoutes.js';

export const app: Express = express();

// Behind nginx (Docker) the client IP arrives in X-Forwarded-For.
if (env.trustProxyHops > 0) {
  app.set('trust proxy', env.trustProxyHops);
}

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

// Middleware: Logging
// Apache "combined" format, with OAuth codes/state and search queries redacted.
morgan.token('redacted-url', (req: Request) => redactUrl(req.originalUrl || req.url));
app.use(
  morgan(':remote-addr - :remote-user [:date[clf]] ":method :redacted-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// Middleware: Brute-force protection for credential endpoints only.
// Successful logins/registrations don't count, and session endpoints
// (/me, /refresh) already require a valid signed token.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per windowMs
  skipSuccessfulRequests: true,
  skip: () => env.nodeEnv === 'test',
  message: { error: 'Too many authentication attempts, please try again later' },
});

// Routes
app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
app.use('/api/auth', authRoutes);
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

  // Client errors raised by Express middleware (malformed JSON -> 400,
  // body too large -> 413) are reported as such, with a fixed message.
  const clientStatus = Number(err?.status ?? err?.statusCode);
  if (err?.expose && clientStatus >= 400 && clientStatus < 500) {
    logger.warn({ path: req.path, status: clientStatus, type: err?.type }, 'Rejected client request');
    const message =
      clientStatus === 413 ? 'Request body too large' :
      err?.type === 'entity.parse.failed' ? 'Malformed JSON body' :
      'Bad request';
    return res.status(clientStatus).json({ error: message });
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
