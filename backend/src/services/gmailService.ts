import { google } from 'googleapis';
import { Types } from 'mongoose';
import { createOAuth2Client } from './googleClient.js';
import { GmailAccount } from '../models/GmailAccount.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { CryptoService } from './cryptoService.js';
import { logger } from '../utils/logger.js';

/**
 * GmailService - Handles Gmail email fetching and sending
 */
export class GmailService {
  /**
   * Persist refreshed tokens to the database
   * Called after Google OAuth2 client auto-refreshes an access token
   */
  private static async persistRefreshedTokens(
    userId: string,
    gmailEmail: string,
    accessToken: string,
    refreshToken: string | undefined,
    expiryDate: number | null | undefined
  ): Promise<void> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const account = await GmailAccount.findOne({ userId: userObjectId, gmailEmail });

      if (!account) {
        logger.warn(`Cannot persist refreshed tokens: GmailAccount not found for user ${userId}, email ${gmailEmail}`);
        return;
      }

      // Only update if values have changed
      const accessTokenEnc = CryptoService.encryptToken(accessToken);
      const updates: any = {
        accessTokenEnc,
      };

      // Only update refresh token if Google provided a new one
      if (refreshToken) {
        updates.refreshTokenEnc = CryptoService.encryptToken(refreshToken);
      }

      // Only update expiry if it's provided
      if (expiryDate) {
        updates.tokenExpiry = new Date(expiryDate);
      }

      await GmailAccount.findOneAndUpdate(
        { userId: userObjectId, gmailEmail },
        updates,
        { new: true }
      );

