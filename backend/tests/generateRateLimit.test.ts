import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { DraftService } from '../src/services/draftService.js';

vi.mock('../src/services/draftService.js', () => ({
  DraftService: {
    generateDraft: vi.fn().mockResolvedValue({ _id: 'draft-1' }),
    toResponse: vi.fn(async (_userId: string, draft: unknown) => draft),
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const originalNodeEnv = env.nodeEnv;
const tokenFor = (userId: string) =>
  jwt.sign({ userId, email: `${userId}@example.com` }, env.jwt.accessSecret, { expiresIn: '15m', algorithm: 'HS256' });

// The limiter is skipped in the test environment; enable it for this file only.
describe('Draft generation rate limit (per user)', () => {
  beforeAll(() => {
    env.nodeEnv = 'development';
  });

  afterAll(() => {
    env.nodeEnv = originalNodeEnv;
  });

  const generate = (token: string) =>
    request(app).post('/api/drafts/generate').set('Authorization', `Bearer ${token}`).send({ gmailMessageId: 'msg-1' });

  it('allows 10 generations per minute per user, then returns a JSON 429', async () => {
    const token = tokenFor('507f191e810c19729de860ea');

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await generate(token)).status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statuses[10]).toBe(429);
    expect(DraftService.generateDraft).toHaveBeenCalledTimes(10);
    expect((await generate(token)).body).toEqual({
      error: 'Too many draft generations. Please wait a minute and try again.',
    });
  });

  it('counts each user separately', async () => {
    expect((await generate(tokenFor('507f191e810c19729de860eb'))).status).toBe(201);
  });

  it('rejects unauthenticated requests before counting them', async () => {
    expect((await request(app).post('/api/drafts/generate').send({ gmailMessageId: 'msg-1' })).status).toBe(401);
  });
});
