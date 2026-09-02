import { OpenAI } from 'openai';
import { Types } from 'mongoose';
import { EmailMessage } from '../models/EmailMessage.js';
import { UserPreference } from '../models/UserPreference.js';
import { GmailService } from './gmailService.js';
import { logger } from '../utils/logger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * OpenAI Service - Handles draft generation using GPT-4
 */
export class OpenAIService {
  private static readonly DEFAULT_LEARNING_COUNT = 5;
  private static readonly GPT_MODEL = process.env.OPENAI_MODEL || 'gpt-4-turbo';

  /**
   * Fetch learning emails (outbound emails for style reference)
   */
  private static async fetchLearningEmails(
    userId: string,
    count: number = this.DEFAULT_LEARNING_COUNT
  ): Promise<string> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const outboundEmails = await EmailMessage.find({
        userId: userObjectId,
        direction: 'OUTBOUND',
      })
        .sort({ internalDate: -1 })
        .limit(count)
        .lean();

      if (outboundEmails.length === 0) {
        return '';
      }

      const styleExamples = outboundEmails
        .map((email: any) => `Subject: ${email.subject}\n\n${email.bodyPlain}`)
        .join('\n---\n');

      return `\n\nHere are examples of my writing style:\n${styleExamples}`;
    } catch (error: any) {
      logger.warn({ error }, 'Failed to fetch learning emails');
      return '';
    }
  }

  /**
   * Build system prompt with tone instructions
   */
  private static buildSystemPrompt(tone: string, signature: string): string {
    const toneInstructions = {
      formal:
        'Write in a professional, formal tone. Use proper grammar and structure. Keep the response concise but thorough.',
      concise:
        'Write a brief, to-the-point response. Use clear and direct language. Avoid unnecessary details.',
      friendly:
        'Write in a warm, friendly tone. Be conversational but still professional. Use a personable approach.',
    };

    const instructions = (toneInstructions as any)[tone] || toneInstructions.formal;
    const sigBlock = signature ? `\n\nAlways end with this signature:\n${signature}` : '';

    return `You are an email assistant that helps draft replies to emails.

  ${instructions}

  IMPORTANT RULES:
  - Return ONLY the email body.
  - DO NOT include a subject line.
  - DO NOT include "Subject:" anywhere in the response.
  - The response should be ready to send as the email body directly.${sigBlock}`;
  }

  /**
   * Generate draft reply for an email
   */
  static async generateDraft(
    userId: string,
    gmailMessageIds: string | string[],
    tone: string = 'formal',
    customContext?: string
  ): Promise<string> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const relevantMessageIds = Array.isArray(gmailMessageIds)
        ? gmailMessageIds
        : [gmailMessageIds];
      const replyToGmailMessageId = relevantMessageIds[0];

      // The first selected message is the explicit reply target. For a thread,
      // the caller orders selected unread inbound messages newest-first.
      const originalEmail = await EmailMessage.findOne({
        userId: userObjectId,
        gmailMessageId: replyToGmailMessageId,
      });

      if (!originalEmail) {
        throw new Error('Email not found');
      }

      // Fetch user preferences
      const preferences = await UserPreference.findOne({ userId: userObjectId });
      const signature = preferences?.signature || '';
      const learningEmailCount = preferences?.learningEmailCount || this.DEFAULT_LEARNING_COUNT;

      // Fetch thread context and learning emails
      const threadEmails = await EmailMessage.find({
        userId: userObjectId,
        threadId: originalEmail.threadId,
      })
        .sort({ internalDate: 1 })
        .lean();

      const learningEmailsContext = await this.fetchLearningEmails(userId, learningEmailCount);

      // Build full chronological context plus a separate, explicit list of the
      // messages the reply must address. This prevents a consolidated draft
      // from silently being generated from only its first message.
      const threadContext = threadEmails
        .map((email: any) => `${email.from}: ${email.bodyPlain}`)
        .join('\n\n---\n\n');

      const relevantEmails = relevantMessageIds
        .map((messageId) => threadEmails.find((email: any) => email.gmailMessageId === messageId))
        .filter(Boolean);
      const relevantMessagesContext = relevantEmails
        .map((email: any) => `From: ${email.from}\nSubject: ${email.subject}\n\n${email.bodyPlain}`)
        .join('\n\n---\n\n');

      // Build user prompt with optional custom context
      let userPrompt = `
Please draft one reply to this email thread.

The following message${relevantMessageIds.length === 1 ? '' : 's'} require${relevantMessageIds.length === 1 ? 's' : ''} a response. Address every question and action item across them:

${relevantMessagesContext}

Full thread context, in chronological order:

${threadContext}

Use this most recent relevant email as the reply target:
Subject: ${originalEmail.subject}
Body: ${originalEmail.bodyPlain}
${learningEmailsContext}

Generate one thoughtful, appropriate reply that addresses all relevant messages.`;

      if (customContext) {
        userPrompt += `\n\nAdditional context from the user:\n${customContext}`;
      }

      const systemPrompt = this.buildSystemPrompt(tone, signature);

      // Call OpenAI
      const response = await openai.chat.completions.create({
        model: this.GPT_MODEL,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const draftText =
        response.choices[0]?.message?.content || 'Failed to generate draft';

      logger.info(
        { userId, gmailMessageIds: relevantMessageIds, tone },
        'Draft generated successfully'
      );

      return draftText;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Draft generation failed'
      );
      throw error;
    }
  }

  /**
   * Generate a reply to a single email
   */
  static async generateReply(
    emailBody: string,
    tone: string = 'formal',
    signature: string = ''
  ): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt(tone, signature);

      const userPrompt = `
Please draft a reply to this email:

${emailBody}

Generate a thoughtful, appropriate reply.`;

      const response = await openai.chat.completions.create({
        model: this.GPT_MODEL,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const reply = response.choices[0]?.message?.content || 'Failed to generate reply';

      logger.info('Reply generated successfully');
      return reply;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Reply generation failed'
      );
      throw error;
    }
  }

  /**
   * Generate a consolidated reply addressing multiple emails
   */
  static async generateConsolidatedReply(
    emails: Array<{ from: string; subject: string; body: string }>,
    tone: string = 'formal',
    signature: string = ''
  ): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt(tone, signature);

      const emailsContext = emails
        .map((email) => `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`)
        .join('\n\n---\n\n');

      const userPrompt = `
Please draft a consolidated reply addressing all of these emails:

${emailsContext}

Generate a single reply that thoughtfully addresses all the questions and points raised across all emails.`;

      const response = await openai.chat.completions.create({
        model: this.GPT_MODEL,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const reply = response.choices[0]?.message?.content || 'Failed to generate consolidated reply';

      logger.info({ emailCount: emails.length }, 'Consolidated reply generated successfully');
      return reply;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Consolidated reply generation failed'
      );
      throw error;
    }
  }

  /**
   * Extract key points from an email body
   */
  static async extractKeyPoints(emailBody: string): Promise<string[]> {
    try {
      const systemPrompt = `You are an email analysis assistant. Extract the key points, questions, and action items from emails. Return ONLY a JSON array of strings with the key points. Example: ["Point 1", "Point 2"]`;

      const userPrompt = `
Extract all key points, questions, and action items from this email:

${emailBody}

Return only a valid JSON array of strings.`;

      const response = await openai.chat.completions.create({
        model: this.GPT_MODEL,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '[]';

      // Parse the JSON response
      try {
        const keyPoints = JSON.parse(content);
        if (!Array.isArray(keyPoints)) {
          return [];
        }
        return keyPoints;
      } catch {
        // If JSON parsing fails, return empty array
        logger.warn('Failed to parse key points response as JSON');
        return [];
      }
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Key points extraction failed'
      );
      throw error;
    }
  }
}
