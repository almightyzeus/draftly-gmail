import { google } from 'googleapis';
import { Types } from 'mongoose';
import { createOAuth2Client } from './googleClient.js';
import { GmailAccount } from '../models/GmailAccount.js';
import { User } from '../models/User.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { CryptoService } from './cryptoService.js';
import { logger } from '../utils/logger.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { buildRawReply } from '../utils/mimeMessage.js';

/**
 * GmailService - Handles Gmail email fetching and sending
 */
export class GmailService {
  private static getHeader(headers: any[], name: string): string | undefined {
    return headers.find((header: any) => header.name?.toLowerCase() === name.toLowerCase())?.value;
  }

  private static buildReplyHeaders(
    rfcMessageId: string,
    existingReferences?: string | null
  ): { inReplyTo: string; references: string } {
    const inReplyTo = rfcMessageId.trim();
    const referenceIds = (existingReferences?.match(/<[^>]+>/g) ?? [])
      .map((reference) => reference.trim());

    if (!referenceIds.some((reference) => reference.toLowerCase() === inReplyTo.toLowerCase())) {
      referenceIds.push(inReplyTo);
    }

    return {
      inReplyTo,
      references: referenceIds.join(' '),
    };
  }

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
   * Get Gmail client with user's credentials
   * Sets up a token refresh listener that persists refreshed credentials after Google's API call
   */
  private static async getGmailClient(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });
    if (!account) {
      throw new ConflictError('Gmail account not connected');
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
    if ((message.labelIds || []).includes('SENT')) {
      return 'OUTBOUND';
    }

    // Compare the actual address, not a substring: "evil-user@gmail.com"
    // must not count as "user@gmail.com".
    const headers = message.payload?.headers || [];
    const from = this.getHeader(headers, 'From') || '';
    const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

    return address !== '' && address === userEmail.trim().toLowerCase() ? 'OUTBOUND' : 'INBOUND';
  }

  /**
   * Gmail's internalDate (ms since epoch) is set by Gmail; the Date header is
   * sender-controlled and may be missing or unparseable.
   */
  private static getMessageDate(message: any, dateHeader?: string): Date {
    const internal = new Date(Number(message.internalDate));
    if (message.internalDate && !Number.isNaN(internal.getTime())) {
      return internal;
    }
    const fromHeader = dateHeader ? new Date(dateHeader) : null;
    if (fromHeader && !Number.isNaN(fromHeader.getTime())) {
      return fromHeader;
    }
    return new Date();
  }

  /** The From address for outgoing mail: the user's active Gmail account. */
  static async getSenderAddress(userId: string): Promise<string | undefined> {
    const account = await GmailAccount.findOne({ userId: new Types.ObjectId(userId), revokedAt: null });
    return account?.gmailEmail;
  }


  /**
   * Fetch one page of emails from Gmail and cache them in the database.
   * Gmail stays the source of truth: search uses Gmail query syntax and
   * pagination uses Gmail's opaque nextPageToken.
   */
  static async fetchEmails(
    userId: string,
    options?: {
      label?: string;
      unread?: boolean;
      limit?: number;
      q?: string;
      pageToken?: string;
    }
  ): Promise<{ emails: any[]; nextPageToken: string | null }> {
    try {
      const gmail = await this.getGmailClient(userId);
      const userObjectId = new Types.ObjectId(userId);
      const account = await GmailAccount.findOne({ userId: userObjectId, revokedAt: null });

      if (!account) {
        throw new ConflictError('Gmail account not connected');
      }

      const gmailEmail = account.gmailEmail;

      const query = this.buildListQuery(options);

      let listResponse;
      try {
        listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: options?.limit || 20,
          ...(options?.pageToken && { pageToken: options.pageToken }),
        });
      } catch (error) {
        throw await this.toListError(userId, error, !!(options?.q || options?.pageToken));
      }

      const messageIds = listResponse.data.messages || [];
      const nextPageToken = listResponse.data.nextPageToken || null;

      if (messageIds.length === 0) {
        return { emails: [], nextPageToken };
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

          const subjectHeader = this.getHeader(headers, 'Subject');
          const fromHeader = this.getHeader(headers, 'From');
          const toHeader = this.getHeader(headers, 'To');
          const dateHeader = this.getHeader(headers, 'Date');
          const rfcMessageId = this.getHeader(headers, 'Message-ID');
          const references = this.getHeader(headers, 'References');

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
              rfcMessageId,
              references,
              threadId: message.threadId || '',
              subject: subjectHeader || '(No Subject)',
              from: fromHeader || '',
              to: toHeader || '',
              snippet: message.snippet || '',
              bodyPlain,
              bodyHtml,
              internalDate: this.getMessageDate(message, dateHeader),
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
      return { emails, nextPageToken };
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to fetch emails'
      );
      throw error;
    }
  }

  /**
   * Build the Gmail `q` string for a listing.
   * Structural filters come first so an unbalanced quote in the user's search
   * cannot swallow them. The default noise filters only apply to the plain
   * inbox view; an explicit search behaves like Gmail search.
   */
  private static buildListQuery(options?: { label?: string; unread?: boolean; q?: string }): string {
    const queryParts: string[] = [];

    if (options?.label) {
      queryParts.push(`label:${options.label}`);
    }
    if (options?.unread) {
      queryParts.push('is:unread');
    }

    if (options?.q) {
      queryParts.push(options.q);
    } else {
      queryParts.push(
        '-category:promotions',
        '-category:social',
        '-category:purchases',
        '-from:(noreply OR "no-reply" OR "do-not-reply" OR donotreply OR "no_reply" OR "no.reply" OR "no response" OR "do not reply")',
        '-subject:("do not reply" OR "no reply" OR "no-response")'
      );
    }

    return queryParts.join(' ').trim();
  }

  /**
   * Map Gmail list failures that the caller can act on to HTTP errors.
   * The original Google error is always logged so the cause is not lost.
   */
  private static async toListError(userId: string, error: any, hadSearchInput: boolean): Promise<unknown> {
    logger.warn(
      {
        userId,
        status: error?.response?.status ?? error?.status,
        url: String(error?.config?.url ?? '').split('?')[0],
        googleError: error?.response?.data?.error,
      },
      'Gmail messages.list failed'
    );

    // The refresh token is dead (expired in a "Testing" OAuth app, or revoked
    // by the user). This is a token-endpoint 400, not a bad search.
    if (this.isInvalidGrant(error)) {
      await this.markGmailDisconnected(userId);
      return new ForbiddenError('Gmail access has expired or was revoked. Please reconnect Gmail.');
    }

    const status = Number(error?.response?.status ?? error?.status ?? error?.code);
    if (status === 400 && hadSearchInput) {
      return new ValidationError('Invalid Gmail search query or page token');
    }
    if (status === 429) {
      return new AppError('Gmail rate limit exceeded. Please try again shortly.', 429);
    }
    return error;
  }

  private static isInvalidGrant(error: any): boolean {
    return (
      error?.response?.data?.error === 'invalid_grant' ||
      String(error?.message ?? '').includes('invalid_grant')
    );
  }

  /**
   * Same cleanup GmailOAuthService.revoke applies to an already-revoked grant,
   * so the UI shows "Connect Gmail" instead of failing on every load.
   */
  private static async markGmailDisconnected(userId: string): Promise<void> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      await GmailAccount.updateMany(
        { userId: userObjectId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      await User.findByIdAndUpdate(userObjectId, { googleConnected: false, gmailEmail: null });
      logger.info({ userId }, 'Gmail grant is no longer valid; marked account disconnected');
    } catch (cleanupError) {
      logger.error(
        cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        'Failed to mark Gmail account disconnected after invalid_grant'
      );
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
        throw new NotFoundError('Email not found');
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
   * Resolve RFC reply headers for a cached message. Older cached messages did
   * not retain RFC headers, so retrieve only that message's metadata once and
   * update the cache rather than ever falling back to Gmail's internal ID.
   */
  static async getReplyMetadata(
    userId: string,
    gmailMessageId: string
  ): Promise<{ inReplyTo: string; references: string }> {
    const userObjectId = new Types.ObjectId(userId);
    const cachedEmail = await EmailMessage.findOne({ userId: userObjectId, gmailMessageId });

    if (cachedEmail?.rfcMessageId) {
      return this.buildReplyHeaders(cachedEmail.rfcMessageId, cachedEmail.references);
    }

    const gmail = await this.getGmailClient(userId);
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID', 'References'],
    });
    const headers = response.data.payload?.headers || [];
    const rfcMessageId = this.getHeader(headers, 'Message-ID');
    const references = this.getHeader(headers, 'References');

    if (!rfcMessageId) {
      throw new AppError('Original email does not include an RFC Message-ID header', 422);
    }

    await EmailMessage.findOneAndUpdate(
      { userId: userObjectId, gmailMessageId },
      { rfcMessageId, references: references || null },
      { new: true }
    );

    return this.buildReplyHeaders(rfcMessageId, references);
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

      const rawMessage = buildRawReply({
        from: await this.getSenderAddress(userId),
        to,
        subject,
        body: bodyHtml,
        inReplyTo,
        references,
      });
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

      const rawMessage = buildRawReply({
        from: await this.getSenderAddress(userId),
        to,
        subject,
        body: bodyHtml,
        inReplyTo,
        references,
      });
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
    threadId: string
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
   * Delete a draft in Gmail (used when an approved draft is rejected)
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
