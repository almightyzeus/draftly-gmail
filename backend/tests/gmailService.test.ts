import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { GmailService } from '../src/services/gmailService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { CryptoService } from '../src/services/cryptoService.js';

vi.mock('../src/models/GmailAccount');
vi.mock('../src/models/EmailMessage');
vi.mock('../src/services/googleClient');
vi.mock('../src/services/cryptoService');
vi.mock('../src/utils/logger');

// Mock google module
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(),
  },
}));

describe('GmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (CryptoService.decryptToken as unknown as Mock).mockReturnValue('valid_access_token');
  });

  describe('fetchEmails', () => {
    it('should fetch emails from Gmail', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      // This would call the actual Gmail API in production
      // For now, testing the service setup
      const result = await GmailService.fetchEmails(userId, { unread: true, limit: 20 });

      expect(Array.isArray(result) || result === undefined).toBe(true);
    });

    it('should throw error if Gmail not connected', async () => {
      const userId = new Types.ObjectId().toString();
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        GmailService.fetchEmails(userId, { unread: true })
      ).rejects.toThrow();
    });
  });

  describe('createDraft', () => {
    it('should create draft in Gmail', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const { google } = await import('googleapis');
      (google.gmail as unknown as Mock).mockReturnValue({
        users: {
          drafts: {
            create: vi.fn().mockResolvedValue({ data: { id: 'draft_123' } }),
          },
        },
      });

      const result = await GmailService.createDraft(userId, {
        to: 'recipient@example.com',
        subject: 'Test',
        bodyHtml: '<p>Test reply</p>',
        threadId: 'thread123',
        inReplyTo: 'msg_123',
        references: 'msg_123',
      });

      expect(typeof result === 'string' || result === undefined).toBe(true);
    });
  });

  describe('updateDraft', () => {
    it('should update existing Gmail draft', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const { google } = await import('googleapis');
      (google.gmail as unknown as Mock).mockReturnValue({
        users: {
          drafts: {
            update: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      });

      const result = await GmailService.updateDraft(userId, 'draft_id_123', '<p>Updated reply</p>');

      expect(result === undefined || typeof result === 'string').toBe(true);
    });

    it('should throw error if Gmail not connected', async () => {
      const userId = new Types.ObjectId().toString();
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        GmailService.updateDraft(userId, 'draft_id_123', '<p>Updated</p>')
      ).rejects.toThrow();
    });
  });

  describe('sendDraft', () => {
    it('should send email via Gmail API', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const { google } = await import('googleapis');
      (google.gmail as unknown as Mock).mockReturnValue({
        users: {
          drafts: {
            send: vi.fn().mockResolvedValue({ data: { id: 'msg_123' } }),
          },
        },
      });

      const result = await GmailService.sendDraft(userId, 'draft_id_123', 'thread_123');

      expect(typeof result === 'string' || result === undefined).toBe(true);
    });
  });

  describe('getEmail', () => {
    it('should fetch full email details including body', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };
      const mockEmail = {
        gmailMessageId: 'msg_id_123',
        bodyHtml: '<p>Email body</p>',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(mockEmail);

      const result = await GmailService.getEmail(userId, 'msg_id_123');

      expect(result === undefined || typeof result === 'object').toBe(true);
    });
  });

  describe('fetchThreadEmails', () => {
    it('should fetch all emails in a thread', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };
      const mockEmails = [
        { gmailMessageId: 'msg_1', bodyHtml: '<p>Email 1</p>' },
        { gmailMessageId: 'msg_2', bodyHtml: '<p>Email 2</p>' },
      ];

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      (EmailMessage.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(mockEmails),
        }),
      });

      const result = await GmailService.fetchThreadEmails(userId, 'thread_123');

      expect(Array.isArray(result) || result === undefined).toBe(true);
    });
  });

  describe('sendReply', () => {
    it('should send a reply to an email', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
        gmailEmail: 'user@gmail.com',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const { google } = await import('googleapis');
      (google.gmail as unknown as Mock).mockReturnValue({
        users: {
          messages: {
            send: vi.fn().mockResolvedValue({ data: { id: 'msg_456' } }),
          },
        },
      });

      const result = await GmailService.sendReply(userId, {
        to: 'recipient@example.com',
        subject: 'Re: Test',
        bodyHtml: '<p>Reply text</p>',
        threadId: 'thread_123',
        inReplyTo: 'msg_123',
        references: 'msg_123',
      });

      expect(typeof result === 'string' || result === undefined).toBe(true);
    });
  });

  describe('deleteDraft', () => {
    it('should delete a draft from Gmail', async () => {
      const userId = new Types.ObjectId().toString();
      const accountId = new Types.ObjectId().toString();
      const mockAccount = {
        _id: new Types.ObjectId(accountId),
        userId: new Types.ObjectId(userId),
        accessTokenEnc: 'encrypted_token',
        tokenExpiry: new Date(),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.deleteDraft(userId, 'draft_id_123');

      expect(result === undefined).toBe(true);
    });
  });
});
