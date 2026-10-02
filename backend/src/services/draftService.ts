import { Types } from 'mongoose';
import { logger } from '../utils/logger.js';
import { Draft } from '../models/Draft.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { OpenAIService } from './openaiService.js';
import { GmailService } from './gmailService.js';
import { ActivityLogService } from './activityLogService.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

/**
 * DraftService - Handles draft generation, approval, rejection, and sending
 */
export class DraftService {
  private static readonly PROMPT_VERSION = '1.0';
  /** How long a send claim blocks other requests before it is considered stranded. */
  static readonly SEND_CLAIM_LEASE_MS = 5 * 60 * 1000;

  private static async logActivity(
    userId: string,
    action: string,
    entityId: string,
    meta?: Record<string, any>
  ): Promise<void> {
    try {
      await ActivityLogService.logActivity(userId, action, 'Draft', 'info', entityId, meta);
    } catch (error) {
      logger.warn(
        error instanceof Error ? error : new Error(String(error)),
        'Activity logging failed'
      );
    }
  }

  /**
   * Generate a draft reply using OpenAI
   * If threadId is provided, fetch all unread emails in the thread and consolidate
   */
  static async generateDraft(
    userId: string,
    gmailMessageId?: string,
    tone: string = 'formal',
    threadId?: string,
    customContext?: string
  ): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);

      let targetThreadId = threadId;
      let gmailMessageIds: string[] = [];
      let isConsolidated = false;

      // If threadId provided, fetch all emails in thread for consolidation
      if (threadId) {
        const threadEmails = await GmailService.fetchThreadEmails(userId, threadId);
        if (threadEmails.length === 0) {
          throw new Error('No emails found in thread');
        }

        // Get all unread inbound emails in thread
        const unreadEmails = threadEmails.filter(
          (e) => e.direction === 'INBOUND' && e.labels?.includes('UNREAD')
        );

        if (unreadEmails.length > 1) {
          // Multiple emails: consolidate
          gmailMessageIds = unreadEmails.map((e) => e.gmailMessageId);
          isConsolidated = true;
          targetThreadId = threadId;
          logger.info(
            { userId, threadId, emailCount: gmailMessageIds.length },
            'Consolidating multiple emails for single draft'
          );
        } else if (unreadEmails.length === 1) {
          // Single unread email
          gmailMessageIds = [unreadEmails[0].gmailMessageId];
          targetThreadId = threadId;
        } else if (threadEmails.length > 0) {
          // No unread, use latest email
          gmailMessageIds = [threadEmails[0].gmailMessageId];
          targetThreadId = threadId;
        }
      } else if (gmailMessageId) {
        // Single email specified
        const email = await EmailMessage.findOne({
          userId: userObjectId,
          gmailMessageId,
        });

        if (!email) {
          throw new Error('Email not found');
        }

        gmailMessageIds = [gmailMessageId];
        targetThreadId = email.threadId;
      } else {
        throw new Error('Either gmailMessageId or threadId must be provided');
      }

      // Check if draft already exists for this thread/message (idempotency)
      const existingDraft = await Draft.findOne({
        userId: userObjectId,
        threadId: targetThreadId,
        status: 'PENDING',
      });

      if (existingDraft) {
        logger.warn(
          { userId, threadId: targetThreadId },
          'Draft already exists for this thread'
        );
        return existingDraft;
      }

      // fetchThreadEmails is newest-first, so the first selected message is the
      // newest inbound message and the RFC reply target for this draft.
      const replyToGmailMessageId = gmailMessageIds[0];

      // Generate one reply that explicitly receives every relevant message.
      const draftBody = await OpenAIService.generateDraft(
        userId,
        gmailMessageIds,
        tone,
        customContext
      );

      // Create draft record
      const draft = new Draft({
        userId: userObjectId,
        gmailMessageId: isConsolidated ? gmailMessageIds : gmailMessageIds[0],
        replyToGmailMessageId,
        threadId: targetThreadId,
        tone,
        promptVersion: this.PROMPT_VERSION,
        draftBody,
        status: 'PENDING',
        isConsolidated,
        auditTrail: [
          {
            at: new Date(),
            action: 'GENERATED',
            by: 'system',
            meta: { tone, isConsolidated, emailCount: gmailMessageIds.length, hasCustomContext: !!customContext },
          },
        ],
      });

      await draft.save();
      await this.logActivity(userId, 'DRAFT_GENERATED', draft._id.toString(), {
        tone,
        isConsolidated,
        emailCount: gmailMessageIds.length,
      });

      logger.info(
        {
          userId,
          threadId: targetThreadId,
          draftId: draft._id,
          tone,
          isConsolidated,
          emailCount: gmailMessageIds.length,
        },
        'Draft generated and saved'
      );

      return draft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to generate draft'
      );
      throw error;
    }
  }

  /**
   * Get drafts for user with optional status filter
   */
  static async getUserDrafts(
    userId: string,
    status?: string,
    limit: number = 20
  ): Promise<any[]> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const query: any = { userId: userObjectId };

      if (status) {
        query.status = status;
      }

      const drafts = await Draft.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return drafts;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get user drafts'
      );
      throw error;
    }
  }

  /**
   * Get a specific draft by ID
   */
  static async getDraftById(userId: string, draftId: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = new Types.ObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
      });

      if (!draft) {
        throw new Error('Draft not found');
      }

      return draft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get draft'
      );
      throw error;
    }
  }

  /**
   * Update draft content (both MongoDB + Gmail if approved)
   */
  static async updateDraft(userId: string, draftId: string, draftBody: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = new Types.ObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
      });

      if (!draft) {
        throw new Error('Draft not found');
      }

      // Only allow editing PENDING or APPROVED drafts
      if (!['PENDING', 'APPROVED'].includes(draft.status)) {
        throw new Error(`Cannot edit draft with status: ${draft.status}`);
      }

      draft.draftBody = draftBody;
      draft.auditTrail.push({
        at: new Date(),
        action: 'EDITED',
        by: 'user',
        meta: { bodyLength: draftBody.length },
      });

      // If draft is already approved and has gmailDraftId, update in Gmail
      if (draft.status === 'APPROVED' && draft.gmailDraftId) {
        try {
          const originalEmail = await EmailMessage.findOne({
            userId: userObjectId,
            gmailMessageId: draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
              ? draft.gmailMessageId[0]
              : draft.gmailMessageId),
          });

          if (originalEmail) {
            const replyMetadata = await GmailService.getReplyMetadata(
              userId,
              originalEmail.gmailMessageId
            );
            await GmailService.updateDraft(
              userId,
              draft.gmailDraftId,
              draftBody,
              originalEmail.from,
              `Re: ${originalEmail.subject}`,
              draft.threadId,
              replyMetadata.inReplyTo,
              replyMetadata.references
            );
          }
        } catch (gmailError) {
          logger.warn(
            gmailError instanceof Error ? gmailError : new Error(String(gmailError)),
            'Failed to update Gmail draft during edit, continuing with MongoDB update'
          );
        }
      }

      await draft.save();
      await this.logActivity(userId, 'DRAFT_EDITED', draft._id.toString(), {
        status: draft.status,
        bodyLength: draftBody.length,
      });

      logger.info({ userId, draftId }, 'Draft updated');

      return draft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to update draft'
      );
      throw error;
    }
  }

  /**
   * Approve a draft (mark as ready to send + save to Gmail)
   */
  static async approveDraft(userId: string, draftId: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = new Types.ObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
        status: 'PENDING',
      });

      if (!draft) {
        throw new Error('Draft not found or not in PENDING status');
      }

      // Get original email to extract info for Gmail draft
      const originalEmail = await EmailMessage.findOne({
        userId: userObjectId,
        gmailMessageId: draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
          ? draft.gmailMessageId[0]
          : draft.gmailMessageId),
      });

      if (!originalEmail) {
        throw new Error('Original email not found');
      }

      const replyMetadata = await GmailService.getReplyMetadata(
        userId,
        originalEmail.gmailMessageId
      );

      const gmailDraftId = await GmailService.createDraft(
        userId,
        originalEmail.from,
        `Re: ${originalEmail.subject}`,
        draft.draftBody,
        draft.threadId,
        replyMetadata.inReplyTo,
        replyMetadata.references
      );

      draft.status = 'APPROVED';
      draft.approvedAt = new Date();
      draft.gmailDraftId = gmailDraftId;
      draft.auditTrail.push({
        at: new Date(),
        action: 'APPROVED',
        by: 'user',
        meta: { gmailDraftId: gmailDraftId || null },
      });

      await draft.save();
      await this.logActivity(userId, 'DRAFT_APPROVED', draft._id.toString(), {
        gmailDraftId,
      });

      logger.info(
        { userId, draftId, gmailDraftId },
        'Draft approved and saved to Gmail'
      );

      return draft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to approve draft'
      );
      throw error;
    }
  }

  /**
   * Reject a draft
   */
  static async rejectDraft(userId: string, draftId: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = new Types.ObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
        status: 'PENDING',
      });

      if (!draft) {
        throw new Error('Draft not found or not in PENDING status');
      }

      draft.status = 'REJECTED';
      draft.rejectedAt = new Date();
      draft.auditTrail.push({
        at: new Date(),
        action: 'REJECTED',
        by: 'user',
      });

      await draft.save();
      await this.logActivity(userId, 'DRAFT_REJECTED', draft._id.toString());

      logger.info({ userId, draftId }, 'Draft rejected');

      return draft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to reject draft'
      );
      throw error;
    }
  }

  /**
   * Send an approved draft exactly once per draft.
   *
   * The draft document is the durable lock: a request atomically claims an
   * APPROVED, unclaimed draft with its idempotency key before Gmail is called.
   * Concurrent or repeated requests lose the claim and either receive the stored
   * result (same key, already SENT) or a 409 — they never reach Gmail.
   *
   * Limitation: if the process dies after Gmail accepts the message but before
   * the SENT result is persisted, the claim is left behind. It expires after
   * SEND_CLAIM_LEASE_MS; a later retry then re-sends the same Gmail draft id,
   * which Gmail rejects because sent drafts are deleted.
   */
  static async sendDraft(userId: string, draftId: string, idempotencyKey: string): Promise<any> {
    try {
      if (!Types.ObjectId.isValid(draftId)) {
        throw new NotFoundError('Draft not found');
      }
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = new Types.ObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
      });

      if (!draft) {
        throw new NotFoundError('Draft not found');
      }

      if (draft.status === 'APPROVED' && !draft.gmailDraftId) {
        throw new ConflictError('Gmail draft ID not found. Please approve the draft first.');
      }

      // Atomically claim the send. Only one request can match this filter.
      const claimedAt = new Date();
      const claimed = await Draft.findOneAndUpdate(
        {
          _id: draftObjectId,
          userId: userObjectId,
          status: 'APPROVED',
          $or: [
            { sendIdempotencyKey: null },
            { sendClaimedAt: { $lt: new Date(claimedAt.getTime() - this.SEND_CLAIM_LEASE_MS) } },
          ],
        },
        { $set: { sendIdempotencyKey: idempotencyKey, sendClaimedAt: claimedAt } },
        { returnDocument: 'after' }
      );

      if (!claimed) {
        return this.resolveLostSendClaim(userId, draftObjectId, userObjectId, idempotencyKey);
      }

      let sentMessageId: string;
      try {
        sentMessageId = await GmailService.sendDraft(
          userId,
          claimed.gmailDraftId as string,
          claimed.threadId
        );
      } catch (gmailError) {
        // Gmail rejected the send: release our claim so the user can retry.
        await Draft.updateOne(
          { _id: draftObjectId, status: 'APPROVED', sendIdempotencyKey: idempotencyKey },
          { $set: { sendIdempotencyKey: null, sendClaimedAt: null } }
        );
        throw gmailError;
      }

      // Persist the result. The claim is intentionally not released if this
      // fails, so a retry cannot trigger a second Gmail send.
      const sentAt = new Date();
      const sentDraft = await Draft.findOneAndUpdate(
        { _id: draftObjectId, sendIdempotencyKey: idempotencyKey },
        {
          $set: {
            status: 'SENT',
            sentAt,
            sentGmailMessageId: sentMessageId,
            sendClaimedAt: null,
          },
          $push: {
            auditTrail: {
              at: sentAt,
              action: 'SENT',
              by: 'user',
              meta: { sentGmailMessageId: sentMessageId, idempotencyKey },
            },
          },
        },
        { returnDocument: 'after' }
      );

      if (!sentDraft) {
        throw new Error('Draft send claim was lost before the result could be recorded');
      }

      await this.logActivity(userId, 'DRAFT_SENT', sentDraft._id.toString(), {
        sentGmailMessageId: sentMessageId,
        idempotencyKey,
      });

      await this.recordOutboundMessage(userId, userObjectId, sentDraft, sentMessageId);

      logger.info(
        { userId, draftId, sentMessageId, idempotencyKey },
        'Draft sent successfully'
      );

      return sentDraft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to send draft'
      );
      throw error;
    }
  }

  /**
   * Decide the response for a request that did not win the send claim.
   */
  private static async resolveLostSendClaim(
    userId: string,
    draftObjectId: Types.ObjectId,
    userObjectId: Types.ObjectId,
    idempotencyKey: string
  ): Promise<any> {
    const current = await Draft.findOne({ _id: draftObjectId, userId: userObjectId });

    if (!current) {
      throw new NotFoundError('Draft not found');
    }

    if (current.status === 'SENT') {
      if (current.sendIdempotencyKey === idempotencyKey) {
        logger.info(
          { userId, draftId: current._id, idempotencyKey },
          'Duplicate send request; returning stored result'
        );
        return current;
      }
      throw new ConflictError('Draft has already been sent');
    }

    if (current.status !== 'APPROVED') {
      throw new ConflictError(`Cannot send draft with status: ${current.status}. Must be APPROVED.`);
    }

    throw new ConflictError('A send for this draft is already in progress');
  }

  /**
   * Cache the sent reply locally. Failure here must not report the send as failed.
   */
  private static async recordOutboundMessage(
    userId: string,
    userObjectId: Types.ObjectId,
    draft: any,
    sentMessageId: string
  ): Promise<void> {
    try {
      const originalEmail = await EmailMessage.findOne({
        userId: userObjectId,
        gmailMessageId: draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
          ? draft.gmailMessageId[0]
          : draft.gmailMessageId),
      });

      if (!originalEmail) {
        return;
      }

      await EmailMessage.create({
        userId: userObjectId,
        gmailMessageId: sentMessageId,
        threadId: draft.threadId,
        from: originalEmail.to, // We sent to the original sender
        to: originalEmail.from,
        subject: `Re: ${originalEmail.subject}`,
        snippet: draft.draftBody.substring(0, 255),
        bodyPlain: draft.draftBody,
        bodyHtml: draft.draftBody,
        internalDate: new Date(),
        direction: 'OUTBOUND',
        labels: ['SENT'],
      });

      logger.info(
        { userId, sentMessageId, threadId: draft.threadId },
        'Outbound EmailMessage created'
      );
    } catch (error) {
      logger.warn(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to record outbound EmailMessage after send'
      );
    }
  }
}
