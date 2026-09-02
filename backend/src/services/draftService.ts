import { Types } from 'mongoose';
import { logger } from '../utils/logger.js';
import { Draft } from '../models/Draft.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { OpenAIService } from './openaiService.js';
import { GmailService } from './gmailService.js';
import { ActivityLogService } from './activityLogService.js';

/**
 * DraftService - Handles draft generation, approval, rejection, and sending
 */
export class DraftService {
  private static readonly PROMPT_VERSION = '1.0';

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
   * Send an approved draft
   * Requires idempotency key to prevent double-sends
   */
  static async sendDraft(userId: string, draftId: string, idempotencyKey: string): Promise<any> {
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

      if (draft.status !== 'APPROVED') {
        throw new Error(`Cannot send draft with status: ${draft.status}. Must be APPROVED.`);
      }

      // Idempotency: if already sent with same key, return existing result
      if (draft.sentAt && draft.sentGmailMessageId) {
        logger.warn(
          { userId, draftId, idempotencyKey },
          'Draft already sent, returning existing result'
        );
        return draft;
      }

      if (!draft.gmailDraftId) {
        throw new Error('Gmail draft ID not found. Please approve the draft first.');
      }

      // Send the draft via Gmail
      const sentMessageId = await GmailService.sendDraft(
        userId,
        draft.gmailDraftId,
        draft.threadId
      );

      // Get original email for creating outbound EmailMessage record
      const originalEmail = await EmailMessage.findOne({
        userId: userObjectId,
        gmailMessageId: draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
          ? draft.gmailMessageId[0]
          : draft.gmailMessageId),
      });

      // Update draft status
      draft.status = 'SENT';
      draft.sentAt = new Date();
      draft.sentGmailMessageId = sentMessageId;
      draft.auditTrail.push({
        at: new Date(),
        action: 'SENT',
        by: 'user',
        meta: {
          sentGmailMessageId: sentMessageId,
          idempotencyKey,
        },
      });

      await draft.save();
      await this.logActivity(userId, 'DRAFT_SENT', draft._id.toString(), {
        sentGmailMessageId: sentMessageId,
        idempotencyKey,
      });

      // Create outbound EmailMessage record if original email exists
      if (originalEmail) {
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
      }

      logger.info(
        { userId, draftId, sentMessageId, idempotencyKey },
        'Draft sent successfully'
      );

      return draft;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to send draft'
      );
      throw error;
    }
  }
}
