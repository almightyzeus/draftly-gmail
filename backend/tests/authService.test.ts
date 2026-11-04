import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { AuthService } from '../src/services/authService.js';
import { User } from '../src/models/User.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../src/utils/errors.js';

const mocks = vi.hoisted(() => ({
  userFindOne: vi.fn(),
  userFindById: vi.fn(),
  preferenceCreate: vi.fn(),
}));

vi.mock('../src/models/User.js', () => {
  const UserMock = Object.assign(vi.fn(), {
    findOne: mocks.userFindOne,
    findById: mocks.userFindById,
  });
  return { User: UserMock };
});

vi.mock('../src/models/UserPreference.js', () => ({
  UserPreference: {
    create: mocks.preferenceCreate,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const buildUser = (overrides: Record<string, any> = {}) => ({
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
    (User as unknown as Mock).mockImplementation(function () { return buildUser(); });
  });

  it('generates access and refresh JWTs', () => {
    const tokens = AuthService.generateTokens('507f191e810c19729de860ea', 'user@example.com');
    expect(tokens.accessToken.split('.')).toHaveLength(3);
    expect(tokens.refreshToken.split('.')).toHaveLength(3);
  });

  it('rotates a valid refresh token and rejects invalid or orphaned tokens', async () => {
    const user = buildUser();
    mocks.userFindById.mockResolvedValue(user);
    const { refreshToken } = AuthService.generateTokens(user._id.toString(), user.email);

    const tokens = await AuthService.refreshTokens(refreshToken);
    expect(tokens.accessToken.split('.')).toHaveLength(3);
    expect(tokens.refreshToken.split('.')).toHaveLength(3);
    expect(mocks.userFindById).toHaveBeenCalledWith(user._id.toString());

    await expect(AuthService.refreshTokens('invalid-token')).rejects.toThrow(UnauthorizedError);

    mocks.userFindById.mockResolvedValue(null);
    await expect(AuthService.refreshTokens(refreshToken)).rejects.toThrow('User not found');
  });

  it('registers a new user and default preferences', async () => {
    const instance = buildUser({ email: 'new@example.com' });
    (User as unknown as Mock).mockImplementation(function () { return instance; });
    mocks.userFindOne.mockResolvedValue(null);
    mocks.preferenceCreate.mockResolvedValue({});

    const result = await AuthService.register('Test User', 'NEW@example.com', 'password123');

    expect(mocks.userFindOne).toHaveBeenCalledWith({ email: 'new@example.com' });
    expect(instance.save).toHaveBeenCalled();
    expect(UserPreference.create).toHaveBeenCalledWith(expect.objectContaining({ userId: instance._id }));
    expect(result.user.email).toBe('new@example.com');
  });

  it('rejects duplicate registration and invalid input', async () => {
    mocks.userFindOne.mockResolvedValue(buildUser());
    await expect(AuthService.register('User', 'user@example.com', 'password123')).rejects.toThrow(ConflictError);
    await expect(AuthService.register('', 'user@example.com', 'password123')).rejects.toThrow(ValidationError);
    await expect(AuthService.register('User', 'bad-email', 'password123')).rejects.toThrow(ValidationError);
  });

  it.each([
    ['7 characters', 'short12', 'Password must be at least 8 characters'],
    ['over 72 bytes (bcrypt would truncate it)', 'é'.repeat(37), 'Password must be at most 72 bytes'],
  ])('rejects a new password of %s', async (_label, password, message) => {
    mocks.userFindOne.mockResolvedValue(null);
    await expect(AuthService.register('User', 'new@example.com', password)).rejects.toThrow(message);
  });

  it('accepts a new password of exactly 8 characters and of exactly 72 bytes', async () => {
    mocks.userFindOne.mockResolvedValue(null);
    await expect(AuthService.register('User', 'new@example.com', 'eight888')).resolves.toBeTruthy();
    await expect(AuthService.register('User', 'new2@example.com', 'é'.repeat(36))).resolves.toBeTruthy();
  });

  it('still lets an existing user with a shorter (older) password log in', async () => {
    mocks.userFindOne.mockResolvedValue(buildUser({ comparePassword: vi.fn().mockResolvedValue(true) }));
    await expect(AuthService.login('user@example.com', 'six666')).resolves.toBeTruthy();
  });

  it('logs in valid users and rejects invalid credentials', async () => {
    const storedUser = buildUser({ comparePassword: vi.fn().mockResolvedValue(true) });
    mocks.userFindOne.mockResolvedValue(storedUser);

    const result = await AuthService.login('USER@example.com', 'password123');
    expect(result.user.email).toBe('test@example.com');
    expect(storedUser.comparePassword).toHaveBeenCalledWith('password123');

    mocks.userFindOne.mockResolvedValue(null);
    await expect(AuthService.login('missing@example.com', 'password123')).rejects.toThrow(UnauthorizedError);

    mocks.userFindOne.mockResolvedValue(buildUser({ comparePassword: vi.fn().mockResolvedValue(false) }));
    await expect(AuthService.login('user@example.com', 'wrong')).rejects.toThrow(UnauthorizedError);
  });

  it('gets a user by id', async () => {
    const user = buildUser();
    mocks.userFindById.mockResolvedValue(user);
    await expect(AuthService.getUserById(user._id.toString())).resolves.toBe(user);

    mocks.userFindById.mockResolvedValue(null);
    await expect(AuthService.getUserById(user._id.toString())).rejects.toThrow(NotFoundError);
  });
});
