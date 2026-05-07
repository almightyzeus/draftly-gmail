import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { GmailAccount } from '../src/models/GmailAccount.js';
import { Draft } from '../src/models/Draft.js';
import { EmailMessage } from '../src/models/EmailMessage.js';

// Mock OpenAI service
vi.mock('../src/services/openaiService', () => ({
  OpenAIService: {
    generateReply: vi.fn().mockResolvedValue('This is a mock generated reply.'),
    generateConsolidatedReply: vi.fn().mockResolvedValue('This is a mock consolidated reply.'),
    extractKeyPoints: vi.fn().mockResolvedValue(['Point 1', 'Point 2']),
    generateDraft: vi.fn().mockResolvedValue('This is a mock draft body generated from the email thread.'),
  },
}));

// Mock Gmail service
vi.mock('../src/services/gmailOAuthService', () => ({
  GmailOAuthService: {
    getAuthorizationUrl: vi.fn().mockReturnValue('https://mock-auth-url.com'),
    exchangeCodeForTokens: vi.fn().mockResolvedValue({ accessToken: 'mock_token', refreshToken: 'mock_refresh' }),
  },
}));

vi.mock('../src/utils/logger');

let mongoServer: MongoMemoryServer;

const extractTokens = (body: any) => ({
  accessToken: body?.tokens?.accessToken ?? body?.accessToken,
  refreshToken: body?.tokens?.refreshToken ?? body?.refreshToken,
});

