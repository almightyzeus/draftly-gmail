import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { AuthService } from '../src/services/authService.js';
import { User } from '../src/models/User.js';
import { UserPreference } from '../src/models/UserPreference.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from '../src/utils/errors.js';

const userFindOneMock = vi.fn();
const userFindByIdMock = vi.fn();

vi.mock('../src/models/User.js', () => {
  const UserMock = vi.fn();
  UserMock.findOne = userFindOneMock;
  UserMock.findById = userFindByIdMock;
  return { User: UserMock };
});

const userPreferenceCreateMock = vi.fn();
vi.mock('../src/models/UserPreference.js', () => ({
  UserPreference: {
    create: userPreferenceCreateMock,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const buildMockUserInstance = (overrides: Partial<Record<string, any>> = {}) => ({
  _id: overrides._id ?? new Types.ObjectId('507f191e810c19729de860ea'),
  name: overrides.name ?? 'Test User',
  email: overrides.email ?? 'test@example.com',
  googleConnected: overrides.googleConnected ?? false,
  comparePassword: overrides.comparePassword ?? vi.fn().mockResolvedValue(true),
  save: overrides.save ?? vi.fn().mockResolvedValue(true),
});

describe('AuthService', () => {
    beforeEach(() => {
    vi.clearAllMocks();
    const userConstructor = User as unknown as Mock;
    userConstructor.mockImplementation(() => buildMockUserInstance());
  });


  describe('generateTokens', () => {
    it('creates access and refresh tokens containing JWT structure', () => {
      const tokens = AuthService.generateTokens('507f191e810c19729de860ea', 'user@example.com');

      expect(tokens.accessToken.split('.')).toHaveLength(3);
      expect(tokens.refreshToken.split('.')).toHaveLength(3);
    });
  });

  describe('register', () => {
    it('creates a new user and default preferences', async () => {
            const instance = buildMockUserInstance({ email: 'newuser@example.com' });
      const userConstructor = User as unknown as Mock;
      userConstructor.mockImplementation(() => instance);

      userFindOneMock.mockResolvedValue(null);
      userPreferenceCreateMock.mockResolvedValue(true);

      const result = await AuthService.register('Test User', 'newuser@example.com', 'Password123');

      expect(userFindOneMock).toHaveBeenCalledWith({ email: 'newuser@example.com' });
      expect(instance.save).toHaveBeenCalled();
      expect(userPreferenceCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: instance._id })
      );
      expect(result.user.email).toBe('newuser@example.com');
      expect(result.tokens.accessToken).toBeDefined();
    });

    it('normalises email to lowercase and rejects duplicates', async () => {
      userFindOneMock.mockResolvedValue({ _id: new Types.ObjectId(), email: 'existing@example.com' });

      await expect(
        AuthService.register('Someone', 'EXISTING@EXAMPLE.COM', 'Password123')
      ).rejects.toThrow(ConflictError);
    });

    it('validates required fields', async () => {
      await expect(AuthService.register('', 'user@example.com', 'abc123')).rejects.toThrow(
        ValidationError
      );
      await expect(AuthService.register('User', 'bad-email', 'abc123')).rejects.toThrow(
        ValidationError
      );
      await expect(AuthService.register('User', 'user@example.com', '123')).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      const storedUser = buildMockUserInstance({
        comparePassword: vi.fn().mockResolvedValue(true),
      });
      userFindOneMock.mockResolvedValue(storedUser);

      const result = await AuthService.login('user@example.com', 'Password123');

      expect(storedUser.comparePassword).toHaveBeenCalledWith('Password123');
      expect(result.user.email).toBe('user@example.com');
      expect(result.tokens.accessToken).toBeDefined();
    });

    it('throws UnauthorizedError when user does not exist', async () => {
      userFindOneMock.mockResolvedValue(null);

      await expect(AuthService.login('missing@example.com', 'Password123')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError when password is invalid', async () => {
      const storedUser = buildMockUserInstance({
        comparePassword: vi.fn().mockResolvedValue(false),
      });
      userFindOneMock.mockResolvedValue(storedUser);

      await expect(AuthService.login('user@example.com', 'wrong-pass')).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  describe('getUserById', () => {
    it('returns the user when found', async () => {
      const storedUser = buildMockUserInstance();
      userFindByIdMock.mockResolvedValue(storedUser);

      const result = await AuthService.getUserById(storedUser._id.toString());

      expect(userFindByIdMock).toHaveBeenCalledWith(storedUser._id.toString());
      expect(result).toBe(storedUser);
    });

    it('throws NotFoundError when user is missing', async () => {
      userFindByIdMock.mockResolvedValue(null);

      await expect(AuthService.getUserById('507f191e810c19729de860ff')).rejects.toThrow(
        NotFoundError
      );
    });
  });
});
