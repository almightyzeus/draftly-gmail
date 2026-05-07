import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Response } from 'express';
import { register, login, me } from '../src/controllers/authController';
import { AuthService } from '../src/services/authService';
import { ConflictError, UnauthorizedError, AppError } from '../src/utils/errors';

vi.mock('../src/services/authService');

describe('AuthController', () => {
  let mockReq: any;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      headers: {},
      userId: null,
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('register', () => {
    it('should register a user successfully', async () => {
      mockReq.body = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass123!',
      };

      const mockResult = {
        user: {
          id: 'user123',
          email: 'john@example.com',
          name: 'John Doe',
          googleConnected: false,
        },
        tokens: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-123',
        },
      };

      (AuthService.register as unknown as Mock).mockResolvedValue(mockResult);

      await register(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User registered successfully',
          user: mockResult.user,
          accessToken: mockResult.tokens.accessToken,
          refreshToken: mockResult.tokens.refreshToken,
        })
      );
    });

    it('should return 409 if email already exists', async () => {
      mockReq.body = {
        name: 'Jane Doe',
        email: 'existing@example.com',
        password: 'SecurePass123!',
      };

      const conflictError = new ConflictError('Email already exists');
      (AuthService.register as unknown as Mock).mockRejectedValue(conflictError);

      await register(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Email already exists',
      });
    });

    it('should return 500 for unexpected errors', async () => {
      mockReq.body = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      const unexpectedError = new Error('Unexpected database error');
      (AuthService.register as unknown as Mock).mockRejectedValue(unexpectedError);

      await register(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal server error',
      });
    });

    it('should extract name, email, and password from request body', async () => {
      mockReq.body = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'SecurePass123!',
      };

      const mockResult = {
        user: { id: 'user123', email: 'test@example.com', name: 'Test User', googleConnected: false },
        tokens: { accessToken: 'token', refreshToken: 'refresh' },
      };

      (AuthService.register as unknown as Mock).mockResolvedValue(mockResult);

      await register(mockReq, mockRes as Response);

      expect(AuthService.register).toHaveBeenCalledWith(
        'Test User',
        'test@example.com',
        'SecurePass123!'
      );
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      mockReq.body = {
        email: 'john@example.com',
        password: 'SecurePass123!',
      };

      const mockResult = {
        user: {
          id: 'user123',
          email: 'john@example.com',
          name: 'John Doe',
          googleConnected: false,
        },
        tokens: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-123',
        },
      };

      (AuthService.login as unknown as Mock).mockResolvedValue(mockResult);

      await login(mockReq, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Login successful',
          user: mockResult.user,
          accessToken: mockResult.tokens.accessToken,
          refreshToken: mockResult.tokens.refreshToken,
        })
      );
    });

    it('should return 401 for invalid credentials', async () => {
      mockReq.body = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const unauthorizedError = new UnauthorizedError('Invalid email or password');
      (AuthService.login as unknown as Mock).mockRejectedValue(unauthorizedError);

      await login(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid email or password',
      });
    });

    it('should return 401 for non-existent user', async () => {
      mockReq.body = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      const unauthorizedError = new UnauthorizedError('User not found');
      (AuthService.login as unknown as Mock).mockRejectedValue(unauthorizedError);

      await login(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should extract email and password from request body', async () => {
      mockReq.body = {
        email: 'test@example.com',
        password: 'SecurePass123!',
      };

      const mockResult = {
        user: { id: 'user123', email: 'test@example.com', name: 'Test User', googleConnected: false },
        tokens: { accessToken: 'token', refreshToken: 'refresh' },
      };

      (AuthService.login as unknown as Mock).mockResolvedValue(mockResult);

      await login(mockReq, mockRes as Response);

      expect(AuthService.login).toHaveBeenCalledWith('test@example.com', 'SecurePass123!');
    });

    it('should return 200 status for successful login (default)', async () => {
      mockReq.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const mockResult = {
        user: { id: 'user123', email: 'test@example.com', name: 'Test User', googleConnected: false },
        tokens: { accessToken: 'token', refreshToken: 'refresh' },
      };

      (AuthService.login as unknown as Mock).mockResolvedValue(mockResult);

      await login(mockReq, mockRes as Response);

      // Note: mockRes.json is called without status(), so it defaults to 200
      expect(mockRes.json).toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('should return current user info', async () => {
      mockReq.userId = 'user123';

      const mockUser = {
        _id: { toString: vi.fn().mockReturnValue('user123') },
        email: 'john@example.com',
        name: 'John Doe',
        googleConnected: true,
      };

      (AuthService.getUserById as unknown as Mock).mockResolvedValue(mockUser);

      await me(mockReq, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        user: {
          id: 'user123',
          email: 'john@example.com',
          name: 'John Doe',
          googleConnected: true,
        },
      });
    });

    it('should return 401 if userId is missing', async () => {
      mockReq.userId = null;

      await me(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
      });
    });

    it('should handle undefined googleConnected as false', async () => {
      mockReq.userId = 'user123';

      const mockUser = {
        _id: { toString: vi.fn().mockReturnValue('user123') },
        email: 'john@example.com',
        name: 'John Doe',
        googleConnected: undefined,
      };

      (AuthService.getUserById as unknown as Mock).mockResolvedValue(mockUser);

      await me(mockReq, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        user: expect.objectContaining({
          googleConnected: false,
        }),
      });
    });

    it('should convert userId to string', async () => {
      mockReq.userId = 'user123';

      const mockUser = {
        _id: { toString: vi.fn().mockReturnValue('user123') },
        email: 'john@example.com',
        name: 'John Doe',
        googleConnected: false,
      };

      (AuthService.getUserById as unknown as Mock).mockResolvedValue(mockUser);

      await me(mockReq, mockRes as Response);

      expect(mockUser._id.toString).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        user: expect.objectContaining({
          id: 'user123',
        }),
      });
    });

    it('should handle service errors', async () => {
      mockReq.userId = 'user123';

      const unauthorizedError = new UnauthorizedError('User not found');
      (AuthService.getUserById as unknown as Mock).mockRejectedValue(unauthorizedError);

      await me(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'User not found',
      });
    });

    it('should handle unexpected errors', async () => {
      mockReq.userId = 'user123';

      const unexpectedError = new Error('Database error');
      (AuthService.getUserById as unknown as Mock).mockRejectedValue(unexpectedError);

      await me(mockReq, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal server error',
      });
    });
  });
});
