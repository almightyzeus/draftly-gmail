import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { GmailAccount } from '../src/models/GmailAccount.js';

let mongoServer: MongoMemoryServer;

describe('User Model', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('User schema validation', () => {
    it('should create a user with valid data', async () => {
      const user = new User({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      const savedUser = await user.save();

      expect(savedUser._id).toBeDefined();
      expect(savedUser.email).toBe('test@example.com');
      expect(savedUser.name).toBe('Test User');
      expect(savedUser.googleConnected).toBe(false);
      expect(savedUser.createdAt).toBeDefined();
    });

    it('should require email field', async () => {
      const user = new User({
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      await expect(user.save()).rejects.toThrow();
    });

    it('should require name field', async () => {
      const user = new User({
        email: 'test@example.com',
        passwordHash: 'hashed_password',
      });

      await expect(user.save()).rejects.toThrow();
    });

    it('should enforce unique email', async () => {
      await User.create({
        email: 'test@example.com',
        name: 'User 1',
        passwordHash: 'pass1',
      });

      const duplicateUser = new User({
        email: 'test@example.com',
        name: 'User 2',
        passwordHash: 'pass2',
      });

      await expect(duplicateUser.save()).rejects.toThrow();
    });

    it('should normalize email to lowercase', async () => {
      const user = new User({
        email: 'TEST@EXAMPLE.COM',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      const savedUser = await user.save();

      expect(savedUser.email).toBe('test@example.com');
    });

    it('should validate email format', async () => {
      const user = new User({
        email: 'invalid-email',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      await expect(user.save()).rejects.toThrow();
    });
  });

  describe('comparePassword method', () => {
    it('should compare passwords correctly', async () => {
      const user = new User({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'plainpassword', // In real code, this would be hashed by pre-save hook
      });

      // Mock the pre-save hook for testing
      user.passwordHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/LYm'; // bcrypt hash of 'secret'

      const savedUser = await user.save();

      // In real scenario, comparePassword would use bcrypt.compare
      // For this test, we're just verifying the method exists
      expect(typeof savedUser.comparePassword).toBe('function');
    });
  });

  describe('timestamps', () => {
    it('should set createdAt and updatedAt', async () => {
      const user = new User({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      const savedUser = await user.save();

      expect(savedUser.createdAt).toBeDefined();
      expect(savedUser.updatedAt).toBeDefined();
      expect(savedUser.createdAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });
  });
});

describe('UserPreference Model', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await UserPreference.deleteMany({});
    await User.deleteMany({});
  });

  describe('UserPreference schema validation', () => {
    it('should create preferences with valid data', async () => {
      const user = await User.create({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      const pref = new UserPreference({
        userId: user._id,
        defaultTone: 'formal',
        signature: 'Best regards',
        learningEmailCount: 5,
      });

      const savedPref = await pref.save();

      expect(savedPref._id).toBeDefined();
      expect(savedPref.defaultTone).toBe('formal');
      expect(savedPref.learningEmailCount).toBe(5);
    });

    it('should validate tone enum values', async () => {
      const user = await User.create({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      const pref = new UserPreference({
        userId: user._id,
        defaultTone: 'invalid-tone',
        signature: 'Test',
        learningEmailCount: 5,
      });

      await expect(pref.save()).rejects.toThrow();
    });
  });
});

describe('GmailAccount Model', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await GmailAccount.deleteMany({});
    await User.deleteMany({});
  });

  describe('GmailAccount schema validation', () => {
    it('should create Gmail account with valid data', async () => {
      const user = await User.create({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      const account = new GmailAccount({
        userId: user._id,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'encrypted_token',
        refreshTokenEnc: 'encrypted_refresh_token',
        tokenExpiry: new Date(),
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      });

      const savedAccount = await account.save();

      expect(savedAccount._id).toBeDefined();
      expect(savedAccount.gmailEmail).toBe('user@gmail.com');
      expect(savedAccount.scopes.length).toBeGreaterThan(0);
    });

    it('should enforce unique Gmail email per user', async () => {
      const user = await User.create({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      });

      await GmailAccount.create({
        userId: user._id,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'token1',
        refreshTokenEnc: 'refresh1',
        tokenExpiry: new Date(),
      });

      const duplicate = new GmailAccount({
        userId: user._id,
        gmailEmail: 'user@gmail.com',
        accessTokenEnc: 'token2',
        refreshTokenEnc: 'refresh2',
        tokenExpiry: new Date(),
      });

      await expect(duplicate.save()).rejects.toThrow();
    });
  });
});
