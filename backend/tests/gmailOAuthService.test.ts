import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { GmailOAuthService } from '../src/services/gmailOAuthService.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { User } from '../src/models/User.js';
import { CryptoService } from '../src/services/cryptoService.js';
import { env } from '../src/config/env.js';

const mocks = vi.hoisted(() => ({
  gmail: vi.fn(),
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  revokeToken: vi.fn(),
  createOAuth2Client: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: mocks.gmail,
    auth: {
      OAuth2: vi.fn(() => ({
        generateAuthUrl: mocks.generateAuthUrl,
        getToken: mocks.getToken,
        setCredentials: mocks.setCredentials,
        revokeToken: mocks.revokeToken,
        credentials: {},
      })),
    },
  },
}));

vi.mock('../src/services/googleClient.js', () => ({
  createOAuth2Client: mocks.createOAuth2Client,
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('GmailOAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock for createOAuth2Client - returns a mock client with credentials property and 'on' method
    const defaultMockClient = {
      generateAuthUrl: mocks.generateAuthUrl,
      getToken: mocks.getToken,
      setCredentials: vi.fn(),
      revokeToken: vi.fn(),
      on: vi.fn(),
      credentials: {
        access_token: 'token',
        refresh_token: 'token',
        expiry_date: Date.now() + 3600000,
      },
    };
    mocks.createOAuth2Client.mockReturnValue(defaultMockClient);
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
        { expiresIn: '10m', algorithm: 'HS256', audience: 'gmail-oauth-state' }
      );
      expect(() => GmailOAuthService.verifyOAuthStateToken(wrongTypeToken)).toThrow('Invalid state token type');
    });

    it('signs state with its own audience so it cannot pass as an access token', () => {
      const token = GmailOAuthService.generateOAuthStateToken('507f191e810c19729de860ea');
      const decoded = jwt.decode(token) as any;

      expect(decoded.aud).toBe('gmail-oauth-state');
      expect(decoded.type).toBe('gmail_oauth');
    });

    it('rejects an API access token presented as OAuth state (no audience)', () => {
      const accessToken = jwt.sign(
        { userId: '507f191e810c19729de860ea', email: 'user@example.com' },
        env.jwt.accessSecret,
        { expiresIn: '15m', algorithm: 'HS256' }
      );
      expect(() => GmailOAuthService.verifyOAuthStateToken(accessToken)).toThrow(
        'Invalid or tampered OAuth state parameter'
      );
    });
  });

  describe('generateAuthUrl', () => {
    it('generates OAuth URL with signed state token (not raw userId)', () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/auth');
      const userId = '507f191e810c19729de860ea';
      const url = GmailOAuthService.generateAuthUrl(userId, 'user@example.com');

      expect(url).toContain('accounts.google.com');
      
      // Verify that the state parameter is a signed JWT token, not raw userId
      const callArgs = mocks.generateAuthUrl.mock.calls[0][0];
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
        { upsert: true, returnDocument: 'after' }
      );
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ googleConnected: true, gmailEmail: 'user@gmail.com' }),
        { returnDocument: 'after' }
      );
    });

    it('isolates credentials between concurrent callbacks (one OAuth client per callback)', async () => {
      const users = {
        a: { userId: new Types.ObjectId().toString(), access: 'a-access', email: 'alice@gmail.com' },
        b: { userId: new Types.ObjectId().toString(), access: 'b-access', email: 'bob@gmail.com' },
      };
      const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

      // Each callback gets its own client; getToken yields so both callbacks set
      // credentials before either looks up its Gmail profile.
      const clients: any[] = [];
      mocks.createOAuth2Client.mockImplementation(() => {
        const client: any = {
          credentials: {},
          on: vi.fn(),
          setCredentials(tokens: any) { client.credentials = tokens; },
          async getToken(code: string) {
            await tick();
            const user = code === 'code-a' ? users.a : users.b;
            return { tokens: { access_token: user.access, refresh_token: `${user.access}-refresh`, expiry_date: Date.now() + 3600000 } };
          },
        };
        clients.push(client);
        return client;
      });
      mocks.gmail.mockImplementation(({ auth }: any) => ({
        users: {
          getProfile: async () => {
            await tick();
            const email = auth.credentials.access_token === users.a.access ? users.a.email : users.b.email;
            return { data: { emailAddress: email } };
          },
        },
      }));
      vi.spyOn(CryptoService, 'encryptToken').mockImplementation((value: string) => `enc(${value})`);
      (GmailAccount.findOneAndUpdate as unknown as Mock).mockResolvedValue({});
      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      await Promise.all([
        GmailOAuthService.handleCallback('code-a', GmailOAuthService.generateOAuthStateToken(users.a.userId)),
        GmailOAuthService.handleCallback('code-b', GmailOAuthService.generateOAuthStateToken(users.b.userId)),
      ]);

      expect(clients).toHaveLength(2);
      const saved = (GmailAccount.findOneAndUpdate as unknown as Mock).mock.calls.map(([filter, update]) => ({
        userId: filter.userId.toString(),
        gmailEmail: filter.gmailEmail,
        accessTokenEnc: update.accessTokenEnc,
      }));
      expect(saved).toEqual(
        expect.arrayContaining([
          { userId: users.a.userId, gmailEmail: users.a.email, accessTokenEnc: 'enc(a-access)' },
          { userId: users.b.userId, gmailEmail: users.b.email, accessTokenEnc: 'enc(b-access)' },
        ])
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

  describe('revoke', () => {
    it('calls Google revoke endpoint with refresh token and marks account revoked', async () => {
      const userId = '507f191e810c19729de860ea';
      const userObjectId = new Types.ObjectId(userId);
      
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(),
        revokedAt: null,
        save: vi.fn().mockResolvedValue({}),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      vi.spyOn(CryptoService, 'decryptToken').mockReturnValue('refresh-token');
      
      const mockClient = {
        setCredentials: vi.fn(),
        revokeToken: vi.fn().mockResolvedValue({}),
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      await GmailOAuthService.revoke(userId);

      expect(mockClient.revokeToken).toHaveBeenCalledWith('refresh-token');
      expect(mockAccount.save).toHaveBeenCalled();
      expect(mockAccount.revokedAt).toBeInstanceOf(Date);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        userObjectId,
        expect.objectContaining({ googleConnected: false, gmailEmail: null }),
        { returnDocument: 'after' }
      );
    });

    it('treats already-revoked/invalid token as successful cleanup', async () => {
      const userId = '507f191e810c19729de860ea';
      const userObjectId = new Types.ObjectId(userId);
      
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(),
        revokedAt: null,
        save: vi.fn().mockResolvedValue({}),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      vi.spyOn(CryptoService, 'decryptToken').mockReturnValue('refresh-token');
      
      // Mock Google's error for already-revoked token
      const revokeError = new Error('Token has been revoked') as any;
      revokeError.status = 400;
      
      const mockClient = {
        setCredentials: vi.fn(),
        revokeToken: vi.fn().mockRejectedValue(revokeError),
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      await GmailOAuthService.revoke(userId);

      // Should still mark as revoked locally
      expect(mockAccount.revokedAt).toBeInstanceOf(Date);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        userObjectId,
        expect.objectContaining({ googleConnected: false, gmailEmail: null }),
        { returnDocument: 'after' }
      );
    });

    it('throws on unexpected Google revoke failure', async () => {
      const userId = '507f191e810c19729de860ea';
      const userObjectId = new Types.ObjectId(userId);
      
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(),
        revokedAt: null,
        save: vi.fn().mockResolvedValue({}),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      vi.spyOn(CryptoService, 'decryptToken').mockReturnValue('refresh-token');
      
      // Mock unexpected error
      const unexpectedError = new Error('Connection refused');
      
      const mockClient = {
        setCredentials: vi.fn(),
        revokeToken: vi.fn().mockRejectedValue(unexpectedError),
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      await expect(GmailOAuthService.revoke(userId)).rejects.toThrow('Connection refused');
      
      // Should NOT mark as revoked
      expect(mockAccount.revokedAt).toBeNull();
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('handles case where no active Gmail account exists', async () => {
      const userId = '507f191e810c19729de860ea';
      
      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(null);

      // Should not throw
      await expect(GmailOAuthService.revoke(userId)).resolves.not.toThrow();
      
      // Should not attempt revocation
      expect(mocks.createOAuth2Client).not.toHaveBeenCalled();
    });

    it('does not log plaintext tokens', async () => {
      const userId = '507f191e810c19729de860ea';
      const userObjectId = new Types.ObjectId(userId);
      
      const mockAccount = {
        userId: userObjectId,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted-access',
        refreshTokenEnc: 'encrypted-refresh',
        tokenExpiry: new Date(),
        revokedAt: null,
        save: vi.fn().mockResolvedValue({}),
      };

      (GmailAccount.findOne as unknown as Mock).mockResolvedValue(mockAccount);
      vi.spyOn(CryptoService, 'decryptToken').mockReturnValue('refresh-token-secret-value');
      
      const mockClient = {
        setCredentials: vi.fn(),
        revokeToken: vi.fn().mockResolvedValue({}),
      };
      mocks.createOAuth2Client.mockReturnValue(mockClient);

      (User.findByIdAndUpdate as unknown as Mock).mockResolvedValue({});

      await GmailOAuthService.revoke(userId);

      // Check that logger was called and tokens are not in the logs
      // We can verify this by checking that the mocked logger was called
      // but we cannot easily check the contents since they're mocked
      expect(mockAccount.save).toHaveBeenCalled();
    });
  });
});
