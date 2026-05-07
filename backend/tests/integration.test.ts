import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { Draft } from '../src/models/Draft.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { ActivityLog } from '../src/models/ActivityLog.js';

vi.mock('../src/services/openaiService.js', () => ({
  OpenAIService: {
    generateDraft: vi.fn().mockResolvedValue('This is a mock generated reply.'),
  },
}));

vi.mock('../src/services/gmailService.js', async () => {
  const actual = await vi.importActual<any>('../src/services/gmailService.js');
  return {
    GmailService: {
      ...actual.GmailService,
      fetchEmails: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn().mockResolvedValue('gmail-draft-1'),
      updateDraft: vi.fn().mockResolvedValue(undefined),
      sendDraft: vi.fn().mockResolvedValue('sent-message-1'),
    },
  };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mongoServer: MongoMemoryServer;

const tokensFrom = (body: any) => ({
  accessToken: body.accessToken ?? body.tokens?.accessToken,
  refreshToken: body.refreshToken ?? body.tokens?.refreshToken,
});

describe('Integration workflows', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      GmailAccount.deleteMany({}),
      Draft.deleteMany({}),
      EmailMessage.deleteMany({}),
      UserPreference.deleteMany({}),
      ActivityLog.deleteMany({}),
    ]);
  });

  async function registerUser(email = 'test@example.com') {
    const response = await request(app).post('/api/auth/register').send({
      name: 'Test User',
      email,
      password: 'SecurePass123!',
    });
    expect(response.status).toBe(201);
    return {
      user: response.body.user,
      token: tokensFrom(response.body).accessToken,
    };
  }

  async function seedEmail(userId: string) {
    return EmailMessage.create({
      userId: new Types.ObjectId(userId),
      gmailMessageId: 'msg-1',
      threadId: 'thread-1',
      from: 'sender@example.com',
      to: 'test@example.com',
      subject: 'Question',
      snippet: 'Can you help?',
      bodyPlain: 'Can you help with this?',
      direction: 'INBOUND',
      labels: ['INBOX', 'UNREAD'],
      internalDate: new Date(),
    });
  }

  it('registers, logs in, and protects authenticated routes', async () => {
    const { token } = await registerUser();
    expect(token).toBeDefined();

    const login = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'SecurePass123!',
    });
    expect(login.status).toBe(200);
    expect(tokensFrom(login.body).accessToken).toBeDefined();

    const invalid = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'wrong-password',
    });
    expect(invalid.status).toBe(401);

    expect((await request(app).get('/api/drafts')).status).toBe(401);
    expect((await request(app).get('/api/drafts').set('Authorization', 'Bearer bad')).status).toBe(401);
  });

  it('generates, edits, approves, sends, and logs a draft', async () => {
    const { user, token } = await registerUser();
    await seedEmail(user.id);

    const generate = await request(app)
      .post('/api/drafts/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ gmailMessageId: 'msg-1', tone: 'formal' });

    expect(generate.status).toBe(201);
    expect(generate.body.status).toBe('PENDING');

    const draftId = generate.body._id;
    const edit = await request(app)
      .put(`/api/drafts/${draftId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ draftBody: 'Edited body' });
    expect(edit.status).toBe(200);
    expect(edit.body.draftBody).toBe('Edited body');

    const approve = await request(app)
      .post(`/api/drafts/${draftId}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');
    expect(approve.body.gmailDraftId).toBe('gmail-draft-1');

    const send = await request(app)
      .post(`/api/drafts/${draftId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'key-1' });
    expect(send.status).toBe(200);
    expect(send.body.status).toBe('SENT');

    const logs = await request(app).get('/api/logs').set('Authorization', `Bearer ${token}`);
    expect(logs.status).toBe(200);
    expect(logs.body.logs.length).toBeGreaterThan(0);
  });

  it('rejects drafts and prevents cross-user access', async () => {
    const user1 = await registerUser('one@example.com');
    const user2 = await registerUser('two@example.com');
    await seedEmail(user1.user.id);

    const generate = await request(app)
      .post('/api/drafts/generate')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ gmailMessageId: 'msg-1' });

    const reject = await request(app)
      .post(`/api/drafts/${generate.body._id}/reject`)
      .set('Authorization', `Bearer ${user1.token}`);
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('REJECTED');

    const crossUser = await request(app)
      .get(`/api/drafts/${generate.body._id}`)
      .set('Authorization', `Bearer ${user2.token}`);
    expect(crossUser.status).toBe(500);
  });

  it('gets and updates preferences', async () => {
    const { token } = await registerUser();

    const get = await request(app).get('/api/preferences').set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.defaultTone).toBe('formal');

    const update = await request(app)
      .put('/api/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultTone: 'friendly', signature: 'Regards', learningEmailCount: 7 });

    expect(update.status).toBe(200);
    expect(update.body.defaultTone).toBe('friendly');
    expect(update.body.signature).toBe('Regards');
  });
});