describe('Integration Tests — Critical Workflows', () => {
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
    await GmailAccount.deleteMany({});
    await Draft.deleteMany({});
    await EmailMessage.deleteMany({});
  });

  describe('Workflow: Register → Login → Connect Gmail', () => {
    it('should complete user registration', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass123!',
        });

            expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      const tokens = extractTokens(response.body);
      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(response.body.user.email).toBe('john@example.com');
      expect(response.body.user.googleConnected).toBe(false);
    });

    it('should prevent duplicate email registration', async () => {
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass123!',
        });

      // Second registration with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'john@example.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(409); // Conflict
    });

    it('should allow login after registration', async () => {
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass123!',
        });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'john@example.com',
          password: 'SecurePass123!',
        });

            expect(loginResponse.status).toBe(200);
      const loginTokens = extractTokens(loginResponse.body);
      expect(loginTokens.accessToken).toBeDefined();
    });

    it('should reject login with wrong password', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass123!',
        });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'john@example.com',
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('Workflow: Draft Generation and Management', () => {
    let authToken: string;
    let userId: string;
    let userObjectId: Types.ObjectId;

    beforeEach(async () => {
      // Register and login user
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        });

      userId = registerResponse.body.user.id;
      userObjectId = new Types.ObjectId(userId);
      authToken = extractTokens(registerResponse.body).accessToken;

      console.log('User registered - userId string:', userId, 'ObjectId:', userObjectId.toString());

      // Create test email with proper ObjectId
      try {
        const emailResult = await EmailMessage.create({
          userId: userObjectId,
          gmailMessageId: 'msg_123',
          threadId: 'thread_123',
          from: 'sender@example.com',
          to: 'test@example.com',
          subject: 'Test Email',
          snippet: 'This is a test',
          bodyPlain: 'This is the body of the test email',
          direction: 'INBOUND',
          internalDate: new Date(),
        });

        console.log('Email created successfully - ID:', emailResult._id, 'userId:', emailResult.userId.toString());

        // Verify email was created and can be found
        const verifyEmail = await EmailMessage.findOne({
          userId: userObjectId,
          gmailMessageId: 'msg_123',
        });
        if (!verifyEmail) {
          console.error('ERROR: Email was created but cannot be found!');
          throw new Error('Email verification failed');
        }
        console.log('Email verification passed - found email:', verifyEmail._id);
      } catch (error) {
        console.error('Failed to create email:', error);
        throw error;
      }
    });

    it('should generate draft from email', async () => {
      console.log('\n=== GENERATE DRAFT TEST ===');
      console.log('User ID (string):', userId);
      console.log('User ID (ObjectId):', userObjectId.toString());

      // Verify email exists
      const emailCheck = await EmailMessage.findOne({
        userId: userObjectId,
        gmailMessageId: 'msg_123',
      });
      console.log('Email found in DB:', !!emailCheck);

      const response = await request(app)
        .post('/api/drafts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gmailMessageId: 'msg_123',
          tone: 'formal',
        });

      console.log('Response status:', response.status);
      console.log('Response body keys:', Object.keys(response.body));
      
      expect([200, 201]).toContain(response.status);
      
      const draftId = response.body.id || response.body._id;
      expect(draftId).toBeDefined();
      expect(response.body.status).toBe('PENDING');
      expect(response.body.tone).toBe('formal');
      expect(response.body.draftBody).toBeDefined();
      expect(typeof response.body.draftBody).toBe('string');
    });

    it('should list generated drafts', async () => {
      console.log('\n=== LIST DRAFTS TEST ===');
      console.log('User ID:', userId);

      // Generate draft first
      const generateResponse = await request(app)
        .post('/api/drafts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gmailMessageId: 'msg_123',
          tone: 'formal',
        });

      console.log('Generate response status:', generateResponse.status);
      expect([200, 201]).toContain(generateResponse.status);

      // List drafts
      const listResponse = await request(app)
        .get('/api/drafts')
        .set('Authorization', `Bearer ${authToken}`);

      console.log('List response status:', listResponse.status);
      console.log('List response is array:', Array.isArray(listResponse.body));
      console.log('List response body type:', typeof listResponse.body);
      
      expect(listResponse.status).toBe(200);
      
      // Response should be an array directly (not wrapped in an object)
      const drafts = Array.isArray(listResponse.body) ? listResponse.body : listResponse.body.drafts || [];
      
      console.log('Drafts count:', drafts.length);
      
      expect(Array.isArray(drafts)).toBe(true);
      expect(drafts.length).toBeGreaterThanOrEqual(1);
    });

    it('should edit draft', async () => {
      // Generate draft
      const generateResponse = await request(app)
        .post('/api/drafts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gmailMessageId: 'msg_123',
          tone: 'formal',
        });

      expect([200, 201]).toContain(generateResponse.status);
      const draftId = generateResponse.body.id || generateResponse.body._id;
      const newBody = 'Updated draft body';

      const editResponse = await request(app)
        .put(`/api/drafts/${draftId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          draftBody: newBody,
        });

      expect(editResponse.status).toBe(200);
      expect(editResponse.body.draftBody).toBe(newBody);
    });

    it('should approve draft', async () => {
      // Generate draft
      const generateResponse = await request(app)
        .post('/api/drafts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gmailMessageId: 'msg_123',
          tone: 'formal',
        });

      expect([200, 201]).toContain(generateResponse.status);
      const draftId = generateResponse.body.id || generateResponse.body._id;

      const approveResponse = await request(app)
        .post(`/api/drafts/${draftId}/approve`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(approveResponse.status).toBe(200);
      expect(approveResponse.body.status).toBe('APPROVED');
      expect(approveResponse.body.approvedAt).toBeDefined();
    });

    it('should reject draft', async () => {
      // Generate draft
      const generateResponse = await request(app)
        .post('/api/drafts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gmailMessageId: 'msg_123',
          tone: 'formal',
        });

      expect([200, 201]).toContain(generateResponse.status);
      const draftId = generateResponse.body.id || generateResponse.body._id;

      const rejectResponse = await request(app)
        .post(`/api/drafts/${draftId}/reject`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(rejectResponse.status).toBe(200);
      expect(rejectResponse.body.status).toBe('REJECTED');
    });
  });

  describe('Workflow: Preferences Management', () => {
    let authToken: string;

    beforeEach(async () => {
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'SecurePass123!',
        });

      authToken = extractTokens(registerResponse.body).accessToken;
    });

    it('should get user preferences', async () => {
      const response = await request(app)
        .get('/api/preferences')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('defaultTone');
    });

    it('should update user preferences', async () => {
      const response = await request(app)
        .put('/api/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          defaultTone: 'concise',
          signature: 'Best regards, Test User',
          learningEmailCount: 10,
        });

      expect(response.status).toBe(200);
      expect(response.body.defaultTone).toBe('concise');
      expect(response.body.signature).toBe('Best regards, Test User');
      expect(response.body.learningEmailCount).toBe(10);
    });
  });

  describe('Workflow: Authentication & Authorization', () => {
    it('should require authorization header for protected routes', async () => {
      const response = await request(app).get('/api/drafts');

      expect(response.status).toBe(401);
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/drafts')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
    });

    it('should prevent users from accessing other users data', async () => {
      // Create two users
      const user1Response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'User 1',
          email: 'user1@example.com',
          password: 'Pass123!',
        });

      const user2Response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'User 2',
          email: 'user2@example.com',
          password: 'Pass123!',
        });

            const user1Token = extractTokens(user1Response.body).accessToken;
      const user2Token = extractTokens(user2Response.body).accessToken;
      const user1Id = user1Response.body.user.id;

      // Create draft for user 1
      const draftId = new Types.ObjectId();
      const user1ObjectId = new Types.ObjectId(user1Id);
      await Draft.create({
        _id: draftId,
        userId: user1ObjectId,
        gmailMessageId: 'msg_123',
        threadId: 'thread_123',
        draftBody: 'Private draft',
        status: 'PENDING',
      });

      // Try to access with user 2 token (should fail - unauthorized)
      const response = await request(app)
        .get(`/api/drafts/${draftId.toString()}`)
        .set('Authorization', `Bearer ${user2Token}`);

      // Should either be 404 or 403 depending on implementation
      expect([403, 404]).toContain(response.status);
    });
  });
});
