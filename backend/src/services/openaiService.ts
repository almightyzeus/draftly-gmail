import { OpenAI } from 'openai';
import { Types } from 'mongoose';
import { EmailMessage } from '../models/EmailMessage.js';
import { UserPreference } from '../models/UserPreference.js';
import { GmailService } from './gmailService.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { emailPlainText } from '../utils/htmlToText.js';
import { AppError, NotFoundError } from '../utils/errors.js';

const openai = new OpenAI({
  apiKey: env.openai.apiKey,
  timeout: 60_000,
  maxRetries: 2,
});

/** Prompt size bounds: email content is untrusted and can be arbitrarily long. */
const MAX_MESSAGE_CHARS = 4_000;
const MAX_THREAD_MESSAGES = 20;
const MAX_STYLE_EXAMPLE_CHARS = 1_500;
const MAX_CUSTOM_CONTEXT_CHARS = 2_000;

function truncate(text: string | undefined | null, max: number): string {
  const value = text ?? '';
  return value.length > max ? `${value.slice(0, max)}\n[...truncated]` : value;
}

/**
 * OpenAI Service - Handles draft generation using GPT-4
 */
export class OpenAIService {
  private static readonly DEFAULT_LEARNING_COUNT = 5;
  private static readonly GPT_MODEL = env.openai.model;

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
        .map((email: any) => `Subject: ${email.subject}\n\n${truncate(emailPlainText(email), MAX_STYLE_EXAMPLE_CHARS)}`)
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
        throw new NotFoundError('Email not found');
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
        .slice(-MAX_THREAD_MESSAGES)
        .map((email: any) => `${email.from}: ${truncate(emailPlainText(email), MAX_MESSAGE_CHARS)}`)
        .join('\n\n---\n\n');

      const relevantEmails = relevantMessageIds
        .map((messageId) => threadEmails.find((email: any) => email.gmailMessageId === messageId))
        .filter(Boolean);
      const relevantMessagesContext = relevantEmails
        .map((email: any) => `From: ${email.from}\nSubject: ${email.subject}\n\n${truncate(emailPlainText(email), MAX_MESSAGE_CHARS)}`)
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
Body: ${truncate(emailPlainText(originalEmail), MAX_MESSAGE_CHARS)}
${learningEmailsContext}

Generate one thoughtful, appropriate reply that addresses all relevant messages.`;

      if (customContext) {
        userPrompt += `\n\nAdditional context from the user:\n${truncate(customContext, MAX_CUSTOM_CONTEXT_CHARS)}`;
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

      // Never store placeholder text as a draft: it could be approved and sent.
      const draftText = response.choices[0]?.message?.content?.trim();
      if (!draftText) {
        throw new AppError('The AI returned an empty draft. Please try again.', 502);
      }

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
}
