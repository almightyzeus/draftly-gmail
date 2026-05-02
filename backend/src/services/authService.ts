import jwt, { SignOptions } from 'jsonwebtoken';
import { User, IUser } from '../models/User.js';
import { UserPreference } from '../models/UserPreference.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  ValidationError,
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  InternalServerError,
} from '../utils/errors.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    googleConnected: boolean;
  };
  tokens: TokenPair;
}

export class AuthService {
  /**
   * Generate access and refresh JWT tokens
   */
  static generateTokens(userId: string, email: string): TokenPair {
    const payload = { userId, email };
    
    const accessToken = jwt.sign(payload, env.jwt.accessSecret, {
      expiresIn: env.jwt.accessExpiresIn,
      algorithm: 'HS256',
    } as any);
    
    const refreshToken = jwt.sign(payload, env.jwt.refreshSecret, {
      expiresIn: env.jwt.refreshExpiresIn,
      algorithm: 'HS256',
    } as any);

    return { accessToken, refreshToken };
  }

  /**
   * Register a new user
   */
  static async register(
    name: string,
    email: string,
    password: string
  ): Promise<AuthResponse> {
    // Validate inputs
    this.validateRegisterInputs(name, email, password);

    // Convert email to lowercase
    const normalizedEmail = email.toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      logger.info({ email: normalizedEmail }, 'Registration attempt with existing email');
      throw new ConflictError('Email already registered');
    }

    try {
      // Create new user (password will be hashed by pre-save hook)
      const user = new User({
        name,
        email: normalizedEmail,
        passwordHash: password,
      });

      await user.save();

      // Create default user preferences
      await UserPreference.create({
        userId: user._id,
        defaultTone: 'formal',
        signature: '',
        learningEmailCount: 5,
      });

      const tokens = this.generateTokens(user._id.toString(), user.email);

      logger.info({ userId: user._id, email: normalizedEmail }, 'User registered successfully');

      return {
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          googleConnected: user.googleConnected || false,
        },
        tokens,
      };
    } catch (error) {
      if (error instanceof ConflictError) {
        throw error;
      }
      logger.error({ error, email: normalizedEmail }, 'User registration failed');
      throw new InternalServerError('Registration failed');
    }
  }

  /**
   * Login user with email and password
   */
  static async login(email: string, password: string): Promise<AuthResponse> {
    this.validateLoginInputs(email, password);

    const normalizedEmail = email.toLowerCase();

    try {
      // Find user by email
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        logger.info({ email: normalizedEmail }, 'Login attempt with non-existent email');
        throw new UnauthorizedError('Invalid email or password');
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        logger.info({ email: normalizedEmail }, 'Login attempt with invalid password');
        throw new UnauthorizedError('Invalid email or password');
      }

      const tokens = this.generateTokens(user._id.toString(), user.email);

      logger.info({ userId: user._id, email: normalizedEmail }, 'User logged in successfully');

      return {
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          googleConnected: user.googleConnected || false,
        },
        tokens,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      logger.error({ error, email: normalizedEmail }, 'Login failed');
      throw new InternalServerError('Login failed');
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: string): Promise<IUser> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      logger.error({ error, userId }, 'Failed to fetch user');
      throw new InternalServerError('Failed to fetch user');
    }
  }

  /**
   * Validate register input
   */
  private static validateRegisterInputs(
    name: string,
    email: string,
    password: string
  ): void {
    if (!name?.trim()) {
      throw new ValidationError('Name is required');
    }

    if (!email?.trim()) {
      throw new ValidationError('Email is required');
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      throw new ValidationError('Invalid email format');
    }

    if (!password || password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }
  }

  /**
   * Validate login input
   */
  private static validateLoginInputs(email: string, password: string): void {
    if (!email?.trim()) {
      throw new ValidationError('Email is required');
    }

    if (!password) {
      throw new ValidationError('Password is required');
    }
  }
}

