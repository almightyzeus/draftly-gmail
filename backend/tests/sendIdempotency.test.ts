import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Draft } from '../src/models/Draft.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { ActivityLog } from '../src/models/ActivityLog.js';
import { GmailService } from '../src/services/gmailService.js';
import { DraftService } from '../src/services/draftService.js';

vi.mock('../src/services/gmailService.js', async () => {
  const actual = await vi.importActual<any>('../src/services/gmailService.js');
  return {
    GmailService: {
      ...actual.GmailService,
      sendDraft: vi.fn(),
    },
  };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const gmailSend = GmailService.sendDraft as unknown as Mock;

let mongoServer: MongoMemoryServer;

describe('Durable send idempotency (real MongoDB)', () => {
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
    await Promise.all([
      User.deleteMany({}),
      Draft.deleteMany({}),
      EmailMessage.deleteMany({}),
      ActivityLog.deleteMany({}),
    ]);
    gmailSend.mockReset();
    gmailSend.mockResolvedValue('sent-message-1');
  });

  async function registerUser(email = 'sender@example.com') {
    const response = await request(app).post('/api/auth/register').send({
      name: 'Test User',
      email,
      password: 'SecurePass123!',
    });
    expect(response.status).toBe(201);
    return {
      userId: response.body.user.id as string,
      token: (response.body.accessToken ?? response.body.tokens?.accessToken) as string,
    };
  }

  async function seedDraft(userId: string, overrides: Record<string, any> = {}) {
    return Draft.create({
      userId: new Types.ObjectId(userId),
      gmailMessageId: 'msg-1',
      replyToGmailMessageId: 'msg-1',
      threadId: 'thread-1',
      tone: 'formal',
      promptVersion: '1.0',
      draftBody: 'Approved reply',
      status: 'APPROVED',
      approvedAt: new Date(),
      gmailDraftId: 'gmail-draft-1',
      ...overrides,
    });
  }

  const send = (draftId: string, token: string, key?: string) => {
    const req = request(app).post(`/api/drafts/${draftId}/send`).set('Authorization', `Bearer ${token}`);
    return key ? req.set('Idempotency-Key', key).send({}) : req.send({});
  };

  it('first send claims the draft, calls Gmail once, and persists the result', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);

    const res = await send(draft._id.toString(), token, 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SENT');
    expect(res.body.sentGmailMessageId).toBe('sent-message-1');
    expect(gmailSend).toHaveBeenCalledTimes(1);
    expect(gmailSend).toHaveBeenCalledWith(userId, 'gmail-draft-1', 'thread-1');

    const stored = await Draft.findById(draft._id).lean();
    expect(stored?.status).toBe('SENT');
    expect(stored?.sendIdempotencyKey).toBe('key-1');
    expect(stored?.sentAt).toBeInstanceOf(Date);
    expect(stored?.auditTrail.filter((e) => e.action === 'SENT')).toHaveLength(1);
    expect(await ActivityLog.countDocuments({ action: 'DRAFT_SENT' })).toBe(1);
  });

  it('same-key retry after success returns the stored result without calling Gmail', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);

    const first = await send(draft._id.toString(), token, 'key-1');
    const retry = await send(draft._id.toString(), token, 'key-1');

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('SENT');
    expect(retry.body.sentGmailMessageId).toBe(first.body.sentGmailMessageId);
    expect(gmailSend).toHaveBeenCalledTimes(1);
    const stored = await Draft.findById(draft._id).lean();
    expect(stored?.auditTrail.filter((e) => e.action === 'SENT')).toHaveLength(1);
  });

  it('still accepts the legacy body idempotencyKey', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);

    const res = await request(app)
      .post(`/api/drafts/${draft._id}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'body-key' });

    expect(res.status).toBe(200);
    expect((await Draft.findById(draft._id).lean())?.sendIdempotencyKey).toBe('body-key');
  });

  it('requires an idempotency key', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);

    const res = await send(draft._id.toString(), token);

    expect(res.status).toBe(400);
    expect(gmailSend).not.toHaveBeenCalled();
  });

  it.each([
    ['the same key', (i: number) => 'shared-key'],
    ['different keys', (i: number) => `key-${i}`],
  ])('concurrent requests with %s call Gmail exactly once', async (_label, keyFor) => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);

    // Hold Gmail open so every request arrives while the first send is in flight.
    let releaseGmail!: (id: string) => void;
    gmailSend.mockImplementation(() => new Promise<string>((resolve) => (releaseGmail = resolve)));

    const settled: number[] = [];
    const requests = Array.from({ length: 5 }, (_, i) =>
      send(draft._id.toString(), token, keyFor(i)).then((res) => {
        settled.push(res.status);
        return res;
      })
    );

    await vi.waitFor(() => expect(gmailSend).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(settled).toHaveLength(4));
    releaseGmail('sent-message-1');
    const responses = await Promise.all(requests);

    expect(gmailSend).toHaveBeenCalledTimes(1);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect((await Draft.findById(draft._id).lean())?.status).toBe('SENT');
  });

  it('a different key cannot re-send an already SENT draft', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);

    await send(draft._id.toString(), token, 'key-1');
    const res = await send(draft._id.toString(), token, 'key-2');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been sent/);
    expect(gmailSend).toHaveBeenCalledTimes(1);
  });

  it('never sends a draft that was already SENT before the request', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId, {
      status: 'SENT',
      sentAt: new Date(),
      sentGmailMessageId: 'old-sent',
      sendIdempotencyKey: null,
    });

    const res = await send(draft._id.toString(), token, 'new-key');

    expect(res.status).toBe(409);
    expect(gmailSend).not.toHaveBeenCalled();
  });

  it('rejects cross-user sends with 404 and leaves the draft untouched', async () => {
    const owner = await registerUser('owner@example.com');
    const attacker = await registerUser('attacker@example.com');
    const draft = await seedDraft(owner.userId);

    const res = await send(draft._id.toString(), attacker.token, 'key-1');

    expect(res.status).toBe(404);
    expect(gmailSend).not.toHaveBeenCalled();
    const stored = await Draft.findById(draft._id).lean();
    expect(stored?.status).toBe('APPROVED');
    expect(stored?.sendIdempotencyKey).toBeNull();
  });

  it.each(['PENDING', 'REJECTED'])('refuses to send a %s draft', async (status) => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId, { status });

    const res = await send(draft._id.toString(), token, 'key-1');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Must be APPROVED/);
    expect(gmailSend).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed draft id', async () => {
    const { token } = await registerUser();

    const res = await send('not-an-object-id', token, 'key-1');

    expect(res.status).toBe(404);
    expect(gmailSend).not.toHaveBeenCalled();
  });

  it('releases the claim when Gmail fails so the same key can be retried', async () => {
    const { userId, token } = await registerUser();
    const draft = await seedDraft(userId);
    gmailSend.mockRejectedValueOnce(new Error('Gmail unavailable'));

    const failed = await send(draft._id.toString(), token, 'key-1');
    expect(failed.status).toBe(500);
    const afterFailure = await Draft.findById(draft._id).lean();
    expect(afterFailure?.status).toBe('APPROVED');
    expect(afterFailure?.sendIdempotencyKey).toBeNull();

    const retry = await send(draft._id.toString(), token, 'key-1');
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('SENT');
    expect(gmailSend).toHaveBeenCalledTimes(2);
  });

  it('blocks other keys while a claim is fresh but lets a stranded claim expire', async () => {
    const { userId, token } = await registerUser();
    const fresh = await seedDraft(userId, {
      sendIdempotencyKey: 'in-flight',
      sendClaimedAt: new Date(),
    });
    const stranded = await seedDraft(userId, {
      threadId: 'thread-2',
      sendIdempotencyKey: 'crashed',
      sendClaimedAt: new Date(Date.now() - DraftService.SEND_CLAIM_LEASE_MS - 1000),
    });

    const blocked = await send(fresh._id.toString(), token, 'other-key');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/in progress/);

    const recovered = await send(stranded._id.toString(), token, 'retry-key');
    expect(recovered.status).toBe(200);
    expect(gmailSend).toHaveBeenCalledTimes(1);
    expect((await Draft.findById(stranded._id).lean())?.sendIdempotencyKey).toBe('retry-key');
  });
});
