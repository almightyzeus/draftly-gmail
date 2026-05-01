import { logger } from '../utils/logger.js';

/**
 * DraftService - Handles draft generation, approval, rejection, and sending
 * Will be implemented in Day 3-4
 */
export class DraftService {
  /**
   * Generate a draft reply using OpenAI
   */
  static async generateDraft(userId: string, gmailMessageId: string, tone?: string): Promise<any> {
    throw new Error('Not implemented yet');
  }

  /**
   * Get drafts for user with optional status filter
   */
  static async getUserDrafts(userId: string, status?: string, limit?: number): Promise<any[]> {
    throw new Error('Not implemented yet');
  }

  /**
   * Get a specific draft by ID
   */
  static async getDraftById(userId: string, draftId: string): Promise<any> {
    throw new Error('Not implemented yet');
  }

  /**
   * Update draft content
   */
  static async updateDraft(userId: string, draftId: string, draftBody: string): Promise<any> {
    throw new Error('Not implemented yet');
  }

  /**
   * Approve a draft (mark as ready to send)
   */
  static async approveDraft(userId: string, draftId: string): Promise<any> {
    throw new Error('Not implemented yet');
  }

  /**
   * Reject a draft
   */
  static async rejectDraft(userId: string, draftId: string): Promise<any> {
    throw new Error('Not implemented yet');
  }

  /**
   * Send an approved draft
   */
  static async sendDraft(userId: string, draftId: string, idempotencyKey: string): Promise<any> {
    throw new Error('Not implemented yet');
  }
}
