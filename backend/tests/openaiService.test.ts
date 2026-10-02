import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

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

vi.mock('../src/models/EmailMessage.js', () => ({
  EmailMessage: { findOne: vi.fn(), find: vi.fn() },
}));

vi.mock('../src/models/UserPreference.js', () => ({
  UserPreference: { findOne: vi.fn() },
}));

// Import after mocking
import { OpenAIService } from '../src/services/openaiService.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { UserPreference } from '../src/models/UserPreference.js';

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

  describe('generateDraft', () => {
    it('puts every selected unread message in the prompt while retaining thread context and preferences', async () => {
      const newestEmail = {
        gmailMessageId: 'msg-2',
        threadId: 'thread-1',
        from: 'newest@example.com',
        subject: 'Second question',
        bodyPlain: 'Can you also confirm the timeline?',
      };
      const earlierEmail = {
        gmailMessageId: 'msg-1',
        threadId: 'thread-1',
        from: 'earlier@example.com',
        subject: 'First question',
        bodyPlain: 'Can you review the proposal?',
      };
      const outboundContext = {
        gmailMessageId: 'sent-1',
        threadId: 'thread-1',
        from: 'user@example.com',
        subject: 'Earlier reply',
        bodyPlain: 'Thanks for reaching out.',
      };

      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(newestEmail);
      (EmailMessage.find as unknown as Mock)
        .mockReturnValueOnce({
          sort: vi.fn().mockReturnThis(),
          lean: vi.fn().mockResolvedValue([earlierEmail, newestEmail, outboundContext]),
        })
        .mockReturnValueOnce({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          lean: vi.fn().mockResolvedValue([outboundContext]),
        });
      (UserPreference.findOne as unknown as Mock).mockResolvedValue({
        signature: 'Regards, User',
        learningEmailCount: 1,
      });

      await OpenAIService.generateDraft(
        '507f191e810c19729de860ea',
        ['msg-2', 'msg-1'],
        'friendly',
        'Please mention Friday.'
      );

      const callArgs = getMockCreate().mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('Regards, User');
      expect(callArgs.messages[1].content).toContain('Can you also confirm the timeline?');
      expect(callArgs.messages[1].content).toContain('Can you review the proposal?');
      expect(callArgs.messages[1].content).toContain('Thanks for reaching out.');
      expect(callArgs.messages[1].content).toContain('Please mention Friday.');
    });

    it.each([null, '', '   \n '])('throws instead of saving placeholder text when the AI returns %j', async (content) => {
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue({
        gmailMessageId: 'msg-1',
        threadId: 'thread-1',
        from: 'a@example.com',
        subject: 'Hi',
        bodyPlain: 'Hello',
      });
      (EmailMessage.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([]),
      });
      (UserPreference.findOne as unknown as Mock).mockResolvedValue(null);
      getMockCreate().mockResolvedValueOnce({ choices: [{ message: { content } }] });

      await expect(OpenAIService.generateDraft('507f191e810c19729de860ea', ['msg-1'])).rejects.toMatchObject({
        statusCode: 502,
        message: 'The AI returned an empty draft. Please try again.',
      });
    });
  });

  describe('generateDraft prompt construction', () => {
    const arrangeEmail = (bodyPlain = 'Can you help?') => {
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue({
        gmailMessageId: 'msg-1',
        threadId: 'thread-1',
        from: 'sender@example.com',
        subject: 'Question',
        bodyPlain,
      });
      (EmailMessage.find as unknown as Mock).mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([{ gmailMessageId: 'msg-1', from: 'sender@example.com', subject: 'Question', bodyPlain }]),
      });
      (UserPreference.findOne as unknown as Mock).mockResolvedValue({ signature: 'sig', learningEmailCount: 1 });
    };
    const systemPrompt = () => getMockCreate().mock.calls[0][0].messages[0].content as string;
    const userPrompt = () => getMockCreate().mock.calls[0][0].messages[1].content as string;

    it.each([
      ['formal', ['professional', 'formal']],
      ['concise', ['brief', 'to-the-point']],
      ['friendly', ['friendly', 'warm']],
      ['unknown-tone', ['professional']],
    ])('applies the %s tone instructions', async (tone, phrases) => {
      arrangeEmail();

      await OpenAIService.generateDraft('507f191e810c19729de860ea', ['msg-1'], tone);

      for (const phrase of phrases) {
        expect(systemPrompt()).toContain(phrase);
      }
    });

    it('uses the configured model, not a hard-coded default', async () => {
      const { env } = await import('../src/config/env.js');
      arrangeEmail();

      await OpenAIService.generateDraft('507f191e810c19729de860ea', ['msg-1']);

      expect(getMockCreate().mock.calls[0][0].model).toBe(env.openai.model);
    });

    it('truncates very long untrusted email bodies and custom context', async () => {
      arrangeEmail('A'.repeat(50_000));

      await OpenAIService.generateDraft('507f191e810c19729de860ea', ['msg-1'], 'formal', 'C'.repeat(10_000));

      const prompt = userPrompt();
      expect(prompt).toContain('[...truncated]');
      expect(prompt.match(/A+/g)!.every((run) => run.length <= 4_000)).toBe(true);
      expect(prompt.match(/C+/g)!.every((run) => run.length <= 2_000)).toBe(true);
      expect(prompt.length).toBeLessThan(20_000);
    });
  });
});
