import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { google } from 'googleapis';
import { GmailOAuthService } from '../src/services/gmailOAuthService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { User } from '../src/models/User.js';
import { CryptoService } from '../src/services/cryptoService.js';
import { oauth2Client } from '../src/services/googleClient.js';

vi.mock('../src/models/GmailAccount');
vi.mock('../src/models/User');
vi.mock('../src/services/googleClient');
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(),
  },
}));
vi.mock('../src/utils/logger');

describe('GmailOAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAuthUrl', () => {
    it('should generate a valid OAuth authorization URL', () => {
      const userId = 'user123';
      const userEmail = 'user@example.com';

      (oauth2Client.generateAuthUrl as unknown as Mock).mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?...'
      );

      const result = GmailOAuthService.generateAuthUrl(userId, userEmail);

      expect(result).toContain('https://accounts.google.com');
      expect(oauth2Client.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          scope: expect.arrayContaining([
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.send',
          ]),
          prompt: 'consent',
          state: userId,
          login_hint: userEmail,
        })
      );
    });

    it('should include user ID in state parameter', () => {
      const userId = 'test-user-id-123';
      (oauth2Client.generateAuthUrl as unknown as Mock).mockReturnValue('url');

      GmailOAuthService.generateAuthUrl(userId, 'test@example.com');

      const call = (oauth2Client.generateAuthUrl as unknown as Mock).mock.calls[0][0];
      expect(call.state).toBe(userId);
    });

    it('should include user email in login_hint', () => {
      const userEmail = 'custom@gmail.com';
      (oauth2Client.generateAuthUrl as unknown as Mock).mockReturnValue('url');

      GmailOAuthService.generateAuthUrl('user123', userEmail);

      const call = (oauth2Client.generateAuthUrl as unknown as Mock).mock.calls[0][0];
      expect(call.login_hint).toBe(userEmail);
    });
  });

  describe('handleCallback', () => {
    it('should handle OAuth callback and save tokens', async () => {
      const code = 'auth-code-123';
      const userId = 'user123';
      const tokens = {
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        expiry_date: Date.now() + 3600000,
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify',
      };

      (oauth2Client.getToken as unknown as Mock).mockResolvedValue({ tokens });
      (oauth2Client.setCredentials as unknown as Mock).mockReturnValue(undefined);

      // Mock Gmail API profile call
      const mockGmail = {
        users: {
          getProfile: vi.fn().mockResolvedValue({
            data: { emailAddress: 'user@gmail.com' },
          }),
        },
      };

      (google.gmail as unknown as Mock).mockReturnValue(mockGmail);

      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue({
        userId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
      });

      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({
        _id: userId,
        googleConnected: true,
        gmailEmail: 'user@gmail.com',
      });

      await GmailOAuthService.handleCallback(code, userId);

      expect(oauth2Client.getToken).toHaveBeenCalledWith(code);
      expect(GmailAccount.findOneAndUpdate).toHaveBeenCalled();
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          googleConnected: true,
          gmailEmail: 'user@gmail.com',
        }),
        { new: true }
      );
    });

    it('should throw error if access_token is missing', async () => {
      const code = 'auth-code-123';
      const userId = 'user123';
      const tokensWithoutAccessToken = {
        refresh_token: 'refresh-token-value',
        expiry_date: Date.now() + 3600000,
      };

      (oauth2Client.getToken as unknown as Mock).mockResolvedValue({
        tokens: tokensWithoutAccessToken,
      });

      await expect(GmailOAuthService.handleCallback(code, userId)).rejects.toThrow(
        'Missing access_token or refresh_token'
      );
    });

    it('should throw error if refresh_token is missing', async () => {
      const code = 'auth-code-123';
      const userId = 'user123';
      const tokensWithoutRefresh = {
        access_token: 'access-token-value',
        expiry_date: Date.now() + 3600000,
      };

      (oauth2Client.getToken as unknown as Mock).mockResolvedValue({
        tokens: tokensWithoutRefresh,
      });

      await expect(GmailOAuthService.handleCallback(code, userId)).rejects.toThrow(
        'Missing access_token or refresh_token'
      );
    });

    it('should encrypt tokens before saving', async () => {
      const code = 'auth-code-123';
      const userId = 'user123';
      const tokens = {
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        expiry_date: Date.now() + 3600000,
      };

      (oauth2Client.getToken as unknown as Mock).mockResolvedValue({ tokens });
      (oauth2Client.setCredentials as unknown as Mock).mockReturnValue(undefined);

      const mockGmail = {
        users: {
          getProfile: vi.fn().mockResolvedValue({
            data: { emailAddress: 'user@gmail.com' },
          }),
        },
      };

      (google.gmail as unknown as Mock).mockReturnValue(mockGmail);
      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue({});
      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      vi.spyOn(CryptoService, 'encryptToken');

      await GmailOAuthService.handleCallback(code, userId);

      expect(CryptoService.encryptToken).toHaveBeenCalledWith('access-token-value');
      expect(CryptoService.encryptToken).toHaveBeenCalledWith('refresh-token-value');
    });
  });

  describe('getValidTokens', () => {
    it('should return valid tokens for user', async () => {
      const userId = 'user123';
      const mockAccount = {
        userId,
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(),
        revokedAt: null,
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      vi.spyOn(CryptoService, 'decryptToken')
        .mockReturnValueOnce('access-token-value')
        .mockReturnValueOnce('refresh-token-value');

      const result = await GmailOAuthService.getValidTokens(userId);

      expect(result).toEqual({
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
      });
    });

    it('should throw error if Gmail account not connected', async () => {
      const userId = 'user123';

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      await expect(GmailOAuthService.getValidTokens(userId)).rejects.toThrow(
        'Gmail account not connected'
      );
    });

    it('should set credentials on oauth2Client', async () => {
      const userId = 'user123';
      const mockAccount = {
        userId,
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(Date.now() + 3600000),
        revokedAt: null,
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);

      vi.spyOn(CryptoService, 'decryptToken')
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      await GmailOAuthService.getValidTokens(userId);

      expect(oauth2Client.setCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: expect.any(Number),
        })
      );
    });
  });

  describe('revoke', () => {
    it('should revoke Gmail account access', async () => {
      const userId = 'user123';
      const mockAccount = {
        userId,
        revokedAt: null,
        save: vi.fn().mockResolvedValue(true),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({
        googleConnected: false,
        gmailEmail: null,
      });

      await GmailOAuthService.revoke(userId);

      expect(mockAccount.revokedAt).not.toBeNull();
      expect(mockAccount.save).toHaveBeenCalled();
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          googleConnected: false,
          gmailEmail: null,
        }),
        { new: true }
      );
    });

    it('should handle case where Gmail account does not exist', async () => {
      const userId = 'user123';

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      // Should not throw
      await expect(GmailOAuthService.revoke(userId)).resolves.not.toThrow();
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should set revokedAt timestamp when revoking', async () => {
      const userId = 'user123';
      const beforeRevoke = Date.now();
      const mockAccount = {
        userId,
        revokedAt: null,
        save: vi.fn().mockResolvedValue(true),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      await GmailOAuthService.revoke(userId);

      const afterRevoke = Date.now();

      expect(mockAccount.revokedAt).toBeInstanceOf(Date);
      expect(mockAccount.revokedAt.getTime()).toBeGreaterThanOrEqual(beforeRevoke);
      expect(mockAccount.revokedAt.getTime()).toBeLessThanOrEqual(afterRevoke);
    });
  });
});
