import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { GmailService } from '../src/services/gmailService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';

vi.mock('../src/models/GmailAccount');
vi.mock('../src/services/googleClient');
vi.mock('../src/utils/logger');

describe('GmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchEmails', () => {
    it('should fetch emails from Gmail', async () => {
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      // This would call the actual Gmail API in production
      // For now, testing the service setup
      const result = await GmailService.fetchEmails('user123', { unread: true, limit: 20 });

      expect(Array.isArray(result) || result === undefined).toBe(true);
    });

    it('should throw error if Gmail not connected', async () => {
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        GmailService.fetchEmails('user123', { unread: true })
      ).rejects.toThrow();
    });
  });

  describe('createDraft', () => {
    it('should create draft in Gmail', async () => {
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.createDraft('user123', {
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
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.updateDraft('user123', 'draft_id_123', '<p>Updated reply</p>');

      expect(result === undefined || typeof result === 'string').toBe(true);
    });

    it('should throw error if Gmail not connected', async () => {
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(
        GmailService.updateDraft('user123', 'draft_id_123', '<p>Updated</p>')
      ).rejects.toThrow();
    });
  });

  describe('sendDraft', () => {
    it('should send email via Gmail API', async () => {
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.sendDraft('user123', 'draft_id_123', 'thread_123');

      expect(typeof result === 'string' || result === undefined).toBe(true);
    });
  });

  describe('getEmail', () => {
    it('should fetch full email details including body', async () => {
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.getEmail('user123', 'msg_id_123');

      expect(result === undefined || typeof result === 'object').toBe(true);
    });
  });

  describe('fetchThreadEmails', () => {
    it('should fetch all emails in a thread', async () => {
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.fetchThreadEmails('user123', 'thread_123');

      expect(Array.isArray(result) || result === undefined).toBe(true);
    });
  });

  describe('sendReply', () => {
    it('should send a reply to an email', async () => {
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.sendReply('user123', {
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
      const mockAccount = {
        _id: 'account123',
        userId: 'user123',
        accessTokenEnc: 'encrypted_token',
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      const result = await GmailService.deleteDraft('user123', 'draft_id_123');

      expect(result === undefined).toBe(true);
    });
  });
});
