import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { GmailService } from '../src/services/gmailService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
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
  GmailAccount: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
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

    const emails = await GmailService.fetchEmails(userId, { unread: true, limit: 1 });
    expect(emails).toHaveLength(1);
    expect(EmailMessage.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        rfcMessageId: '<sender-message@example.com>',
        references: '<earlier-message@example.com>',
      }),
      expect.any(Object)
    );
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
        'to@example.com',
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
    await expect(GmailService.updateDraft(userId, 'draft-1', 'Body 2', 'to@example.com', 'Subject', 'thread-1')).resolves.toBeUndefined();
    await expect(GmailService.sendDraft(userId, 'draft-1', 'thread-1')).resolves.toBe('sent-1');
    await expect(GmailService.deleteDraft(userId, 'draft-1')).resolves.toBeUndefined();
  });

  it('documents that direct sendReply is not implemented in the MVP', async () => {
    await expect(GmailService.sendReply(userId, 'thread-1', 'Body')).rejects.toThrow('Not implemented yet');
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
      { new: true }
    );
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
        { new: true }
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
        { new: true }
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
        { new: true }
      );
    });
  });
});
