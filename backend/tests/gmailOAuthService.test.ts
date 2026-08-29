import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import jwt from 'jsonwebtoken';
import { GmailOAuthService } from '../src/services/gmailOAuthService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { User } from '../src/models/User.js';
import { CryptoService } from '../src/services/cryptoService.js';
import { env } from '../src/config/env.js';
import { oauth2Client } from '../src/services/googleClient.js';

const mocks = vi.hoisted(() => ({
  gmail: vi.fn(),
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: mocks.gmail,
    auth: {
      OAuth2: vi.fn(() => ({
        generateAuthUrl: mocks.generateAuthUrl,
        getToken: mocks.getToken,
        setCredentials: mocks.setCredentials,
      })),
    },
  },
}));

vi.mock('../src/models/GmailAccount.js', () => ({
  GmailAccount: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../src/models/User.js', () => ({
  User: {
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('GmailOAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OAuth State Token', () => {
    it('generates a valid signed OAuth state token', () => {
      const userId = '507f191e810c19729de860ea';
      const token = GmailOAuthService.generateOAuthStateToken(userId);

      expect(token).toBeTruthy();
      const decoded = jwt.verify(token, env.jwt.accessSecret, { algorithms: ['HS256'] }) as any;
      expect(decoded.userId).toBe(userId);
      expect(decoded.type).toBe('gmail_oauth');
    });

    it('verifies a valid OAuth state token and extracts userId', () => {
      const userId = '507f191e810c19729de860ea';
      const token = GmailOAuthService.generateOAuthStateToken(userId);
      const extractedUserId = GmailOAuthService.verifyOAuthStateToken(token);

      expect(extractedUserId).toBe(userId);
    });

    it('rejects missing state parameter', () => {
      expect(() => GmailOAuthService.verifyOAuthStateToken(undefined)).toThrow('Missing OAuth state parameter');
    });

    it('rejects tampered or invalid state token', () => {
      const tamperedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1MDdmMTkxZTgxMGMxOTcyOWRlODYwZWEifQ.invalid_signature';
      expect(() => GmailOAuthService.verifyOAuthStateToken(tamperedToken)).toThrow('Invalid or tampered OAuth state parameter');
    });

    it('rejects expired state token', () => {
      const expiredToken = jwt.sign(
        { userId: '507f191e810c19729de860ea', type: 'gmail_oauth' },
        env.jwt.accessSecret,
        { expiresIn: '-1s', algorithm: 'HS256' }
      );
      expect(() => GmailOAuthService.verifyOAuthStateToken(expiredToken)).toThrow('OAuth state token has expired');
    });

    it('rejects state token with wrong type', () => {
      const wrongTypeToken = jwt.sign(
        { userId: '507f191e810c19729de860ea', type: 'wrong_type' },
        env.jwt.accessSecret,
        { expiresIn: '10m', algorithm: 'HS256' }
      );
      expect(() => GmailOAuthService.verifyOAuthStateToken(wrongTypeToken)).toThrow('Invalid state token type');
    });
  });

  describe('generateAuthUrl', () => {
    it('generates OAuth URL with signed state token (not raw userId)', () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/auth');
      const userId = '507f191e810c19729de860ea';
      const url = GmailOAuthService.generateAuthUrl(userId, 'user@example.com');

      expect(url).toContain('accounts.google.com');
      
      // Verify that the state parameter is a signed JWT token, not raw userId
      const callArgs = (oauth2Client.generateAuthUrl as any).mock.calls[0][0];
      expect(callArgs.state).not.toBe(userId);
      
      // Verify the state token is valid and contains the userId
      const stateToken = callArgs.state;
      const decoded = jwt.verify(stateToken, env.jwt.accessSecret, { algorithms: ['HS256'] }) as any;
      expect(decoded.userId).toBe(userId);
      expect(decoded.type).toBe('gmail_oauth');
      
      expect(callArgs).toEqual(expect.objectContaining({
        access_type: 'offline',
        prompt: 'consent',
        login_hint: 'user@example.com',
        scope: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.send']),
      }));
    });
  });

  describe('handleCallback', () => {
    it('verifies state, encrypts tokens, and marks user connected', async () => {
      const userId = '507f191e810c19729de860ea';
      const stateToken = GmailOAuthService.generateOAuthStateToken(userId);
      
      mocks.getToken.mockResolvedValue({
        tokens: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3600000,
          scope: 'scope-a scope-b',
        },
      });
      mocks.gmail.mockReturnValue({
        users: {
          getProfile: vi.fn().mockResolvedValue({ data: { emailAddress: 'user@gmail.com' } }),
        },
      });
      vi.spyOn(CryptoService, 'encryptToken')
        .mockReturnValueOnce('encrypted-access')
        .mockReturnValueOnce('encrypted-refresh');
      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue({});
      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      await GmailOAuthService.handleCallback('code', stateToken);

      expect(CryptoService.encryptToken).toHaveBeenCalledWith('access-token');
      expect(GmailAccount.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ gmailEmail: 'user@gmail.com' }),
        expect.objectContaining({ accessTokenEnc: 'encrypted-access', refreshTokenEnc: 'encrypted-refresh' }),
        { upsert: true, new: true }
      );
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ googleConnected: true, gmailEmail: 'user@gmail.com' }),
        { new: true }
      );
    });

    it('rejects callback with invalid state token', async () => {
      const invalidState = 'invalid-token';
      await expect(GmailOAuthService.handleCallback('code', invalidState)).rejects.toThrow('Invalid or tampered OAuth state parameter');
    });

    it('rejects callback with expired state token', async () => {
      const expiredToken = jwt.sign(
        { userId: '507f191e810c19729de860ea', type: 'gmail_oauth' },
        env.jwt.accessSecret,
        { expiresIn: '-1s', algorithm: 'HS256' }
      );
      await expect(GmailOAuthService.handleCallback('code', expiredToken)).rejects.toThrow('OAuth state token has expired');
    });

    it('rejects callback with missing state', async () => {
      await expect(GmailOAuthService.handleCallback('code', '')).rejects.toThrow('Missing OAuth state parameter');
    });

    it('rejects callbacks without both access and refresh tokens', async () => {
      const userId = '507f191e810c19729de860ea';
      const stateToken = GmailOAuthService.generateOAuthStateToken(userId);
      
      mocks.getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
      await expect(GmailOAuthService.handleCallback('code', stateToken)).rejects.toThrow(
        'Missing access_token or refresh_token'
      );
    });
  });

  describe('getValidTokens and revoke', () => {
    it('returns decrypted tokens', async () => {
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue({
        accessTokenEnc: 'a',
        refreshTokenEnc: 'r',
        tokenExpiry: new Date(),
        revokedAt: null,
        save: vi.fn().mockResolvedValue({}),
      });
      vi.spyOn(CryptoService, 'decryptToken').mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      await expect(GmailOAuthService.getValidTokens('507f191e810c19729de860ea')).resolves.toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      });
    });

    it('revokes accounts', async () => {
      const account = { revokedAt: null as Date | null, save: vi.fn().mockResolvedValue({}) };
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(account);
      await GmailOAuthService.revoke('507f191e810c19729de860ea');
      expect(account.revokedAt).toBeInstanceOf(Date);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ googleConnected: false, gmailEmail: null }),
        { new: true }
      );
    });
  });
});
