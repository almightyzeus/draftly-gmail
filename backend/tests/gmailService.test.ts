import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { GmailService } from '../src/services/gmailService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { CryptoService } from '../src/services/cryptoService.js';

const mocks = vi.hoisted(() => ({
  gmail: vi.fn(),
  setCredentials: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: mocks.gmail,
    auth: {
      OAuth2: vi.fn(() => ({ setCredentials: mocks.setCredentials })),
    },
  },
}));

vi.mock('../src/models/GmailAccount.js', () => ({
  GmailAccount: { findOne: vi.fn() },
}));

vi.mock('../src/models/EmailMessage.js', () => ({
  EmailMessage: {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  });

  it('throws when Gmail is not connected', async () => {
    (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);
    await expect(GmailService.fetchEmails(userId, { unread: true })).rejects.toThrow('Gmail account not connected');
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

    const emails = await GmailService.fetchEmails(userId, { unread: true, limit: 1 });
    expect(emails).toHaveLength(1);
    expect(EmailMessage.findOneAndUpdate).toHaveBeenCalled();
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

    await expect(GmailService.createDraft(userId, 'to@example.com', 'Subject', 'Body', 'thread-1')).resolves.toBe('draft-1');
    await expect(GmailService.updateDraft(userId, 'draft-1', 'Body 2', 'to@example.com', 'Subject', 'thread-1')).resolves.toBeUndefined();
    await expect(GmailService.sendDraft(userId, 'draft-1', 'thread-1')).resolves.toBe('sent-1');
    await expect(GmailService.deleteDraft(userId, 'draft-1')).resolves.toBeUndefined();
  });

  it('documents that direct sendReply is not implemented in the MVP', async () => {
    await expect(GmailService.sendReply(userId, 'thread-1', 'Body')).rejects.toThrow('Not implemented yet');
  });
});
