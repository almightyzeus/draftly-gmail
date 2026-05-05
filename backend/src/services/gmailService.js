import { google } from 'googleapis';
import { Types } from 'mongoose';
import { oauth2Client } from './googleClient.js';
import { GmailAccount } from '../models/GmailAccount.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { CryptoService } from './cryptoService.js';
import { logger } from '../utils/logger.js';
/**
 * GmailService - Handles Gmail email fetching and sending
 */
export class GmailService {
    /**
     * Get Gmail client with user's credentials
     */
    static async getGmailClient(userId) {
        const userObjectId = new Types.ObjectId(userId);
        const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });
        if (!account) {
            throw new Error('Gmail account not connected');
        }
        const accessToken = CryptoService.decryptToken(account.accessTokenEnc);
        const refreshToken = CryptoService.decryptToken(account.refreshTokenEnc);
        oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken,
            expiry_date: account.tokenExpiry.getTime(),
        });
        return google.gmail({ version: 'v1', auth: oauth2Client });
    }
    /**
     * Parse email body from Gmail message
     */
    static parseEmailBody(message) {
        let bodyPlain = '';
        let bodyHtml = '';
        if (message.parts) {
            for (const part of message.parts) {
                if (part.mimeType === 'text/plain' && part.data) {
                    bodyPlain = Buffer.from(part.data, 'base64').toString('utf-8');
                }
                else if (part.mimeType === 'text/html' && part.data) {
                    bodyHtml = Buffer.from(part.data, 'base64').toString('utf-8');
                }
            }
        }
        else if (message.data) {
            bodyPlain = Buffer.from(message.data, 'base64').toString('utf-8');
        }
        return { bodyPlain, bodyHtml };
    }
    /**
     * Determine email direction (inbound or outbound)
     */
    static getEmailDirection(message, userEmail) {
        const headers = message.payload?.headers || [];
        const fromHeader = headers.find((h) => h.name === 'From');
        const from = fromHeader?.value || '';
        return from.includes(userEmail) ? 'OUTBOUND' : 'INBOUND';
    }
    /**
     * Fetch emails from Gmail and store in database
     */
    static async fetchEmails(userId, options) {
        try {
            const gmail = await this.getGmailClient(userId);
            const userObjectId = new Types.ObjectId(userId);
            const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });
            if (!account) {
                throw new Error('Gmail account not connected');
            }
            const gmailEmail = account.gmailEmail;
            // Build Gmail API query
            const queryParts = [
                '-category:promotions',
                '-category:social',
                '-category:purchases',
                '-from:(noreply OR "no-reply" OR "do-not-reply" OR donotreply OR "no_reply" OR "no.reply" OR "no response" OR "do not reply")',
                '-subject:("do not reply" OR "no reply" OR "no-response")',
            ];
            if (options?.label) {
                queryParts.push(`label:${options.label}`);
            }
            if (options?.unread) {
                queryParts.push('is:unread');
            }
            const query = queryParts.join(' ').trim();
            const listResponse = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: options?.limit || 20,
            });
            const messageIds = listResponse.data.messages || [];
            if (messageIds.length === 0) {
                return [];
            }
            // Fetch full message details and store in DB
            const emails = [];
            for (const msg of messageIds) {
                try {
                    const messageResponse = await gmail.users.messages.get({
                        userId: 'me',
                        id: msg.id,
                        format: 'full',
                    });
                    const message = messageResponse.data;
                    const headers = message.payload?.headers || [];
                    const subjectHeader = headers.find((h) => h.name === 'Subject');
                    const fromHeader = headers.find((h) => h.name === 'From');
                    const toHeader = headers.find((h) => h.name === 'To');
                    const dateHeader = headers.find((h) => h.name === 'Date');
                    const { bodyPlain, bodyHtml } = this.parseEmailBody(message.payload);
                    const direction = this.getEmailDirection(message, gmailEmail);
                    // Save to database
                    const userObjectId = new Types.ObjectId(userId);
                    const emailDoc = await EmailMessage.findOneAndUpdate({
                        userId: userObjectId,
                        gmailMessageId: message.id,
                    }, {
                        userId: userObjectId,
                        gmailMessageId: message.id,
                        threadId: message.threadId || '',
                        subject: subjectHeader?.value || '(No Subject)',
                        from: fromHeader?.value || '',
                        to: toHeader?.value || '',
                        snippet: message.snippet || '',
                        bodyPlain,
                        bodyHtml,
                        internalDate: dateHeader?.value
                            ? new Date(dateHeader.value)
                            : new Date(),
                        direction,
                        labels: message.labelIds || [],
                    }, { upsert: true, new: true });
                    emails.push({
                        id: emailDoc._id,
                        gmailMessageId: emailDoc.gmailMessageId,
                        threadId: emailDoc.threadId,
                        from: emailDoc.from,
                        to: emailDoc.to,
                        subject: emailDoc.subject,
                        snippet: emailDoc.snippet,
                        direction: emailDoc.direction,
                        internalDate: emailDoc.internalDate,
                        labels: emailDoc.labels,
                    });
                }
                catch (error) {
                    logger.error(error instanceof Error ? error : new Error(String(error)), `Failed to fetch message ${msg.id}`);
                }
            }
            logger.info(`Fetched ${emails.length} emails for user ${userId}`);
            return emails;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to fetch emails');
            throw error;
        }
    }
    /**
     * Get a single email by ID
     */
    static async getEmail(userId, gmailMessageId) {
        try {
            const userObjectId = new Types.ObjectId(userId);
            const email = await EmailMessage.findOne({ userId: userObjectId, gmailMessageId });
            if (!email) {
                throw new Error('Email not found');
            }
            return {
                id: email._id,
                gmailMessageId: email.gmailMessageId,
                threadId: email.threadId,
                from: email.from,
                to: email.to,
                subject: email.subject,
                snippet: email.snippet,
                bodyPlain: email.bodyPlain,
                bodyHtml: email.bodyHtml,
                direction: email.direction,
                internalDate: email.internalDate,
                labels: email.labels,
            };
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to get email');
            throw error;
        }
    }
    /**
     * Send a reply through Gmail
     */
    static async sendReply(userId, threadId, message) {
        throw new Error('Not implemented yet');
    }
}
