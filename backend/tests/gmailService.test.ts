import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { GmailService } from '../src/services/gmailService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { User } from '../src/models/User.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { CryptoService } from '../src/services/cryptoService.js';

const mocks = vi.hoisted(() => ({
  gmail: vi.fn(),
  setCredentials: vi.fn(),
  createOAuth2Client: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: mocks.gmail,
    auth: {
      OAuth2: vi.fn(() => ({ setCredentials: mocks.setCredentials, credentials: {} })),
    },
  },
}));

vi.mock('../src/services/googleClient.js', () => ({
  createOAuth2Client: mocks.createOAuth2Client,
}));

vi.mock('../src/models/GmailAccount.js', () => ({
  GmailAccount: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../src/models/User.js', () => ({
  User: { findByIdAndUpdate: vi.fn() },
}));

vi.mock('../src/models/EmailMessage.js', () => ({
  EmailMessage: {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const userId = new Types.ObjectId().toString();
const account = {
  userId: new Types.ObjectId(userId),
  gmailEmail: 'user@gmail.com',
  accessTokenEnc: 'access',
  refreshTokenEnc: 'refresh',
  tokenExpiry: new Date(Date.now() + 3600000),
};

describe('GmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(CryptoService, 'decryptToken').mockReturnValue('token');
    (GmailAccount.findOne as unknown as Mock).mockResolvedValue(account);
    
    // Default mock for createOAuth2Client - returns a mock client with credentials property and 'on' method
    const defaultMockClient = {
      setCredentials: vi.fn(),
      on: vi.fn(),
      credentials: {
        access_token: 'token',
        refresh_token: 'token',
        expiry_date: Date.now() + 3600000,
      },
    };
    mocks.createOAuth2Client.mockReturnValue(defaultMockClient);
  });

  it('throws when Gmail is not connected', async () => {
    (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);
    await expect(GmailService.fetchEmails(userId, { unread: true })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Gmail account not connected',
    });
  });

  it('fetches and stores Gmail messages', async () => {
    mocks.gmail.mockReturnValue({
      users: {
        messages: {
          list: vi.fn().mockResolvedValue({ data: { messages: [{ id: 'msg-1' }] } }),
          get: vi.fn().mockResolvedValue({
            data: {
              id: 'msg-1',
              threadId: 'thread-1',
              snippet: 'hello',
              labelIds: ['INBOX', 'UNREAD'],
              payload: {
                headers: [
                  { name: 'Subject', value: 'Question' },
                  { name: 'From', value: 'sender@example.com' },
                  { name: 'To', value: 'user@gmail.com' },
                  { name: 'Date', value: new Date().toUTCString() },
                  { name: 'Message-ID', value: '<sender-message@example.com>' },
                  { name: 'References', value: '<earlier-message@example.com>' },
                ],
                body: { data: Buffer.from('Hello').toString('base64') },
              },
            },
          }),
        },
      },
    });
    (EmailMessage.findOneAndUpdate as unknown as Mock).mockResolvedValue({
      _id: new Types.ObjectId(),
      gmailMessageId: 'msg-1',
      threadId: 'thread-1',
      from: 'sender@example.com',
      to: 'user@gmail.com',
      subject: 'Question',
      snippet: 'hello',
      direction: 'INBOUND',
      internalDate: new Date(),
      labels: ['INBOX'],
    });

    const { emails, nextPageToken } = await GmailService.fetchEmails(userId, { unread: true, limit: 1 });
    expect(emails).toHaveLength(1);
    expect(nextPageToken).toBeNull();
    expect(EmailMessage.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        rfcMessageId: '<sender-message@example.com>',
        references: '<earlier-message@example.com>',
      }),
      expect.any(Object)
    );
  });

  describe('syncThread (whole thread from Gmail)', () => {
    const gmailMessage = (id: string, from: string, labelIds: string[], body = `Body of ${id}`) => ({
      id,
      threadId: 'thread-1',
      snippet: body,
      labelIds,
      internalDate: String(Date.parse('2026-11-01T10:00:00Z')),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'Subject', value: 'Project' },
          { name: 'From', value: from },
          { name: 'To', value: 'someone@example.com' },
          { name: 'Message-ID', value: `<${id}@example.com>` },
        ],
        body: { data: Buffer.from(body).toString('base64') },
      },
    });
    let threadsGet: Mock;

    beforeEach(() => {
      threadsGet = vi.fn();
      mocks.gmail.mockReturnValue({ users: { threads: { get: threadsGet } } });
      (EmailMessage.findOneAndUpdate as unknown as Mock).mockResolvedValue({});
    });

    it("caches every message of the thread, including archived ones and the user's own replies", async () => {
      threadsGet.mockResolvedValue({
        data: {
          messages: [
            gmailMessage('archived', 'Sender <sender@example.com>', []),
            gmailMessage('my-reply', 'User <user@gmail.com>', ['SENT']),
            gmailMessage('latest', 'Sender <sender@example.com>', ['INBOX', 'UNREAD']),
          ],
        },
      });

      await expect(GmailService.syncThread(userId, 'thread-1')).resolves.toBe(3);

      expect(threadsGet).toHaveBeenCalledWith({ userId: 'me', id: 'thread-1', format: 'full' });
      const updates = (EmailMessage.findOneAndUpdate as unknown as Mock).mock.calls;
      expect(updates.map(([filter]) => filter)).toEqual(
        ['archived', 'my-reply', 'latest'].map((id) => ({ userId: new Types.ObjectId(userId), gmailMessageId: id }))
      );
      const byId = Object.fromEntries(updates.map(([, update]) => [update.gmailMessageId, update]));
      expect(byId['archived']).toMatchObject({ direction: 'INBOUND', labels: [], bodyPlain: 'Body of archived', rfcMessageId: '<archived@example.com>' });
      expect(byId['my-reply']).toMatchObject({ direction: 'OUTBOUND', labels: ['SENT'] });
      expect(byId['latest']).toMatchObject({ direction: 'INBOUND', labels: ['INBOX', 'UNREAD'] });
      expect(updates[0][2]).toEqual({ upsert: true, returnDocument: 'after' });
    });

    it('caches only the newest messages of a very long thread', async () => {
      const total = GmailService.MAX_SYNCED_THREAD_MESSAGES + 5;
      threadsGet.mockResolvedValue({
        data: { messages: Array.from({ length: total }, (_, i) => gmailMessage(`m-${i}`, 'sender@example.com', ['INBOX'])) },
      });

      await expect(GmailService.syncThread(userId, 'thread-1')).resolves.toBe(GmailService.MAX_SYNCED_THREAD_MESSAGES);

      const ids = (EmailMessage.findOneAndUpdate as unknown as Mock).mock.calls.map(([filter]) => filter.gmailMessageId);
      expect(ids).not.toContain('m-0');
      expect(ids).toContain(`m-${total - 1}`);
    });

    it('handles an empty thread', async () => {
      threadsGet.mockResolvedValue({ data: {} });
      await expect(GmailService.syncThread(userId, 'thread-1')).resolves.toBe(0);
      expect(EmailMessage.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('requires a connected Gmail account', async () => {
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);
      await expect(GmailService.syncThread(userId, 'thread-1')).rejects.toMatchObject({ statusCode: 409 });
      expect(threadsGet).not.toHaveBeenCalled();
    });
  });

  it('gets stored email and thread emails', async () => {
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue({
      _id: 'email-id',
      gmailMessageId: 'msg-1',
      threadId: 'thread-1',
      from: 'sender@example.com',
      to: 'user@gmail.com',
      subject: 'Subject',
      snippet: 'Snippet',
      bodyPlain: 'Body',
      bodyHtml: '<p>Body</p>',
      direction: 'INBOUND',
      internalDate: new Date(),
      labels: ['INBOX'],
    });

    const email = await GmailService.getEmail(userId, 'msg-1');
    expect(email.gmailMessageId).toBe('msg-1');

    (EmailMessage.find as unknown as Mock).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([email]),
    });
    await expect(GmailService.fetchThreadEmails(userId, 'thread-1')).resolves.toHaveLength(1);
  });

  it('creates, updates, sends, and deletes Gmail drafts', async () => {
    const draftApi = {
      create: vi.fn().mockResolvedValue({ data: { id: 'draft-1' } }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      send: vi.fn().mockResolvedValue({ data: { id: 'sent-1' } }),
      delete: vi.fn().mockResolvedValue({}),
    };
    mocks.gmail.mockReturnValue({ users: { drafts: draftApi } });

    await expect(
      GmailService.createDraft(
        userId,
        { to: ['to@example.com'], cc: ['"Team, Ops" <ops@example.com>', 'bob@example.com'] },
        'Subject',
        'Body',
        'thread-1',
        '<rfc-message@example.com>',
        '<older@example.com> <rfc-message@example.com>'
      )
    ).resolves.toBe('draft-1');

    const rawMessage = Buffer.from(draftApi.create.mock.calls[0][0].requestBody.message.raw, 'base64').toString('utf8');
    expect(rawMessage).toContain('In-Reply-To: <rfc-message@example.com>');
    expect(rawMessage).toContain('References: <older@example.com> <rfc-message@example.com>');
    expect(rawMessage).not.toContain('In-Reply-To: draft-1');
    expect(rawMessage).toContain(`From: ${account.gmailEmail}`);
    expect(rawMessage).toContain('To: to@example.com\r\n');
    expect(rawMessage).toContain('Cc: "Team, Ops" <ops@example.com>,\r\n bob@example.com\r\n');
    expect(GmailAccount.findOne).toHaveBeenLastCalledWith({ userId: new Types.ObjectId(userId), revokedAt: null });
    await expect(GmailService.updateDraft(userId, 'draft-1', 'Body 2', { to: ['to@example.com'], cc: [] }, 'Subject', 'thread-1')).resolves.toBeUndefined();
    const updatedRaw = Buffer.from(draftApi.update.mock.calls[0][0].requestBody.message.raw, 'base64').toString('utf8');
    expect(updatedRaw).toContain(Buffer.from('Body 2').toString('base64'));
    expect(updatedRaw).not.toContain('Cc:');
    await expect(GmailService.sendDraft(userId, 'draft-1', 'thread-1')).resolves.toBe('sent-1');
    await expect(GmailService.deleteDraft(userId, 'draft-1')).resolves.toBeUndefined();
  });

  it('returns legacy cached HTML (stored as plain text) as HTML', async () => {
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue({
      _id: 'email-id',
      gmailMessageId: 'msg-legacy',
      threadId: 't',
      from: 'a@example.com',
      to: 'user@gmail.com',
      subject: 'Legacy',
      snippet: 's',
      bodyPlain: '<html><body><p>Legacy</p></body></html>',
      bodyHtml: undefined,
      direction: 'INBOUND',
      internalDate: new Date(),
      labels: ['INBOX'],
    });

    const email = await GmailService.getEmail(userId, 'msg-legacy');

    expect(email.bodyHtml).toBe('<html><body><p>Legacy</p></body></html>');
    expect(email.bodyPlain).toBe('');
  });

  it('uses stored RFC headers instead of Gmail internal IDs for reply metadata', async () => {
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue({
      gmailMessageId: 'gmail-internal-id',
      rfcMessageId: '<rfc-message@example.com>',
      references: '<older@example.com>',
    });

    const metadata = await GmailService.getReplyMetadata(userId, 'gmail-internal-id');

    expect(metadata).toEqual({
      inReplyTo: '<rfc-message@example.com>',
      references: '<older@example.com> <rfc-message@example.com>',
    });
    expect(metadata.references).not.toContain('gmail-internal-id');
  });

  it('backfills RFC reply metadata for a legacy cached email', async () => {
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue({ gmailMessageId: 'gmail-internal-id' });
    mocks.gmail.mockReturnValue({
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: {
              payload: {
                headers: [
                  { name: 'Message-ID', value: '<rfc-message@example.com>' },
                  { name: 'References', value: '<older@example.com>' },
                ],
              },
            },
          }),
        },
      },
    });

    await expect(GmailService.getReplyMetadata(userId, 'gmail-internal-id')).resolves.toEqual({
      inReplyTo: '<rfc-message@example.com>',
      references: '<older@example.com> <rfc-message@example.com>',
    });
    expect(EmailMessage.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ gmailMessageId: 'gmail-internal-id' }),
      { rfcMessageId: '<rfc-message@example.com>', references: '<older@example.com>' },
      { returnDocument: 'after' }
    );
  });

  describe('message direction and date', () => {
    const listOne = (message: any) => {
      mocks.gmail.mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({ data: { messages: [{ id: message.id }] } }),
            get: vi.fn().mockResolvedValue({ data: message }),
          },
        },
      });
      (EmailMessage.findOneAndUpdate as unknown as Mock).mockImplementation((_f: any, update: any) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...update })
      );
    };
    const message = (from: string, extra: Record<string, any> = {}) => ({
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX'],
      payload: { headers: [{ name: 'From', value: from }, { name: 'Date', value: 'not a real date' }], body: { data: '' } },
      ...extra,
    });
    const savedUpdate = () => (EmailMessage.findOneAndUpdate as unknown as Mock).mock.calls[0][1];

    it.each([
      ['a look-alike address containing the user address', 'evil-user@gmail.com', 'INBOUND'],
      ['a display name containing the user address', '"user@gmail.com" <attacker@example.com>', 'INBOUND'],
      ['the exact user address', 'User <USER@gmail.com>', 'OUTBOUND'],
      ['the bare user address', 'user@gmail.com', 'OUTBOUND'],
    ])('classifies %s correctly', async (_label, from, direction) => {
      listOne(message(from));

      await GmailService.fetchEmails(userId, {});

      expect(savedUpdate().direction).toBe(direction);
    });

    it('keeps a message from someone else INBOUND even when the user is also in To/Cc with others', async () => {
      const groupMail = message('Alice <alice@example.com>');
      groupMail.payload.headers.push(
        { name: 'To', value: 'User <user@gmail.com>, Bob <bob@example.com>' },
        { name: 'Cc', value: 'user@gmail.com, carol@example.com' }
      );
      listOne(groupMail);

      await GmailService.fetchEmails(userId, {});

      expect(savedUpdate().direction).toBe('INBOUND');
    });

    it('stores a single-part text/html email as HTML, not as plain text', async () => {
      const html = '<html><body><p>Hello</p></body></html>';
      listOne({
        ...message('a@example.com'),
        payload: {
          mimeType: 'text/html',
          headers: [{ name: 'From', value: 'a@example.com' }],
          body: { data: Buffer.from(html).toString('base64') },
        },
      });

      await GmailService.fetchEmails(userId, {});

      expect(savedUpdate().bodyHtml).toBe(html);
      expect(savedUpdate().bodyPlain).toBe('');
    });

    it('treats anything Gmail labels SENT as OUTBOUND', async () => {
      listOne(message('someone-else@example.com', { labelIds: ['SENT'] }));

      await GmailService.fetchEmails(userId, {});

      expect(savedUpdate().direction).toBe('OUTBOUND');
    });

    it('uses Gmail internalDate, so an unparseable Date header does not drop the message', async () => {
      listOne(message('a@example.com', { internalDate: '1700000000000' }));

      const { emails } = await GmailService.fetchEmails(userId, {});

      expect(emails).toHaveLength(1);
      expect(savedUpdate().internalDate).toEqual(new Date(1700000000000));
    });

    it('falls back to a valid date when neither internalDate nor the Date header is usable', async () => {
      listOne(message('a@example.com'));

      await GmailService.fetchEmails(userId, {});

      expect(Number.isNaN(savedUpdate().internalDate.getTime())).toBe(false);
    });
  });

  describe('search and pagination', () => {
    const gmailMessage = (id: string) => ({
      data: {
        id,
        threadId: `thread-${id}`,
        snippet: 'hello',
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'Subject', value: 'Quarterly report' },
            { name: 'From', value: 'alice@example.com' },
            { name: 'Message-ID', value: `<${id}@example.com>` },
          ],
          body: { data: Buffer.from('Body').toString('base64') },
        },
      },
    });

    let list: Mock;
    let get: Mock;

    beforeEach(() => {
      list = vi.fn().mockResolvedValue({ data: { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'token-2' } });
      get = vi.fn().mockImplementation(({ id }: { id: string }) => Promise.resolve(gmailMessage(id)));
      mocks.gmail.mockReturnValue({ users: { messages: { list, get } } });
      (EmailMessage.findOneAndUpdate as unknown as Mock).mockImplementation((_filter: any, update: any) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...update })
      );
    });

    const listArgs = () => list.mock.calls[0][0];

    it('default listing applies the inbox noise filters and no page token', async () => {
      await GmailService.fetchEmails(userId, { label: 'INBOX', limit: 20 });

      expect(listArgs()).toEqual({ userId: 'me', q: expect.stringMatching(/^label:INBOX /), maxResults: 20 });
      expect(listArgs().q).toContain('-category:promotions');
      expect(listArgs()).not.toHaveProperty('pageToken');
    });

    it.each([
      ['sender', 'from:alice@example.com'],
      ['subject', 'subject:"quarterly report"'],
      ['plain text', 'budget approval'],
      ['combined Gmail syntax', 'from:alice has:attachment after:2024/01/01 OR bob'],
    ])('forwards a %s search verbatim after the structural filters', async (_label, q) => {
      await GmailService.fetchEmails(userId, { label: 'INBOX', q });

      expect(listArgs().q).toBe(`label:INBOX ${q}`);
    });

    it('keeps label and unread filters ahead of an unbalanced user quote', async () => {
      await GmailService.fetchEmails(userId, { label: 'SENT', unread: true, q: '"unterminated' });

      expect(listArgs().q).toBe('label:SENT is:unread "unterminated');
    });

    it('forwards pageToken and limit and returns nextPageToken', async () => {
      const result = await GmailService.fetchEmails(userId, { label: 'INBOX', pageToken: 'token-1', limit: 2 });

      expect(listArgs()).toMatchObject({ pageToken: 'token-1', maxResults: 2 });
      expect(result.nextPageToken).toBe('token-2');
      expect(result.emails.map((e) => e.gmailMessageId)).toEqual(['m1', 'm2']);
    });

    it('caches each listed message in MongoDB keyed by user and Gmail id', async () => {
      await GmailService.fetchEmails(userId, { label: 'INBOX', q: 'from:alice' });

      expect(EmailMessage.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(EmailMessage.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: new Types.ObjectId(userId), gmailMessageId: 'm1' },
        expect.objectContaining({ rfcMessageId: '<m1@example.com>', subject: 'Quarterly report' }),
        { upsert: true, returnDocument: 'after' }
      );
    });

    it('fetches message details in parallel (at most 10 at once) and keeps Gmail order', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
      list.mockResolvedValue({ data: { messages: ids.map((id) => ({ id })), nextPageToken: null } });
      let inFlight = 0;
      let peak = 0;
      get.mockImplementation(async ({ id }: { id: string }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Later messages answer sooner, so completion order differs from list order.
        await new Promise((resolve) => setTimeout(resolve, 30 - Number(id.slice(1))));
        inFlight--;
        return gmailMessage(id);
      });

      const result = await GmailService.fetchEmails(userId, { limit: 25 });

      expect(peak).toBe(10);
      expect(result.emails.map((e) => e.gmailMessageId)).toEqual(ids);
    });

    it('returns an empty page with the token Gmail provides', async () => {
      list.mockResolvedValue({ data: { resultSizeEstimate: 0 } });

      await expect(GmailService.fetchEmails(userId, { q: 'nothing-matches' })).resolves.toEqual({
        emails: [],
        nextPageToken: null,
      });
      expect(get).not.toHaveBeenCalled();
    });

    it('skips a message that fails to load without failing the page', async () => {
      get.mockImplementation(({ id }: { id: string }) =>
        id === 'm1' ? Promise.reject(new Error('gone')) : Promise.resolve(gmailMessage(id))
      );

      const result = await GmailService.fetchEmails(userId, {});

      expect(result.emails.map((e) => e.gmailMessageId)).toEqual(['m2']);
      expect(result.nextPageToken).toBe('token-2');
    });

    it('maps a Gmail 400 (bad query or page token) to a 400 error', async () => {
      list.mockRejectedValue(Object.assign(new Error('Invalid pageToken'), { code: 400 }));

      await expect(GmailService.fetchEmails(userId, { pageToken: 'stale' })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid Gmail search query or page token',
      });
    });

    // Shape of the googleapis error when the refresh token is rejected (seen in Docker).
    const invalidGrant = () =>
      Object.assign(new Error('invalid_grant'), {
        status: 400,
        code: 400,
        config: { url: 'https://oauth2.googleapis.com/token' },
        response: { status: 400, data: { error: 'invalid_grant', error_description: 'Bad Request' } },
      });

    it.each([
      ['a plain listing', {}],
      ['a search', { q: 'from:alice' }],
    ])('treats invalid_grant on %s as a disconnected Gmail account, not a bad search', async (_label, options) => {
      list.mockRejectedValue(invalidGrant());

      await expect(GmailService.fetchEmails(userId, options)).rejects.toMatchObject({
        statusCode: 403,
        message: 'Gmail access has expired or was revoked. Please reconnect Gmail.',
      });
      expect(GmailAccount.updateMany).toHaveBeenCalledWith(
        { userId: new Types.ObjectId(userId), revokedAt: null },
        { $set: { revokedAt: expect.any(Date) } }
      );
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(new Types.ObjectId(userId), {
        googleConnected: false,
        gmailEmail: null,
      });
    });

    it('still returns the reconnect error if the disconnect cleanup fails', async () => {
      list.mockRejectedValue(invalidGrant());
      (GmailAccount.updateMany as unknown as Mock).mockRejectedValueOnce(new Error('db down'));

      await expect(GmailService.fetchEmails(userId, {})).rejects.toMatchObject({ statusCode: 403 });
    });

    it('does not blame the search for a Gmail 400 on a plain listing', async () => {
      const gmail400 = Object.assign(new Error('Precondition check failed.'), { code: 400 });
      list.mockRejectedValue(gmail400);

      await expect(GmailService.fetchEmails(userId, { label: 'INBOX', limit: 20 })).rejects.toBe(gmail400);
      expect(GmailAccount.updateMany).not.toHaveBeenCalled();
    });

    it('maps a Gmail 429 to a 429 error and passes other failures through', async () => {
      list.mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { response: { status: 429 } }));
      await expect(GmailService.fetchEmails(userId, {})).rejects.toMatchObject({ statusCode: 429 });

      const boom = Object.assign(new Error('Backend error'), { code: 500 });
      list.mockRejectedValueOnce(boom);
      await expect(GmailService.fetchEmails(userId, {})).rejects.toBe(boom);
    });
  });

  describe('Gmail failures on draft operations (not only the inbox list)', () => {
    const invalidGrant = () =>
      Object.assign(new Error('invalid_grant'), {
        status: 400,
        response: { status: 400, data: { error: 'invalid_grant' } },
      });
    const drafts = { create: vi.fn(), update: vi.fn(), send: vi.fn(), delete: vi.fn() };
    const messagesGet = vi.fn();
    const threadsGet = vi.fn();

    beforeEach(() => {
      Object.values(drafts).forEach((fn) => fn.mockReset());
      messagesGet.mockReset();
      threadsGet.mockReset();
      mocks.gmail.mockReturnValue({ users: { drafts, messages: { get: messagesGet }, threads: { get: threadsGet } } });
    });

    const operations: [string, () => Promise<unknown>, Mock][] = [
      ['createDraft', () => GmailService.createDraft(userId, { to: ['a@example.com'], cc: [] }, 'Re: Hi', 'Body', 'thread-1'), drafts.create],
      ['updateDraft', () => GmailService.updateDraft(userId, 'gd-1', 'Body', { to: ['a@example.com'], cc: [] }, 'Re: Hi', 'thread-1'), drafts.update],
      ['sendDraft', () => GmailService.sendDraft(userId, 'gd-1', 'thread-1'), drafts.send],
      ['deleteDraft', () => GmailService.deleteDraft(userId, 'gd-1'), drafts.delete],
      [
        'getReplyMetadata',
        () => {
          (EmailMessage.findOne as unknown as Mock).mockResolvedValue({ gmailMessageId: 'msg-1' });
          return GmailService.getReplyMetadata(userId, 'msg-1');
        },
        messagesGet,
      ],
      ['syncThread', () => GmailService.syncThread(userId, 'thread-1'), threadsGet],
    ];

    it.each(operations)('%s: invalid_grant marks Gmail disconnected and returns 403', async (_name, run, apiCall) => {
      apiCall.mockRejectedValue(invalidGrant());

      await expect(run()).rejects.toMatchObject({
        statusCode: 403,
        message: 'Gmail access has expired or was revoked. Please reconnect Gmail.',
      });
      expect(GmailAccount.updateMany).toHaveBeenCalledWith(
        { userId: new Types.ObjectId(userId), revokedAt: null },
        { $set: { revokedAt: expect.any(Date) } }
      );
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(new Types.ObjectId(userId), {
        googleConnected: false,
        gmailEmail: null,
      });
    });

    it.each(operations)('%s: a Gmail 429 becomes a 429, other failures pass through', async (_name, run, apiCall) => {
      apiCall.mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { response: { status: 429 } }));
      await expect(run()).rejects.toMatchObject({ statusCode: 429 });

      const boom = Object.assign(new Error('Backend error'), { code: 500 });
      apiCall.mockRejectedValueOnce(boom);
      await expect(run()).rejects.toBe(boom);
      expect(GmailAccount.updateMany).not.toHaveBeenCalled();
    });

    it('loads the Gmail account once and sends From the connected address', async () => {
      drafts.create.mockResolvedValue({ data: { id: 'gd-1' } });

      await expect(GmailService.createDraft(userId, { to: ['a@example.com'], cc: [] }, 'Re: Hi', 'Body', 'thread-1')).resolves.toBe('gd-1');

      expect(GmailAccount.findOne).toHaveBeenCalledTimes(1);
      const raw = Buffer.from(drafts.create.mock.calls[0][0].requestBody.message.raw, 'base64').toString();
      expect(raw).toContain('From: user@gmail.com');
    });

    it('keeps "Gmail account not connected" as a 409', async () => {
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);
      await expect(GmailService.sendDraft(userId, 'gd-1', 'thread-1')).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('Token Refresh Persistence', () => {
    it('sets up token refresh listener when getting Gmail client', async () => {
      const userId = new Types.ObjectId().toString();
      const account = {
        userId: new Types.ObjectId(userId),
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'access',
        refreshTokenEnc: 'refresh',
        tokenExpiry: new Date(Date.now() + 3600000),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(account);
      vi.spyOn(CryptoService, 'decryptToken')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      // Mock createOAuth2Client with 'on' method to track listener setup
      let tokenEventCallback: any = null;
      const mockClient = {
        setCredentials: vi.fn(),
        on: vi.fn((event: string, callback: any) => {
          if (event === 'tokens') {
            tokenEventCallback = callback;
          }
        }),
        credentials: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3600000,
        },
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      mocks.gmail.mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          },
        },
      });

      await GmailService.fetchEmails(userId);

      // Verify listener was set up
      expect(mockClient.on).toHaveBeenCalledWith('tokens', expect.any(Function));
      expect(tokenEventCallback).not.toBeNull();
    });

    it('persists refreshed access token when tokens event is emitted', async () => {
      const userId = new Types.ObjectId().toString();
      const userObjectId = new Types.ObjectId(userId);
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(Date.now() + 3600000),
        revokedAt: null,
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      vi.spyOn(CryptoService, 'decryptToken')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      vi.spyOn(CryptoService, 'encryptToken')
        .mockReturnValueOnce('encrypted-refreshed-access');

      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue(mockAccount);

      // Mock createOAuth2Client with 'on' method
      let tokenEventCallback: any = null;
      const mockClient = {
        setCredentials: vi.fn(),
        on: vi.fn((event: string, callback: any) => {
          if (event === 'tokens') {
            tokenEventCallback = callback;
          }
        }),
        credentials: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3600000,
        },
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      mocks.gmail.mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          },
        },
      });

      await GmailService.fetchEmails(userId);

      // Simulate the tokens event (which fires after Google's API call)
      await tokenEventCallback({
        access_token: 'refreshed-access-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 7200000,
      });

      // Should persist the refreshed token
      expect(GmailAccount.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: userObjectId, gmailEmail: 'user@gmail.com' }),
        expect.objectContaining({ accessTokenEnc: 'encrypted-refreshed-access' }),
        { returnDocument: 'after' }
      );
    });

    it('persists replacement refresh token when Google provides one', async () => {
      const userId = new Types.ObjectId().toString();
      const userObjectId = new Types.ObjectId(userId);
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(Date.now() + 3600000),
        revokedAt: null,
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      vi.spyOn(CryptoService, 'decryptToken')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      vi.spyOn(CryptoService, 'encryptToken')
        .mockReturnValueOnce('encrypted-refreshed-access')
        .mockReturnValueOnce('encrypted-new-refresh');

      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue(mockAccount);

      let tokenEventCallback: any = null;
      const mockClient = {
        setCredentials: vi.fn(),
        on: vi.fn((event: string, callback: any) => {
          if (event === 'tokens') {
            tokenEventCallback = callback;
          }
        }),
        credentials: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3600000,
        },
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      mocks.gmail.mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          },
        },
      });

      await GmailService.fetchEmails(userId);

      // Simulate tokens event with a new refresh token
      await tokenEventCallback({
        access_token: 'refreshed-access-token',
        refresh_token: 'new-refresh-token',
        expiry_date: Date.now() + 7200000,
      });

      // Verify both access and refresh tokens were encrypted and persisted
      expect(CryptoService.encryptToken).toHaveBeenCalledWith('refreshed-access-token');
      expect(CryptoService.encryptToken).toHaveBeenCalledWith('new-refresh-token');
      expect(GmailAccount.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          accessTokenEnc: 'encrypted-refreshed-access',
          refreshTokenEnc: 'encrypted-new-refresh',
        }),
        { returnDocument: 'after' }
      );
    });

    it('preserves refresh token when Google does not return a replacement', async () => {
      const userId = new Types.ObjectId().toString();
      const userObjectId = new Types.ObjectId(userId);
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(Date.now() + 3600000),
        revokedAt: null,
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      vi.spyOn(CryptoService, 'decryptToken')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      vi.spyOn(CryptoService, 'encryptToken')
        .mockReturnValueOnce('encrypted-refreshed-access');

      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue(mockAccount);

      let tokenEventCallback: any = null;
      const mockClient = {
        setCredentials: vi.fn(),
        on: vi.fn((event: string, callback: any) => {
          if (event === 'tokens') {
            tokenEventCallback = callback;
          }
        }),
        credentials: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3600000,
        },
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      mocks.gmail.mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          },
        },
      });

      await GmailService.fetchEmails(userId);

      // Simulate tokens event WITHOUT a new refresh token
      await tokenEventCallback({
        access_token: 'refreshed-access-token',
        refresh_token: undefined, // Google didn't provide a new one
        expiry_date: Date.now() + 7200000,
      });

      // Should NOT update refresh token
      expect(GmailAccount.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.not.objectContaining({ refreshTokenEnc: expect.anything() }),
        { returnDocument: 'after' }
      );
    });
  });
});
