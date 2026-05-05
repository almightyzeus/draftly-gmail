import { Types } from 'mongoose';
import { logger } from '../utils/logger.js';
import { Draft } from '../models/Draft.js';
import { EmailMessage } from '../models/EmailMessage.js';
import { OpenAIService } from './openaiService.js';
/**
 * DraftService - Handles draft generation, approval, rejection, and sending
 */
export class DraftService {
    /**
     * Generate a draft reply using OpenAI
     */
    static async generateDraft(userId, gmailMessageId, tone = 'formal') {
        try {
            const userObjectId = new Types.ObjectId(userId);
            // Check if draft already exists for this email (idempotency)
            const existingDraft = await Draft.findOne({
                userId: userObjectId,
                gmailMessageId,
                status: 'PENDING',
            });
            if (existingDraft) {
                logger.warn({ userId, gmailMessageId }, 'Draft already exists for this email');
                return existingDraft;
            }
            // Get original email to extract thread info
            const originalEmail = await EmailMessage.findOne({
                userId: userObjectId,
                gmailMessageId,
            });
            if (!originalEmail) {
                throw new Error('Email not found');
            }
            // Generate draft using OpenAI
            const draftBody = await OpenAIService.generateDraft(userId, gmailMessageId, tone);
            // Create draft record
            const draft = new Draft({
                userId: userObjectId,
                gmailMessageId,
                threadId: originalEmail.threadId,
                tone,
                promptVersion: this.PROMPT_VERSION,
                draftBody,
                status: 'PENDING',
                auditTrail: [
                    {
                        at: new Date(),
                        action: 'GENERATED',
                        by: 'system',
                        meta: { tone },
                    },
                ],
            });
            await draft.save();
            logger.info({ userId, gmailMessageId, draftId: draft._id, tone }, 'Draft generated and saved');
            return draft;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to generate draft');
            throw error;
        }
    }
    /**
     * Get drafts for user with optional status filter
     */
    static async getUserDrafts(userId, status, limit = 20) {
        try {
            const userObjectId = new Types.ObjectId(userId);
            const query = { userId: userObjectId };
            if (status) {
                query.status = status;
            }
            const drafts = await Draft.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
            return drafts;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to get user drafts');
            throw error;
        }
    }
    /**
     * Get a specific draft by ID
     */
    static async getDraftById(userId, draftId) {
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
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to get draft');
            throw error;
        }
    }
    /**
     * Update draft content
     */
    static async updateDraft(userId, draftId, draftBody) {
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
            draft.draftBody = draftBody;
            draft.auditTrail.push({
                at: new Date(),
                action: 'EDITED',
                by: 'user',
                meta: { bodyLength: draftBody.length },
            });
            await draft.save();
            logger.info({ userId, draftId }, 'Draft updated');
            return draft;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to update draft');
            throw error;
        }
    }
    /**
     * Approve a draft (mark as ready to send)
     */
    static async approveDraft(userId, draftId) {
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
            draft.status = 'APPROVED';
            draft.approvedAt = new Date();
            draft.auditTrail.push({
                at: new Date(),
                action: 'APPROVED',
                by: 'user',
            });
            await draft.save();
            logger.info({ userId, draftId }, 'Draft approved');
            return draft;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to approve draft');
            throw error;
        }
    }
    /**
     * Reject a draft
     */
    static async rejectDraft(userId, draftId) {
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
            logger.info({ userId, draftId }, 'Draft rejected');
            return draft;
        }
        catch (error) {
            logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to reject draft');
            throw error;
        }
    }
    /**
     * Send an approved draft
     */
    static async sendDraft(userId, draftId, idempotencyKey) {
        throw new Error('Not implemented yet (Day 4)');
    }
}
DraftService.PROMPT_VERSION = '1.0';
