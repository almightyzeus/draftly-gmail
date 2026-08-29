import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response, NextFunction } from 'express';

// Hoist mocks before importing modules
const envMocks = vi.hoisted(() => ({
  env: {
    frontendUrl: 'http://localhost:4200',
    jwt: {
      accessSecret: 'test-secret',
      accessExpiresIn: '15m',
      refreshSecret: 'test-refresh-secret',
      refreshExpiresIn: '7d',
    },
    google: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/api/gmail/oauth/callback',
    },
  },
}));

vi.mock('../src/config/env.js', () => envMocks);
vi.mock('../src/services/googleClient.js', () => ({
  oauth2Client: {
    generateAuthUrl: vi.fn(),
    getToken: vi.fn(),
    setCredentials: vi.fn(),
  },
}));
vi.mock('../src/services/gmailOAuthService');
vi.mock('../src/services/gmailService');
vi.mock('../src/utils/logger');

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
    it('should handle OAuth callback successfully with valid signed state', async () => {
      const validStateToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyMTIzIiwidHlwZSI6ImdtYWlsX29hdXRoIn0.signed';
      mockReq.query = {
        code: 'auth-code-123',
        state: validStateToken,
      };

      (GmailOAuthService.verifyOAuthStateToken as unknown as Mock).mockReturnValue('user123');
      (GmailOAuthService.handleCallback as unknown as Mock).mockResolvedValue(undefined);

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(GmailOAuthService.verifyOAuthStateToken).toHaveBeenCalledWith(validStateToken);
      expect(GmailOAuthService.handleCallback).toHaveBeenCalledWith('auth-code-123', validStateToken);
      expect(mockRes.redirect).toHaveBeenCalledWith('http://localhost:4200/dashboard');
    });

    it('should return 400 if authorization code is missing', async () => {
      mockReq.query = {
        state: 'valid-state-token',
      };

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing authorization code' });
    });

    it('should redirect to login error if state verification fails', async () => {
      mockReq.query = {
        code: 'auth-code-123',
        state: 'invalid-or-tampered-state',
      };

      const stateError = new Error('Invalid or tampered OAuth state parameter');
      (GmailOAuthService.verifyOAuthStateToken as unknown as Mock).mockImplementation(() => {
        throw stateError;
      });

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(GmailOAuthService.verifyOAuthStateToken).toHaveBeenCalledWith('invalid-or-tampered-state');
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:4200/login?error=')
      );
    });

    it('should redirect to login error if state is missing', async () => {
      mockReq.query = {
        code: 'auth-code-123',
      };

      const stateError = new Error('Missing OAuth state parameter');
      (GmailOAuthService.verifyOAuthStateToken as unknown as Mock).mockImplementation(() => {
        throw stateError;
      });

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?error=Missing%20OAuth%20state%20parameter'
      );
    });

    it('should redirect to login error if state is expired', async () => {
      mockReq.query = {
        code: 'auth-code-123',
        state: 'expired-state-token',
      };

      const expiredError = new Error('OAuth state token has expired. Please try connecting Gmail again.');
      (GmailOAuthService.verifyOAuthStateToken as unknown as Mock).mockImplementation(() => {
        throw expiredError;
      });

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:4200/login?error=')
      );
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('expired')
      );
    });

    it('should redirect to login error page on callback failure', async () => {
      mockReq.query = {
        code: 'auth-code-123',
        state: 'valid-state',
      };

      (GmailOAuthService.verifyOAuthStateToken as unknown as Mock).mockReturnValue('user123');
      const error = new Error('OAuth handler failed');
      (GmailOAuthService.handleCallback as unknown as Mock).mockRejectedValue(error);

      await handleOAuthCallback(mockReq, mockRes as Response, mockNext);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        'http://localhost:4200/login?error=gmail_connection_failed'
      );
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
      };

      (GmailService.getEmail as unknown as Mock).mockResolvedValue(mockEmail);

      await getEmail(mockReq, mockRes as Response);

      expect(GmailService.getEmail).toHaveBeenCalledWith('user123', 'msg123');
      expect(mockRes.json).toHaveBeenCalledWith(mockEmail);
    });

    it('should handle errors during get email', async () => {
      mockReq.params = { gmailMessageId: 'msg123' };

      const error = new AppError('Email not found', 404);
      (GmailService.getEmail as unknown as Mock).mockRejectedValue(error);

      await getEmail(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Email not found' });
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
