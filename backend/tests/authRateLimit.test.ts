import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mongoServer: MongoMemoryServer;
const originalNodeEnv = env.nodeEnv;

// The limiter is skipped in the test environment, so enable it for this file only.
// Each test file gets a fresh module graph, so the in-memory limiter store starts empty.
describe('Auth rate limiting', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    env.nodeEnv = 'development';
  });

  afterAll(async () => {
    env.nodeEnv = originalNodeEnv;
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('does not limit a normal register/login session, /me or /refresh', async () => {
    const credentials = { email: 'session@example.com', password: 'SecurePass123!' };
    const register = await request(app).post('/api/auth/register').send({ name: 'User', ...credentials });
    expect(register.status).toBe(201);
    const { accessToken, refreshToken } = register.body;

    // Well beyond the 5-attempt budget: none of these are failed credential attempts.
    for (let i = 0; i < 8; i++) {
      expect((await request(app).post('/api/auth/login').send(credentials)).status).toBe(200);
      expect(
        (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status
      ).toBe(200);
    }

    const refresh = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(200);
  });

  it('blocks repeated failed logins with a JSON 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'session@example.com', password: 'wrong-password' });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);

    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: 'session@example.com', password: 'SecurePass123!' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many authentication attempts, please try again later' });
  });
});
