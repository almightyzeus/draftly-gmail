import { OpenAI } from 'openai';
import { Types } from 'mongoose';
import { EmailMessage } from '../models/EmailMessage.js';
import { UserPreference } from '../models/UserPreference.js';
import { logger } from '../utils/logger.js';
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
/**
 * OpenAI Service - Handles draft generation using GPT-4
 */
export class OpenAIService {
    /**
     * Fetch learning emails (outbound emails for style reference)
     */
    static async fetchLearningEmails(userId, count = this.DEFAULT_LEARNING_COUNT) {
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
                .map((email) => `Subject: ${email.subject}\n\n${email.bodyPlain}`)
                .join('\n---\n');
            return `\n\nHere are examples of my writing style:\n${styleExamples}`;
        }
        catch (error) {
            logger.warn({ error }, 'Failed to fetch learning emails');
            return '';
        }
    }
    /**
     * Build system prompt with tone instructions
     */
    static buildSystemPrompt(tone, signature) {
        const toneInstructions = {
            formal: 'Write in a professional, formal tone. Use proper grammar and structure. Keep the response concise but thorough.',
            concise: 'Write a brief, to-the-point response. Use clear and direct language. Avoid unnecessary details.',
            friendly: 'Write in a warm, friendly tone. Be conversational but still professional. Use a personable approach.',
        };
        const instructions = toneInstructions[tone] || toneInstructions.formal;
        const sigBlock = signature ? `\n\nAlways end with this signature:\n${signature}` : '';
        return `You are an email assistant that helps draft replies to emails. ${instructions}${sigBlock}`;
    }
    /**
     * Generate draft reply for an email
     */
    static async generateDraft(userId, gmailMessageId, tone = 'formal') {
        try {
            const userObjectId = new Types.ObjectId(userId);
            // Fetch original email
            const originalEmail = await EmailMessage.findOne({
                userId: userObjectId,
                gmailMessageId,
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
            // Build thread context
            const threadContext = threadEmails
                .map((email) => `${email.from}: ${email.bodyPlain}`)
                .join('\n\n---\n\n');
            // Build user prompt
            const userPrompt = `
Please draft a reply to this email thread:

${threadContext}

The most recent email from ${originalEmail.from} is:
Subject: ${originalEmail.subject}
Body: ${originalEmail.bodyPlain}
${learningEmailsContext}

Generate a thoughtful, appropriate reply to the most recent email.
`;
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
            const draftText = response.choices[0]?.message?.content || 'Failed to generate draft';
            logger.info({ userId, gmailMessageId, tone }, 'Draft generated successfully');
            return draftText;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Draft generation failed');
            throw error;
        }
    }
}
OpenAIService.DEFAULT_LEARNING_COUNT = 5;
OpenAIService.GPT_MODEL = process.env.OPENAI_MODEL || 'gpt-4-turbo';
