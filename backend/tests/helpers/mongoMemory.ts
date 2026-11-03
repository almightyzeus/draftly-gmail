import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * mongod's default 10s launch timeout is too short on a busy machine (e.g.
 * Windows with antivirus, or other test runs in parallel) and made suites
 * fail at random with "Instance failed to start within 10000ms".
 * vitest.config.ts sets hookTimeout above this value so the launch can finish.
 */
export const MONGO_LAUNCH_TIMEOUT_MS = 60_000;

export function startMongoMemoryServer(): Promise<MongoMemoryServer> {
  return MongoMemoryServer.create({ instance: { launchTimeout: MONGO_LAUNCH_TIMEOUT_MS } });
}
