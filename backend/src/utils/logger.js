import pino from 'pino';
import { env } from '../config/env.js';
const transport = env.nodeEnv === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
            colorize: true,
            singleLine: true,
        },
    };
export const logger = pino({
    level: env.nodeEnv === 'production' ? 'info' : 'debug',
}, transport ? pino.transport(transport) : undefined);
