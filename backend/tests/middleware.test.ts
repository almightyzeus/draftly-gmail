import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authenticateJWT, AuthRequest } from '../src/middleware/auth.js';
import jwt from 'jsonwebtoken';

vi.mock('../src/utils/logger');

describe('Auth Middleware', () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: Mock;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      cookies: {},
    };
        mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    mockNext = vi.fn();
  });

  describe('authenticateJWT', () => {
    it('should call next if valid token provided in Authorization header', () => {
      const userId = 'user123';
      const token = jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET || 'test-secret', {
        expiresIn: '15m',
      });

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as AuthRequest).userId).toBe(userId);
    });

    it('should reject request without authorization header or cookie', () => {
      mockRequest.headers = {};
      mockRequest.cookies = {};

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect((mockResponse as any).status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid_token',
      };

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect((mockResponse as any).status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('rejects a valid token supplied only as a cookie (cookies outlive logout)', () => {
      const token = jwt.sign({ userId: 'user123' }, process.env.JWT_ACCESS_SECRET || 'test-secret', {
        expiresIn: '15m',
      });

      mockRequest.headers = {};
      mockRequest.cookies = { accessToken: token };

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect((mockResponse as any).status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it.each([
      ['an OAuth state token (type + audience)', { type: 'gmail_oauth' }, { audience: 'gmail-oauth-state' }],
      ['a legacy OAuth state token (type only)', { type: 'gmail_oauth' }, {}],
      ['any token with an audience', {}, { audience: 'something-else' }],
    ])('rejects %s used as a Bearer access token', (_label, extraClaims, signOptions) => {
      const token = jwt.sign(
        { userId: 'user123', ...extraClaims },
        process.env.JWT_ACCESS_SECRET || 'test-secret',
        { expiresIn: '10m', algorithm: 'HS256', ...signOptions }
      );
      mockRequest.headers = { authorization: `Bearer ${token}` };

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect((mockResponse as any).status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
      expect((mockRequest as AuthRequest).userId).toBeUndefined();
    });

    it('should handle expired tokens', () => {
      const expiredToken = jwt.sign(
        { userId: 'user123' },
        process.env.JWT_ACCESS_SECRET || 'test-secret',
        { expiresIn: '-1h' }
      );

      mockRequest.headers = {
        authorization: `Bearer ${expiredToken}`,
      };

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect((mockResponse as any).status).toHaveBeenCalledWith(401);
    });

    it('should extract userId and email from token', () => {
      const userId = 'user123';
      const email = 'test@example.com';
      const token = jwt.sign({ userId, email }, process.env.JWT_ACCESS_SECRET || 'test-secret', {
        expiresIn: '15m',
      });

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      authenticateJWT(mockRequest as AuthRequest, mockResponse as Response, mockNext);

      expect((mockRequest as AuthRequest).userId).toBe(userId);
      expect((mockRequest as AuthRequest).email).toBe(email);
    });
  });
});

