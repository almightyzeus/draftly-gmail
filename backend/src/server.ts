import mongoose from 'mongoose';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function startServer() {
  try {
    // Connect to MongoDB
    logger.info(`Connecting to MongoDB: ${env.mongodbUri.replace(/:[^/]*@/, ':***@')}`);
    await mongoose.connect(env.mongodbUri);
    logger.info('MongoDB connected');

    // Start Express server
    const server = app.listen(env.port, () => {
      logger.info(`Server running on http://localhost:${env.port} in ${env.nodeEnv} mode`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await mongoose.connection.close();
        logger.info('Server and database connections closed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after 10 seconds');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

startServer();
