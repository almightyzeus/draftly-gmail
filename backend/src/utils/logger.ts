import pino from 'pino';
import { env } from '../config/env.js';

const DEFAULT_LEVELS = { production: 'info', development: 'debug', test: 'silent' } as const;

/**
 * Log level: LOG_LEVEL if set, otherwise info in production, debug in
 * development, and silent in tests (they exercise failure paths on purpose,
 * so their logs are only noise; run `LOG_LEVEL=debug npm test` to see them).
 */
const level = process.env.LOG_LEVEL || DEFAULT_LEVELS[env.nodeEnv] || 'debug';

const transport = env.nodeEnv === 'production' || level === 'silent'
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
      },
    };

export const logger = pino({ level }, transport ? pino.transport(transport) : undefined);
