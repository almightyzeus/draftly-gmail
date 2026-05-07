import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { GmailOAuthService } from '../src/services/gmailOAuthService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { User } from '../src/models/User.js';
import { CryptoService } from '../src/services/cryptoService.js';
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

  it('generates OAuth URL with Gmail scopes and user state', () => {
    mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/auth');
    const url = GmailOAuthService.generateAuthUrl('507f191e810c19729de860ea', 'user@example.com');

    expect(url).toContain('accounts.google.com');
    expect(oauth2Client.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
      access_type: 'offline',
      prompt: 'consent',
      state: '507f191e810c19729de860ea',
      login_hint: 'user@example.com',
      scope: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.send']),
    }));
  });

  it('handles callback, encrypts tokens, and marks user connected', async () => {
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

    await GmailOAuthService.handleCallback('code', '507f191e810c19729de860ea');

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

  it('rejects callbacks without both access and refresh tokens', async () => {
    mocks.getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    await expect(GmailOAuthService.handleCallback('code', '507f191e810c19729de860ea')).rejects.toThrow(
      'Missing access_token or refresh_token'
    );
  });

  it('returns decrypted tokens and revokes accounts', async () => {
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
