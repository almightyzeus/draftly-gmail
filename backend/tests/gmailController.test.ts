import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response, NextFunction } from 'express';
import {
  connectOAuth,
  handleOAuthCallback,
  revokeOAuth,
  fetchEmails,
  getEmail,
} from '../src/controllers/gmailController';
import { GmailOAuthService } from '../src/services/gmailOAuthService';
import { GmailService } from '../src/services/gmailService';
import { AppError } from '../src/utils/errors';

vi.mock('../src/services/gmailOAuthService');
vi.mock('../src/services/gmailService');
vi.mock('../src/utils/logger');

describe('GmailController', () => {
  let mockReq: any;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      params: {},
      query: {},
      userId: 'user123',
      email: 'user@example.com',
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('connectOAuth', () => {
    it('should redirect to OAuth URL', () => {
      const authUrl = 'https://accounts.google.com/oauth/authorize?...';
      (GmailOAuthService.generateAuthUrl as unknown as Mock).mockReturnValue(authUrl);

      connectOAuth(mockReq, mockRes as Response);

      expect(GmailOAuthService.generateAuthUrl).toHaveBeenCalledWith('user123', 'user@example.com');
      expect(mockRes.redirect).toHaveBeenCalledWith(authUrl);
    });

    it('should handle errors during URL generation', () => {
      const error = new AppError('Failed to generate auth URL', 500);
      (GmailOAuthService.generateAuthUrl as unknown as Mock).mockImplementation(() => {
        throw error;
      });

      connectOAuth(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to generate auth URL' });
    });
  });

  describe('handleOAuthCallback', () => {
    it('should handle OAuth callback successfully', async () => {
      mockReq.query = {
        code: 'auth-code-123',
        state: 'user123',
      };

      (GmailOAuthService.handleCallback as unknown as Mock).mockResolvedValue(undefined);

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(GmailOAuthService.handleCallback).toHaveBeenCalledWith('auth-code-123', 'user123');
      expect(mockRes.redirect).toHaveBeenCalledWith('http://localhost:4200/dashboard');
    });

    it('should return 400 if authorization code is missing', async () => {
      mockReq.query = {
        state: 'user123',
      };

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing authorization code' });
    });

    it('should return 400 if user ID is missing in state', async () => {
      mockReq.query = {
        code: 'auth-code-123',
      };

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User ID missing in state' });
    });

    it('should redirect to login error page on callback failure', async () => {
      mockReq.query = {
        code: 'auth-code-123',
        state: 'user123',
      };

      const error = new Error('OAuth handler failed');
      (GmailOAuthService.handleCallback as unknown as Mock).mockRejectedValue(error);

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith('http://localhost:4200/login?error=gmail_connection_failed');
    });
  });

  describe('revokeOAuth', () => {
    it('should revoke OAuth access successfully', async () => {
      (GmailOAuthService.revoke as unknown as Mock).mockResolvedValue(undefined);

      await revokeOAuth(mockReq, mockRes as Response);

      expect(GmailOAuthService.revoke).toHaveBeenCalledWith('user123');
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Gmail account revoked' });
    });

    it('should handle errors during revoke', async () => {
      const error = new AppError('Failed to revoke', 500);
      (GmailOAuthService.revoke as unknown as Mock).mockRejectedValue(error);

      await revokeOAuth(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to revoke' });
    });
  });

  describe('fetchEmails', () => {
    it('should fetch emails with default options', async () => {
      mockReq.query = {};

      const mockEmails = [
        { id: 'email1', subject: 'Test' },
        { id: 'email2', subject: 'Test 2' },
      ];

      (GmailService.fetchEmails as unknown as Mock).mockResolvedValue(mockEmails);

      await fetchEmails(mockReq, mockRes as Response);

      expect(GmailService.fetchEmails).toHaveBeenCalledWith('user123', {
        label: 'INBOX',
        unread: false,
        limit: 20,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockEmails);
    });

    it('should fetch emails with custom options', async () => {
      mockReq.query = {
        label: 'SENT',
        unread: 'true',
        limit: '50',
      };

      const mockEmails = [];

      (GmailService.fetchEmails as unknown as Mock).mockResolvedValue(mockEmails);

      await fetchEmails(mockReq, mockRes as Response);

      expect(GmailService.fetchEmails).toHaveBeenCalledWith('user123', {
        label: 'SENT',
        unread: true,
        limit: 50,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockEmails);
    });

    it('should handle errors during fetch', async () => {
      mockReq.query = {};

      const error = new AppError('Gmail service unavailable', 503);
      (GmailService.fetchEmails as unknown as Mock).mockRejectedValue(error);

      await fetchEmails(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Gmail service unavailable' });
    });
  });

  describe('getEmail', () => {
    it('should get a single email successfully', async () => {
      mockReq.params = { gmailMessageId: 'msg123' };

      const mockEmail = {
        id: 'msg123',
        subject: 'Test Email',
        body: 'Test body',
      };

      (GmailService.getEmail as unknown as Mock).mockResolvedValue(mockEmail);

      await getEmail(mockReq, mockRes as Response);

      expect(GmailService.getEmail).toHaveBeenCalledWith('user123', 'msg123');
      expect(mockRes.json).toHaveBeenCalledWith(mockEmail);
    });

    it('should handle errors when retrieving email', async () => {
      mockReq.params = { gmailMessageId: 'msg123' };

      const error = new AppError('Email not found', 404);
      (GmailService.getEmail as unknown as Mock).mockRejectedValue(error);

      await getEmail(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Email not found' });
    });
  });
});
