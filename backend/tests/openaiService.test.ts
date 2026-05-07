import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockState = {
  create: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: 'This is a mock reply',
        },
      },
    ],
  }),
};

vi.mock('openai', () => {
  return {
    OpenAI: vi.fn(() => ({
      chat: {
        completions: {
          create: (...args: any[]) => mockState.create(...args),
        },
      },
    })),
  };
});

vi.mock('../src/utils/logger');

// Import after mocking
import { OpenAIService } from '../src/services/openaiService.js';

describe('OpenAIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset mockCreate with default implementation
    mockState.create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: 'This is a mock reply',
          },
        },
      ],
    });
  });

  // Helper to access the mock for assertions
  const getMockCreate = () => mockState.create;

  describe('generateReply', () => {
    it('should generate a reply to an email', async () => {
      const emailBody = 'Can you help with the project?';
      const tone = 'formal';
      const signature = 'Best regards, John';

      const result = await OpenAIService.generateReply(emailBody, tone, signature);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Verify OpenAI was called with correct parameters
      expect(getMockCreate()).toHaveBeenCalled();
      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain(emailBody);
    });

    it('should use different tones appropriately', async () => {
      const emailBody = 'Can you help with the project?';
      const signature = 'Best regards';

      await OpenAIService.generateReply(emailBody, 'formal', signature);
      const formalCallArgs = getMockCreate().mock.calls[0][0];
      expect(formalCallArgs.messages[0].content).toContain('professional');

      getMockCreate().mockClear();

      await OpenAIService.generateReply(emailBody, 'friendly', signature);
      const friendlyCallArgs = getMockCreate().mock.calls[0][0];
      expect(friendlyCallArgs.messages[0].content).toContain('friendly');
    });

    it('should include signature in system prompt', async () => {
      const emailBody = 'Test email';
      const signature = 'Unique Signature 12345';

      await OpenAIService.generateReply(emailBody, 'formal', signature);

      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain(signature);
    });

    it('should handle empty email body gracefully', async () => {
      const result = await OpenAIService.generateReply('', 'formal', 'Signature');

      expect(typeof result).toBe('string');
      expect(getMockCreate()).toHaveBeenCalled();
    });

    it('should handle very long email body', async () => {
      const longBody = 'x'.repeat(5000);

      const result = await OpenAIService.generateReply(longBody, 'formal', 'Signature');

      expect(typeof result).toBe('string');
      expect(getMockCreate()).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 500,
        })
      );
    });

    it('should return fallback message when OpenAI returns empty content', async () => {
      getMockCreate().mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const result = await OpenAIService.generateReply('test', 'formal', '');

      expect(result).toBe('Failed to generate reply');
    });

    it('should throw error when OpenAI call fails', async () => {
      getMockCreate().mockRejectedValueOnce(new Error('OpenAI API error'));

      await expect(
        OpenAIService.generateReply('test', 'formal', '')
      ).rejects.toThrow('OpenAI API error');
    });
  });

  describe('generateConsolidatedReply', () => {
    it('should generate reply addressing multiple emails', async () => {
      const emails = [
        { from: 'sender1@example.com', subject: 'Question 1', body: 'First question' },
        { from: 'sender2@example.com', subject: 'Question 2', body: 'Second question' },
      ];
      const tone = 'formal';

      const result = await OpenAIService.generateConsolidatedReply(emails, tone, 'Signature');

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(getMockCreate()).toHaveBeenCalled();
    });

    it('should address all emails in consolidated reply prompt', async () => {
      const emails = [
        { from: 'sender1@example.com', subject: 'Q1', body: 'First' },
        { from: 'sender2@example.com', subject: 'Q2', body: 'Second' },
        { from: 'sender3@example.com', subject: 'Q3', body: 'Third' },
      ];

      await OpenAIService.generateConsolidatedReply(emails, 'friendly', 'Sig');

      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('sender1@example.com');
      expect(callArgs.messages[1].content).toContain('sender2@example.com');
      expect(callArgs.messages[1].content).toContain('sender3@example.com');
    });

    it('should handle empty emails array', async () => {
      const result = await OpenAIService.generateConsolidatedReply([], 'formal', 'Sig');

      expect(typeof result).toBe('string');
    });

    it('should throw error when OpenAI call fails', async () => {
      getMockCreate().mockRejectedValueOnce(new Error('OpenAI API error'));

      await expect(
        OpenAIService.generateConsolidatedReply(
          [{ from: 'test@example.com', subject: 'Test', body: 'Test' }],
          'formal',
          ''
        )
      ).rejects.toThrow('OpenAI API error');
    });
  });

  describe('extractKeyPoints', () => {
    it('should extract key points from email', async () => {
      const emailBody = 'Can you review the document? Also need feedback on the budget. Timeline for review?';

      getMockCreate().mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify(['Review document', 'Provide budget feedback', 'Determine timeline']),
            },
          },
        ],
      });

      const result = await OpenAIService.extractKeyPoints(emailBody);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result).toContain('Review document');
      expect(result).toContain('Provide budget feedback');
    });

    it('should handle emails with no clear points', async () => {
      const emailBody = 'Hi there';

      getMockCreate().mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify([]),
            },
          },
        ],
      });

      const result = await OpenAIService.extractKeyPoints(emailBody);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle non-JSON response gracefully', async () => {
      getMockCreate().mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'This is not JSON',
            },
          },
        ],
      });

      const result = await OpenAIService.extractKeyPoints('test email');

      // Should return empty array when JSON parsing fails
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle empty string response', async () => {
      getMockCreate().mockResolvedValueOnce({
        choices: [{ message: { content: '' } }],
      });

      const result = await OpenAIService.extractKeyPoints('test');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw error when OpenAI call fails', async () => {
      getMockCreate().mockRejectedValueOnce(new Error('OpenAI API error'));

      await expect(
        OpenAIService.extractKeyPoints('test email')
      ).rejects.toThrow('OpenAI API error');
    });
  });

  describe('tone handling', () => {
    it('should use formal tone correctly', async () => {
      await OpenAIService.generateReply('test', 'formal', 'sig');

      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('professional');
      expect(callArgs.messages[0].content).toContain('formal');
    });

    it('should use concise tone correctly', async () => {
      await OpenAIService.generateReply('test', 'concise', 'sig');

      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('brief');
      expect(callArgs.messages[0].content).toContain('to-the-point');
    });

    it('should use friendly tone correctly', async () => {
      await OpenAIService.generateReply('test', 'friendly', 'sig');

      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('friendly');
      expect(callArgs.messages[0].content).toContain('warm');
    });

    it('should default to formal tone for unknown tone', async () => {
      await OpenAIService.generateReply('test', 'unknown-tone', 'sig');

      const callArgs = getMockCreate().mock.calls[0][0];
      // Should fall back to formal tone instructions
      expect(callArgs.messages[0].content).toContain('professional');
    });
  });
});
