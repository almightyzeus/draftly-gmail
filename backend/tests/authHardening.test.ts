import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { GmailOAuthService } from '../src/services/gmailOAuthService.js';
import { logger } from '../src/utils/logger.js';
import { redactUrl } from '../src/utils/redact.js';

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let mongoServer: MongoMemoryServer;

describe('Session and OAuth hardening (HTTP)', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserPreference.deleteMany({})]);
  });

  async function registerUser() {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'User', email: 'user@example.com', password: 'SecurePass123!' });
    expect(res.status).toBe(201);
    return { userId: res.body.user.id as string, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
  }

  it('authenticates with the Bearer header but not with an access-token cookie', async () => {
    const { accessToken } = await registerUser();

    const viaHeader = await request(app).get('/api/drafts').set('Authorization', `Bearer ${accessToken}`);
    const viaCookie = await request(app).get('/api/drafts').set('Cookie', `accessToken=${accessToken}`);

    expect(viaHeader.status).toBe(200);
    expect(viaCookie.status).toBe(401);
  });

  it('refreshes from the request body only, not from a refresh-token cookie', async () => {
    const { refreshToken } = await registerUser();

    const viaCookie = await request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${refreshToken}`).send({});
    const viaBody = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(viaCookie.status).toBe(401);
    expect(viaBody.status).toBe(200);
    expect(viaBody.body.accessToken).toEqual(expect.any(String));
  });

  it('returns the consent URL over XHR, and its state cannot be used as an access token', async () => {
    const { userId, accessToken } = await registerUser();

    const res = await request(app).get('/api/gmail/oauth/url').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    const state = url.searchParams.get('state')!;
    expect(GmailOAuthService.verifyOAuthStateToken(state)).toBe(userId);

    const stateAsBearer = await request(app).get('/api/drafts').set('Authorization', `Bearer ${state}`);
    expect(stateAsBearer.status).toBe(401);
  });

  it('requires the Bearer header for the consent URL; the cookie-based redirect endpoint is gone', async () => {
    const { accessToken } = await registerUser();

    expect((await request(app).get('/api/gmail/oauth/url')).status).toBe(401);
    expect(
      (await request(app).get('/api/gmail/oauth/url').set('Cookie', `accessToken=${accessToken}`)).status
    ).toBe(401);
    expect(
      (await request(app).get('/api/gmail/oauth/connect').set('Authorization', `Bearer ${accessToken}`)).status
    ).toBe(404);
  });

  it('keeps OAuth codes, state and search queries out of the request log', async () => {
    const { accessToken } = await registerUser();
    vi.mocked(logger.info).mockClear();

    await request(app).get('/api/gmail/oauth/callback?code=secret-code-123&state=secret-state-456');
    await request(app)
      .get('/api/gmail/emails?q=from%3Aboss%40example.com&limit=5')
      .set('Authorization', `Bearer ${accessToken}`);

    const accessLines = vi
      .mocked(logger.info)
      .mock.calls.map(([line]) => line)
      .filter((line): line is string => typeof line === 'string' && line.includes('HTTP/'));
    const callbackLine = accessLines.find((line) => line.includes('/api/gmail/oauth/callback'));
    const searchLine = accessLines.find((line) => line.includes('/api/gmail/emails'));

    expect(callbackLine).toBeDefined();
    expect(callbackLine).not.toContain('secret-code-123');
    expect(callbackLine).not.toContain('secret-state-456');
    expect(searchLine).toBeDefined();
    expect(searchLine).not.toContain('boss');
    expect(searchLine).toContain('limit=5');
  });
});

describe('redactUrl', () => {
  it.each([
    ['/api/gmail/oauth/callback?code=abc&state=def', '/api/gmail/oauth/callback?code=%5Bredacted%5D&state=%5Bredacted%5D'],
    ['/api/gmail/emails?q=from%3Aalice&pageToken=tok&limit=20', '/api/gmail/emails?q=%5Bredacted%5D&pageToken=tok&limit=20'],
    ['/api/drafts?status=PENDING', '/api/drafts?status=PENDING'],
    ['/health', '/health'],
  ])('redacts %s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
});