      logger.debug(`Refreshed tokens persisted for user ${userId}, email ${gmailEmail}`);
    } catch (error) {
      // Log error but don't throw - token refresh succeeded, only persistence failed
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to persist refreshed tokens for user ${userId}`
      );
    }
  }

  /**
   * Convert plain text to HTML by escaping special chars and converting newlines to <br>
   */
  private static plainTextToHtml(plainText: string): string {
    return plainText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>\r\n');
  }

  /**
   * Get Gmail client with user's credentials
   * Sets up a token refresh listener that persists refreshed credentials after Google's API call
   */
  private static async getGmailClient(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });
    if (!account) {
      throw new Error('Gmail account not connected');
    }

    const accessToken = CryptoService.decryptToken(account.accessTokenEnc);
    const refreshToken = CryptoService.decryptToken(account.refreshTokenEnc);

    // Create a fresh OAuth2 client for this user to avoid credential mixing
    const userClient = createOAuth2Client();
    
    // Set up listener for token refresh events (fired AFTER Google's API call)
    userClient.on('tokens', async (tokens: any) => {
      try {
        // tokens.access_token: new access token
        // tokens.refresh_token: new refresh token (if provided by Google)
        // tokens.expiry_date: new expiry date
        await this.persistRefreshedTokens(
          userId,
          account.gmailEmail,
          tokens.access_token,
          tokens.refresh_token, // undefined if Google didn't provide a new one
          tokens.expiry_date
        );
      } catch (error) {
        // Log but don't throw - we don't want to break the API call
        logger.error(
          error instanceof Error ? error : new Error(String(error)),
          `Failed to persist refreshed tokens in token event listener for user ${userId}`
        );
      }
    });
    
    userClient.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiry.getTime(),
    });

    return google.gmail({ version: 'v1', auth: userClient });
  }

  /**
   * Parse email body from Gmail message (recursively handles nested parts)
   */
  private static parseEmailBody(
    message: any
  ): { bodyPlain: string; bodyHtml?: string } {
    let bodyPlain = '';
    let bodyHtml = '';

    // Helper function to recursively search through message parts
    const searchParts = (parts: any[]): void => {
      if (!parts) return;

      for (const part of parts) {
        // Check if this part has the body content we're looking for
        if (part.mimeType === 'text/plain' && part.body?.data) {
          bodyPlain = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType === 'text/html' && part.body?.data) {
          bodyHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
        }

        // Recursively search nested parts (for multipart/alternative, multipart/mixed, etc.)
        if (part.parts && part.parts.length > 0) {
          searchParts(part.parts);
        }
      }
    };

    // Check if message has a simple data payload
    if (message.body?.data) {
      bodyPlain = Buffer.from(message.body.data, 'base64').toString('utf-8');
    }

    // Search through all parts (handles multipart messages)
    if (message.parts && message.parts.length > 0) {
      searchParts(message.parts);
    }

    return { bodyPlain, bodyHtml };
  }

  /**
   * Determine email direction (inbound or outbound)
   */
  private static getEmailDirection(
    message: any,
    userEmail: string
  ): 'INBOUND' | 'OUTBOUND' {
    const headers = message.payload?.headers || [];
    const fromHeader = headers.find((h: any) => h.name === 'From');
    const from = fromHeader?.value || '';

    return from.includes(userEmail) ? 'OUTBOUND' : 'INBOUND';
  }

  /**
   * Fetch emails from Gmail and store in database
   */
  static async fetchEmails(
    userId: string,
    options?: {
      label?: string;
      unread?: boolean;
      limit?: number;
    }
  ): Promise<any[]> {
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
            id: msg.id!,
            format: 'full',
          });

          const message = messageResponse.data;
          const headers = message.payload?.headers || [];

          const subjectHeader = headers.find((h: any) => h.name === 'Subject');
          const fromHeader = headers.find((h: any) => h.name === 'From');
          const toHeader = headers.find((h: any) => h.name === 'To');
          const dateHeader = headers.find((h: any) => h.name === 'Date');

          const { bodyPlain, bodyHtml } = this.parseEmailBody(message.payload);
          const direction = this.getEmailDirection(message, gmailEmail);

          // Save to database
          const userObjectId = new Types.ObjectId(userId);
          const emailDoc = await EmailMessage.findOneAndUpdate(
            {
              userId: userObjectId,
              gmailMessageId: message.id,
            },
            {
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
            },
            { upsert: true, new: true }
          );

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
        } catch (error) {
          logger.error(
            error instanceof Error ? error : new Error(String(error)),
            `Failed to fetch message ${msg.id}`
          );
        }
      }

      logger.info(
        `Fetched ${emails.length} emails for user ${userId}`
      );
      return emails;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to fetch emails'
      );
      throw error;
    }
  }

  /**
   * Get a single email by ID
   */
  static async getEmail(userId: string, gmailMessageId: string): Promise<any> {
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
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get email'
      );
      throw error;
    }
  }

  /**
   * Send a reply through Gmail
   */
  static async sendReply(
    userId: string,
    threadId: string,
    message: string
  ): Promise<string> {
    throw new Error('Not implemented yet');
  }

  /**
   * Fetch all emails in a thread
   */
  static async fetchThreadEmails(userId: string, threadId: string): Promise<any[]> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const emails = await EmailMessage.find({
        userId: userObjectId,
        threadId,
      })
        .sort({ internalDate: -1 })
        .lean();

      return emails.map((email) => ({
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
      }));
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to fetch thread emails'
      );
      throw error;
    }
  }

  /**
   * Create a draft in Gmail
   * Returns the gmailDraftId
   */
  static async createDraft(
    userId: string,
    to: string,
    subject: string,
    bodyHtml: string,
    threadId: string,
    inReplyTo?: string,
    references?: string
  ): Promise<string> {
    try {
      const gmail = await this.getGmailClient(userId);

      // Build RFC822 message with multipart/alternative (plain text + HTML)
      const boundary = '===============' + Date.now() + '===============';
      const htmlBody = this.plainTextToHtml(bodyHtml);

      const headers = [
        `From: ${(await GmailAccount.findOne({ userId: new Types.ObjectId(userId) }))?.gmailEmail}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ];

      if (inReplyTo) {
        headers.push(`In-Reply-To: ${inReplyTo}`);
      }
      if (references) {
        headers.push(`References: ${references}`);
      }

      // Create both plain text and HTML parts
      const plainTextPart = `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${bodyHtml}\r\n`;
      const htmlPart = `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${htmlBody}\r\n--${boundary}--`;
      const bodyPart = plainTextPart + htmlPart;

      const rawMessage = headers.join('\r\n') + '\r\n\r\n' + bodyPart;
      const encodedMessage = Buffer.from(rawMessage).toString('base64');

      // Create draft in Gmail
      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId: threadId,
          },
        },
      });

      const gmailDraftId = response.data.id;
      logger.info({ userId, gmailDraftId, threadId }, 'Draft created in Gmail');

      return gmailDraftId || '';
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to create Gmail draft'
      );
      throw error;
    }
  }

  /**
   * Update an existing draft in Gmail
   */
  static async updateDraft(
    userId: string,
    gmailDraftId: string,
    bodyHtml: string,
    to: string,
    subject: string,
    threadId: string,
    inReplyTo?: string,
    references?: string
  ): Promise<void> {
    try {
      const gmail = await this.getGmailClient(userId);

      // Build RFC822 message with multipart/alternative (plain text + HTML)
      const boundary = '===============' + Date.now() + '===============';
      const htmlBody = this.plainTextToHtml(bodyHtml);

      const headers = [
        `From: ${(await GmailAccount.findOne({ userId: new Types.ObjectId(userId) }))?.gmailEmail}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ];

      if (inReplyTo) {
        headers.push(`In-Reply-To: ${inReplyTo}`);
      }
      if (references) {
        headers.push(`References: ${references}`);
      }

      // Create both plain text and HTML parts
      const plainTextPart = `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${bodyHtml}\r\n`;
      const htmlPart = `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${htmlBody}\r\n--${boundary}--`;
      const bodyPart = plainTextPart + htmlPart;

      const rawMessage = headers.join('\r\n') + '\r\n\r\n' + bodyPart;
      const encodedMessage = Buffer.from(rawMessage).toString('base64');

      // Update draft
      await gmail.users.drafts.update({
        userId: 'me',
        id: gmailDraftId,
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId: threadId,
          },
        },
      });

      logger.info({ userId, gmailDraftId }, 'Draft updated in Gmail');
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to update Gmail draft'
      );
      throw error;
    }
  }

  /**
   * Send a draft in Gmail
   * Returns the sentGmailMessageId
   */
  static async sendDraft(
    userId: string,
    gmailDraftId: string,
    threadId: string,
    inReplyTo?: string,
    references?: string
  ): Promise<string> {
    try {
      const gmail = await this.getGmailClient(userId);

      // Send the draft
      const response = await gmail.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: gmailDraftId,
        },
      });

      const sentMessageId = response.data.id;
      logger.info({ userId, gmailDraftId, sentMessageId }, 'Draft sent via Gmail');

      return sentMessageId || '';
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to send Gmail draft'
      );
      throw error;
    }
  }

  /**
   * Delete a draft in Gmail (optional cleanup)
   */
  static async deleteDraft(userId: string, gmailDraftId: string): Promise<void> {
    try {
      const gmail = await this.getGmailClient(userId);

      await gmail.users.drafts.delete({
        userId: 'me',
        id: gmailDraftId,
      });

      logger.info({ userId, gmailDraftId }, 'Draft deleted from Gmail');
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to delete Gmail draft'
      );
      throw error;
    }
  }
}
