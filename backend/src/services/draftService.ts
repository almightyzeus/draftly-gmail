import { Types } from 'mongoose';
import { logger } from '../utils/logger.js';
import { Draft } from '../models/Draft.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { OpenAIService } from './openaiService.js';
import { GmailService } from './gmailService.js';
import { ActivityLogService } from './activityLogService.js';
import { UserPreference } from '../models/UserPreference.js';
import { mailboxAddress, plainTextToHtml } from '../utils/mimeMessage.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * DraftService - Handles draft generation, approval, rejection, and sending
 */
export class DraftService {
  private static readonly PROMPT_VERSION = '1.0';
  /** How long a send claim blocks other requests before it is considered stranded. */
  static readonly SEND_CLAIM_LEASE_MS = 5 * 60 * 1000;

  private static replyTargetId(draft: any): string {
    return draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
      ? draft.gmailMessageId[0]
      : draft.gmailMessageId);
  }

  /**
   * The reply is addressed to the target message's From. Refuse when that is
   * the user's own message/address, so a reply can never be sent to the user.
   */
  private static async assertNotReplyingToSelf(userId: string, targetEmail: any): Promise<void> {
    const recipient = mailboxAddress(targetEmail.from)?.toLowerCase();
    const ownAddress = (await GmailService.getSenderAddress(userId))?.toLowerCase();

    if (targetEmail.direction === 'OUTBOUND' || (recipient && ownAddress && recipient === ownAddress)) {
      throw new ConflictError(
        'This reply would be sent to your own address. Reject it and generate a new draft from the message you received.'
      );
    }
  }

  /** Parse a draft id from the URL; a malformed id is simply "not found". */
  private static toDraftObjectId(draftId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(draftId)) {
      throw new NotFoundError('Draft not found');
    }
    return new Types.ObjectId(draftId);
  }

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
    tone?: string,
    threadId?: string,
    customContext?: string
  ): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      // No tone requested: use the user's defaultTone preference.
      tone = tone || (await this.defaultTone(userObjectId));

      let targetThreadId = threadId;
      let gmailMessageIds: string[] = [];
      let isConsolidated = false;

      // If threadId provided, fetch all emails in thread for consolidation
      if (threadId) {
        const threadEmails = await GmailService.fetchThreadEmails(userId, threadId);
        if (threadEmails.length === 0) {
          throw new NotFoundError('No emails found in thread');
        }

        // Only messages from someone else can be replied to. The user's own
        // messages (including copies of Draftly's sent replies, and replies
        // that landed in their own inbox) must never become the target, or the
        // reply would be addressed to the user.
        const inboundEmails = threadEmails.filter((e) => e.direction === 'INBOUND');
        if (inboundEmails.length === 0) {
          throw new AppError('This thread has no message from someone else to reply to.', 422);
        }

        // Get all unread inbound emails in thread
        const unreadEmails = inboundEmails.filter((e) => e.labels?.includes('UNREAD'));

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
        } else {
          // No unread: reply to the latest message from someone else
          // (newest-first), never simply the latest message in the thread.
          gmailMessageIds = [inboundEmails[0].gmailMessageId];
          targetThreadId = threadId;
        }
      } else if (gmailMessageId) {
        // Single email specified
        const email = await EmailMessage.findOne({
          userId: userObjectId,
          gmailMessageId,
        });

        if (!email) {
          throw new NotFoundError('Email not found');
        }
        if (email.direction === 'OUTBOUND') {
          throw new AppError('This is your own message. Open a message you received to reply to it.', 422);
        }

        gmailMessageIds = [gmailMessageId];
        targetThreadId = email.threadId;
      } else {
        throw new ValidationError('Either gmailMessageId or threadId must be provided');
      }

      // A thread has at most one PENDING draft (a partial unique index enforces
      // it). Repeating the same request (e.g. a double click) returns it without
      // calling the AI. A different tone or new instructions mean the user wants
      // a new draft: it replaces the pending one in savePendingDraft.
      const existingDraft = await Draft.findOne({
        userId: userObjectId,
        threadId: targetThreadId,
        status: 'PENDING',
      });

      if (existingDraft && existingDraft.tone === tone && !customContext) {
        logger.info(
          { userId, threadId: targetThreadId, draftId: existingDraft._id },
          'Pending draft with the same tone already exists for this thread; reusing it'
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

      const { draft, created } = await this.savePendingDraft(userId, userObjectId, tone, customContext, {
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

      if (!created) {
        // A matching draft was generated concurrently and is returned instead.
        return draft;
      }

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

  /** The user's preferred tone, or 'formal' when no preference is stored. */
  private static async defaultTone(userObjectId: Types.ObjectId): Promise<string> {
    const preferences = await UserPreference.findOne({ userId: userObjectId }).select('defaultTone').lean();
    return preferences?.defaultTone || 'formal';
  }

  /** Attempts before giving up when concurrent generations keep colliding. */
  static readonly MAX_PENDING_SAVE_ATTEMPTS = 3;

  private static isDuplicateKeyError(error: unknown): boolean {
    return (error as { code?: number } | null)?.code === 11000;
  }

  /**
   * Save a new draft as the thread's only PENDING draft. The partial unique
   * index `one_pending_draft_per_thread` makes this safe when generations run
   * concurrently:
   * 1. the thread's current PENDING draft, if any, is retired (SUPERSEDED);
   * 2. the new draft is inserted;
   * 3. if the insert fails, the retired draft is restored, so a failed
   *    generation never loses the previous draft;
   * 4. if another generation inserted a PENDING draft in between (duplicate
   *    key), that draft is returned when it matches this request (same tone,
   *    no new instructions); otherwise it is replaced in the next attempt.
   * `created` is false when a matching concurrent draft is returned instead.
   */
  private static async savePendingDraft(
    userId: string,
    userObjectId: Types.ObjectId,
    tone: string,
    customContext: string | undefined,
    data: Record<string, any>
  ): Promise<{ draft: any; created: boolean }> {
    const pendingFilter = { userId: userObjectId, threadId: data.threadId, status: 'PENDING' };
    const newDraftId = new Types.ObjectId();
    let current = await Draft.findOne(pendingFilter);
    // A draft retired in an earlier attempt that still points at newDraftId.
    let carriedRetiredId: Types.ObjectId | null = null;

    for (let attempt = 1; attempt <= this.MAX_PENDING_SAVE_ATTEMPTS; attempt++) {
      if (current && current.tone === tone && !customContext) {
        return { draft: current, created: false };
      }

      const retiredId: Types.ObjectId | null = current
        ? await this.retirePendingDraft(userObjectId, current._id, newDraftId)
        : carriedRetiredId;
      carriedRetiredId = null;

      const draft = new Draft({ ...data, _id: newDraftId });
      try {
        await draft.save();
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) {
          if (retiredId) {
            await this.restoreRetiredDraft(userObjectId, retiredId, newDraftId);
          }
          throw error;
        }

        // Another generation saved a PENDING draft after the retire above.
        current = await Draft.findOne(pendingFilter);
        if (retiredId && current) {
          // The retired draft was replaced by that draft, not by this one.
          await this.repointSupersededDraft(userId, retiredId, newDraftId, current._id);
        } else if (retiredId) {
          // That draft already left PENDING; this draft still replaces it.
          carriedRetiredId = retiredId;
        }
        logger.info(
          { userId, threadId: data.threadId, attempt },
          'Concurrent generation saved a pending draft first'
        );
        continue;
      }

      if (retiredId) {
        await this.logActivity(userId, 'DRAFT_SUPERSEDED', retiredId.toString(), {
          supersededBy: newDraftId.toString(),
        });
      }
      return { draft, created: true };
    }

    throw new ConflictError('Another draft is being generated for this thread. Please try again.');
  }

  /**
   * Mark a PENDING draft as REJECTED because a newer draft replaces it. It
   * stays visible in the drafts list. Returns null when the draft left PENDING
   * meanwhile (e.g. it was approved); it is then left alone.
   */
  private static async retirePendingDraft(
    userObjectId: Types.ObjectId,
    oldDraftId: Types.ObjectId,
    newDraftId: Types.ObjectId
  ): Promise<Types.ObjectId | null> {
    const rejectedAt = new Date();
    const retired = await Draft.findOneAndUpdate(
      { _id: oldDraftId, userId: userObjectId, status: 'PENDING' },
      {
        $set: { status: 'REJECTED', rejectedAt },
        $push: {
          auditTrail: {
            at: rejectedAt,
            action: 'SUPERSEDED',
            by: 'system',
            meta: { supersededBy: newDraftId.toString() },
          },
        },
      },
      { returnDocument: 'after' }
    );
    return retired ? oldDraftId : null;
  }

  /** Undo retirePendingDraft after the replacement could not be saved. */
  private static async restoreRetiredDraft(
    userObjectId: Types.ObjectId,
    oldDraftId: Types.ObjectId,
    newDraftId: Types.ObjectId
  ): Promise<void> {
    try {
      await Draft.updateOne(
        {
          _id: oldDraftId,
          userId: userObjectId,
          status: 'REJECTED',
          'auditTrail.meta.supersededBy': newDraftId.toString(),
        },
        {
          $set: { status: 'PENDING', rejectedAt: null },
          $pull: { auditTrail: { action: 'SUPERSEDED', 'meta.supersededBy': newDraftId.toString() } },
        }
      );
    } catch (error) {
      // E.g. another generation saved a PENDING draft for the thread meanwhile.
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), draftId: oldDraftId.toString() },
        'Could not restore the previous pending draft'
      );
    }
  }

  /** Record which draft actually replaced a retired draft after losing a race. */
  private static async repointSupersededDraft(
    userId: string,
    oldDraftId: Types.ObjectId,
    newDraftId: Types.ObjectId,
    winnerDraftId: Types.ObjectId
  ): Promise<void> {
    await Draft.updateOne(
      { _id: oldDraftId, 'auditTrail.meta.supersededBy': newDraftId.toString() },
      { $set: { 'auditTrail.$.meta.supersededBy': winnerDraftId.toString() } }
    );
    await this.logActivity(userId, 'DRAFT_SUPERSEDED', oldDraftId.toString(), {
      supersededBy: winnerDraftId.toString(),
    });
  }

  /**
   * Startup migration for the `one_pending_draft_per_thread` index: before it
   * existed, a thread could end up with several PENDING drafts. Keep the
   * newest one per thread, retire the rest (SUPERSEDED), then build the index.
   * Returns how many drafts were retired.
   */
  static async enforceSinglePendingDraftPerThread(): Promise<number> {
    const duplicates = await Draft.aggregate<{ ids: Types.ObjectId[] }>([
      { $match: { status: 'PENDING' } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: { userId: '$userId', threadId: '$threadId' }, ids: { $push: '$_id' } } },
      { $match: { 'ids.1': { $exists: true } } },
    ]);

    let retired = 0;
    for (const { ids } of duplicates) {
      const [keep, ...older] = ids;
      const rejectedAt = new Date();
      const result = await Draft.updateMany(
        { _id: { $in: older }, status: 'PENDING' },
        {
          $set: { status: 'REJECTED', rejectedAt },
          $push: {
            auditTrail: {
              at: rejectedAt,
              action: 'SUPERSEDED',
              by: 'system',
              meta: { supersededBy: keep.toString(), reason: 'duplicate_pending' },
            },
          },
        }
      );
      retired += result.modifiedCount;
    }

    await Draft.createIndexes();
    if (retired > 0) {
      logger.warn({ retired }, 'Retired duplicate pending drafts before building the one-pending-draft index');
    }
    return retired;
  }

  /**
   * Shape drafts for the API: plain objects with a `replyTo` summary (the
   * recipient and subject of the message being answered), so the UI can show
   * who a reply goes to. One query for any number of drafts.
   */
  static async toResponse(userId: string, draft: any): Promise<any>;
  static async toResponse(userId: string, drafts: any[]): Promise<any[]>;
  static async toResponse(userId: string, input: any | any[]): Promise<any | any[]> {
    const list = (Array.isArray(input) ? input : [input]).map((draft) =>
      typeof draft?.toObject === 'function' ? draft.toObject() : draft
    );
    const targetIds = [...new Set(list.map((draft) => this.replyTargetId(draft)).filter(Boolean))];

    const targets = targetIds.length
      ? await EmailMessage.find({ userId: new Types.ObjectId(userId), gmailMessageId: { $in: targetIds } })
          .select('gmailMessageId from subject')
          .lean()
      : [];
    const byId = new Map(targets.map((email: any) => [email.gmailMessageId, email]));

    const shaped = list.map((draft) => {
      const target: any = byId.get(this.replyTargetId(draft));
      return { ...draft, replyTo: target ? { from: target.from, subject: target.subject } : null };
    });
    return Array.isArray(input) ? shaped : shaped[0];
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
      const draftObjectId = this.toDraftObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
      });

      if (!draft) {
        throw new NotFoundError('Draft not found');
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
   * Update draft content (both MongoDB + Gmail if approved).
   *
   * For an APPROVED draft the Gmail draft is what gets sent, so it must be
   * updated first: if that fails, nothing is saved and the user sees an error
   * (otherwise the app would show text that Gmail would not send). The Mongo
   * write is conditional, so an edit cannot land on a draft whose status
   * changed meanwhile or that is being (or has been) sent.
   */
  static async updateDraft(userId: string, draftId: string, draftBody: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = this.toDraftObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
      });

      if (!draft) {
        throw new NotFoundError('Draft not found');
      }

      // Only allow editing PENDING or APPROVED drafts
      if (!['PENDING', 'APPROVED'].includes(draft.status)) {
        throw new ConflictError(`Cannot edit draft with status: ${draft.status}`);
      }
      if (draft.sendIdempotencyKey) {
        throw new ConflictError('This draft is being sent and can no longer be edited');
      }

      if (draft.status === 'APPROVED' && draft.gmailDraftId) {
        await this.syncApprovedGmailDraft(userId, userObjectId, draft, draftBody);
      }

      const updated = await Draft.findOneAndUpdate(
        {
          _id: draftObjectId,
          userId: userObjectId,
          status: draft.status,
          sendIdempotencyKey: null,
        },
        {
          $set: { draftBody },
          $push: {
            auditTrail: {
              at: new Date(),
              action: 'EDITED',
              by: 'user',
              meta: { bodyLength: draftBody.length },
            },
          },
        },
        { returnDocument: 'after' }
      );

      if (!updated) {
        throw new ConflictError('The draft changed while saving (it may have been approved or sent). Reload and try again.');
      }

      await this.logActivity(userId, 'DRAFT_EDITED', updated._id.toString(), {
        status: updated.status,
        bodyLength: draftBody.length,
      });

      logger.info({ userId, draftId }, 'Draft updated');

      return updated;
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to update draft'
      );
      throw error;
    }
  }

  /**
   * Push an edited body to the Gmail draft of an APPROVED draft, or fail.
   */
  private static async syncApprovedGmailDraft(
    userId: string,
    userObjectId: Types.ObjectId,
    draft: any,
    draftBody: string
  ): Promise<void> {
    const originalEmail = await EmailMessage.findOne({
      userId: userObjectId,
      gmailMessageId: draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
        ? draft.gmailMessageId[0]
        : draft.gmailMessageId),
    });

    try {
      if (!originalEmail) {
        throw new NotFoundError('Original email not found');
      }

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
    } catch (gmailError) {
      logger.warn(
        gmailError instanceof Error ? gmailError : new Error(String(gmailError)),
        'Failed to update Gmail draft; edit not saved'
      );
      // Expired/revoked Gmail access (403) and Gmail rate limits (429) keep
      // their status so the client can prompt a reconnect or a retry.
      if (gmailError instanceof AppError && [403, 429].includes(gmailError.statusCode)) {
        throw gmailError;
      }
      throw new AppError(
        'Could not update the Gmail draft, so your edit was not saved. Please try again.',
        502
      );
    }
  }

  /**
   * Approve a draft (mark as ready to send + save to Gmail)
   */
  static async approveDraft(userId: string, draftId: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = this.toDraftObjectId(draftId);

      const draft = await Draft.findOne({
        _id: draftObjectId,
        userId: userObjectId,
      });

      if (!draft) {
        throw new NotFoundError('Draft not found');
      }
      if (draft.status !== 'PENDING') {
        throw new ConflictError(`Cannot approve draft with status: ${draft.status}`);
      }

      // Get original email to extract info for Gmail draft
      const originalEmail = await EmailMessage.findOne({
        userId: userObjectId,
        gmailMessageId: draft.replyToGmailMessageId || (Array.isArray(draft.gmailMessageId)
          ? draft.gmailMessageId[0]
          : draft.gmailMessageId),
      });

      if (!originalEmail) {
        throw new NotFoundError('Original email not found');
      }
      await this.assertNotReplyingToSelf(userId, originalEmail);

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
   * Reject a PENDING draft, or withdraw an APPROVED one that no send has
   * claimed. Withdrawing also removes its Gmail draft (best effort) so it
   * cannot be sent from Gmail by mistake.
   */
  static async rejectDraft(userId: string, draftId: string): Promise<any> {
    try {
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = this.toDraftObjectId(draftId);

      const draft = await Draft.findOne({ _id: draftObjectId, userId: userObjectId });
      if (!draft) {
        throw new NotFoundError('Draft not found');
      }
      if (!['PENDING', 'APPROVED'].includes(draft.status)) {
        throw new ConflictError(`Cannot reject draft with status: ${draft.status}`);
      }

      const rejectedAt = new Date();
      const rejected = await Draft.findOneAndUpdate(
        {
          _id: draftObjectId,
          userId: userObjectId,
          status: draft.status,
          sendIdempotencyKey: null,
        },
        {
          $set: { status: 'REJECTED', rejectedAt },
          $push: { auditTrail: { at: rejectedAt, action: 'REJECTED', by: 'user', meta: { previousStatus: draft.status } } },
        },
        { returnDocument: 'after' }
      );

      if (!rejected) {
        throw new ConflictError('The draft changed (it may be being sent). Reload and try again.');
      }

      if (draft.status === 'APPROVED' && draft.gmailDraftId) {
        try {
          await GmailService.deleteDraft(userId, draft.gmailDraftId);
        } catch (gmailError) {
          logger.warn(
            gmailError instanceof Error ? gmailError : new Error(String(gmailError)),
            'Rejected draft but could not delete its Gmail draft'
          );
        }
      }

      await this.logActivity(userId, 'DRAFT_REJECTED', rejected._id.toString(), {
        previousStatus: draft.status,
      });

      logger.info({ userId, draftId }, 'Draft rejected');

      return rejected;
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
      const userObjectId = new Types.ObjectId(userId);
      const draftObjectId = this.toDraftObjectId(draftId);

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

      // Drafts approved before reply targets were restricted may already be
      // addressed to the user; never send those.
      if (draft.status === 'APPROVED') {
        const targetEmail = await EmailMessage.findOne({
          userId: userObjectId,
          gmailMessageId: this.replyTargetId(draft),
        });
        if (targetEmail) {
          await this.assertNotReplyingToSelf(userId, targetEmail);
        }
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
        // Same escaped HTML as the sent message's HTML part (not raw text).
        bodyHtml: plainTextToHtml(draft.draftBody),
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
