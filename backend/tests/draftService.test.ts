import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { DraftService } from '../src/services/draftService.js';
import { Draft } from '../src/models/Draft.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { OpenAIService } from '../src/services/openaiService.js';
import { GmailService } from '../src/services/gmailService.js';
import { ActivityLogService } from '../src/services/activityLogService.js';
import { UserPreference } from '../src/models/UserPreference.js';
import { AppError, ForbiddenError } from '../src/utils/errors.js';

vi.mock('../src/models/Draft.js', () => {
  const DraftMock = vi.fn();
  Object.assign(DraftMock, {
    findOne: vi.fn(),
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  });
  return { Draft: DraftMock };
});

vi.mock('../src/models/EmailMessage.js', () => ({
  EmailMessage: {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../src/services/openaiService.js', () => ({
  OpenAIService: { generateDraft: vi.fn() },
}));

vi.mock('../src/services/gmailService.js', () => ({
  GmailService: {
    fetchThreadEmails: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    sendDraft: vi.fn(),
    deleteDraft: vi.fn(),
    getReplyMetadata: vi.fn(),
    getSenderAddress: vi.fn(),
  },
}));

vi.mock('../src/models/UserPreference.js', () => ({
  UserPreference: { findOne: vi.fn() },
}));

vi.mock('../src/services/activityLogService.js', () => ({
  ActivityLogService: { logActivity: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const userId = new Types.ObjectId().toString();
const draftId = new Types.ObjectId().toString();
const email = {
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(userId),
  gmailMessageId: 'msg-1',
  threadId: 'thread-1',
  from: 'sender@example.com',
  to: 'user@gmail.com',
  subject: 'Question',
  bodyPlain: 'Can you help?',
  labels: ['INBOX', 'UNREAD'],
};

const buildDraft = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(draftId),
  userId: new Types.ObjectId(userId),
  gmailMessageId: 'msg-1',
  threadId: 'thread-1',
  tone: 'formal',
  draftBody: 'Draft body',
  status: 'PENDING',
  auditTrail: [],
  save: vi.fn().mockResolvedValue(true),
  ...overrides,
});

describe('DraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (OpenAIService.generateDraft as unknown as Mock).mockResolvedValue('Generated reply');
    (ActivityLogService.logActivity as unknown as Mock).mockResolvedValue({});
    (GmailService.getSenderAddress as unknown as Mock).mockResolvedValue('user@gmail.com');
    (GmailService.getReplyMetadata as unknown as Mock).mockResolvedValue({
      inReplyTo: '<rfc-message@example.com>',
      references: '<older@example.com> <rfc-message@example.com>',
    });
  });

  describe('toResponse', () => {
    const arrangeTargets = (targets: any[]) => {
      const chain = { select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue(targets) };
      (EmailMessage.find as unknown as Mock).mockReturnValue(chain);
      return chain;
    };

    it('adds who the reply goes to and its subject, with one query for a list', async () => {
      arrangeTargets([
        { gmailMessageId: 'msg-1', from: 'Alice <alice@example.com>', subject: 'Budget' },
        { gmailMessageId: 'msg-2', from: 'bob@example.com', subject: 'Trip' },
      ]);
      const drafts = [
        { _id: 'd1', replyToGmailMessageId: 'msg-1', status: 'PENDING' },
        { _id: 'd2', gmailMessageId: ['msg-2', 'msg-0'], status: 'SENT' },
        { _id: 'd3', replyToGmailMessageId: 'gone', status: 'REJECTED' },
      ];

      const result = await DraftService.toResponse(userId, drafts);

      expect(EmailMessage.find).toHaveBeenCalledTimes(1);
      expect(EmailMessage.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(userId),
        gmailMessageId: { $in: ['msg-1', 'msg-2', 'gone'] },
      });
      expect(result.map((d: any) => d.replyTo)).toEqual([
        { from: 'Alice <alice@example.com>', subject: 'Budget' },
        { from: 'bob@example.com', subject: 'Trip' },
        null,
      ]);
    });

    it('shapes a single Mongoose document into a plain object', async () => {
      arrangeTargets([{ gmailMessageId: 'msg-1', from: 'a@example.com', subject: 'Hi' }]);
      const doc = { toObject: () => ({ _id: 'd1', replyToGmailMessageId: 'msg-1', draftBody: 'x' }) };

      await expect(DraftService.toResponse(userId, doc)).resolves.toEqual({
        _id: 'd1',
        replyToGmailMessageId: 'msg-1',
        draftBody: 'x',
        replyTo: { from: 'a@example.com', subject: 'Hi' },
      });
    });

    it('skips the query for an empty list', async () => {
      await expect(DraftService.toResponse(userId, [])).resolves.toEqual([]);
      expect(EmailMessage.find).not.toHaveBeenCalled();
    });
  });

  it('generates a draft from a stored email', async () => {
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (Draft.findOne as unknown as Mock).mockResolvedValue(null);
    (Draft as unknown as Mock).mockImplementation((data) => buildDraft({ ...data, _id: new Types.ObjectId(draftId) }));

    const result = await DraftService.generateDraft(userId, 'msg-1', 'formal');

    expect(result.status).toBe('PENDING');
    expect(result.draftBody).toBe('Generated reply');
    expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, ['msg-1'], 'formal', undefined);
    expect(ActivityLogService.logActivity).toHaveBeenCalledWith(userId, 'DRAFT_GENERATED', 'Draft', 'info', draftId, expect.any(Object));
  });

  describe('tone when none is requested', () => {
    const arrangePreference = (preference: any) => {
      (UserPreference.findOne as unknown as Mock).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(preference),
      });
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
      (Draft.findOne as unknown as Mock).mockResolvedValue(null);
      (Draft as unknown as Mock).mockImplementation((data) => buildDraft({ ...data, _id: new Types.ObjectId(draftId) }));
    };

    it("uses the user's defaultTone preference", async () => {
      arrangePreference({ defaultTone: 'friendly' });

      const result = await DraftService.generateDraft(userId, 'msg-1');

      expect(UserPreference.findOne).toHaveBeenCalledWith({ userId: new Types.ObjectId(userId) });
      expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, ['msg-1'], 'friendly', undefined);
      expect(result.tone).toBe('friendly');
    });

    it('falls back to formal without a stored preference', async () => {
      arrangePreference(null);

      const result = await DraftService.generateDraft(userId, 'msg-1');

      expect(result.tone).toBe('formal');
    });

    it('does not look up the preference when a tone is requested', async () => {
      arrangePreference({ defaultTone: 'friendly' });

      await DraftService.generateDraft(userId, 'msg-1', 'concise');

      expect(UserPreference.findOne).not.toHaveBeenCalled();
      expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, ['msg-1'], 'concise', undefined);
    });
  });

  describe('an existing PENDING draft for the thread', () => {
    const oldDraftId = new Types.ObjectId();
    const arrangeExisting = (tone = 'formal') => {
      const existing = buildDraft({ _id: oldDraftId, tone });
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
      (Draft.findOne as unknown as Mock).mockResolvedValue(existing);
      (Draft as unknown as Mock).mockImplementation((data) => buildDraft(data));
      (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValue({ ...existing, status: 'REJECTED' });
      return existing;
    };
    /** The id the service chose for the new draft (it is set before saving). */
    const newDraftId = (call = 0) => (Draft as unknown as Mock).mock.calls[call][0]._id.toString();
    const duplicateKey = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const expectSuperseded = (supersededBy = newDraftId()) => {
      expect(Draft.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: oldDraftId, userId: new Types.ObjectId(userId), status: 'PENDING' },
        {
          $set: { status: 'REJECTED', rejectedAt: expect.any(Date) },
          $push: {
            auditTrail: {
              at: expect.any(Date),
              action: 'SUPERSEDED',
              by: 'system',
              meta: { supersededBy },
            },
          },
        },
        { returnDocument: 'after' }
      );
      expect(ActivityLogService.logActivity).toHaveBeenCalledWith(
        userId, 'DRAFT_SUPERSEDED', 'Draft', 'info', oldDraftId.toString(), { supersededBy }
      );
    };

    it('is returned for the same tone without new context (e.g. a double click)', async () => {
      const existing = arrangeExisting('formal');

      await expect(DraftService.generateDraft(userId, 'msg-1', 'formal')).resolves.toBe(existing);
      expect(OpenAIService.generateDraft).not.toHaveBeenCalled();
      expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('is replaced when a different tone is requested (regression: old draft silently reused)', async () => {
      arrangeExisting('formal');

      const result = await DraftService.generateDraft(userId, 'msg-1', 'friendly');

      expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, ['msg-1'], 'friendly', undefined);
      expect(result.tone).toBe('friendly');
      expect(result.draftBody).toBe('Generated reply');
      expectSuperseded();
    });

    it('is replaced when the user gives new instructions, even with the same tone', async () => {
      arrangeExisting('formal');

      const result = await DraftService.generateDraft(userId, 'msg-1', 'formal', undefined, 'Decline politely');

      expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, ['msg-1'], 'formal', 'Decline politely');
      expect(result.draftBody).toBe('Generated reply');
      expectSuperseded();
    });

    it('is kept when generating the replacement fails', async () => {
      arrangeExisting('formal');
      (OpenAIService.generateDraft as unknown as Mock).mockRejectedValueOnce(new AppError('The AI returned an empty draft. Please try again.', 502));

      await expect(DraftService.generateDraft(userId, 'msg-1', 'concise')).rejects.toMatchObject({ statusCode: 502 });
      expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('is retired before the new draft is saved, and restored if that save fails', async () => {
      arrangeExisting('formal');
      const save = vi.fn().mockRejectedValue(new Error('write failed'));
      (Draft as unknown as Mock).mockImplementation((data) => buildDraft({ ...data, save }));

      await expect(DraftService.generateDraft(userId, 'msg-1', 'concise')).rejects.toThrow('write failed');

      const retireOrder = (Draft.findOneAndUpdate as unknown as Mock).mock.invocationCallOrder[0];
      expect(retireOrder).toBeLessThan(save.mock.invocationCallOrder[0]);
      expect(Draft.updateOne).toHaveBeenCalledWith(
        {
          _id: oldDraftId,
          userId: new Types.ObjectId(userId),
          status: 'REJECTED',
          'auditTrail.meta.supersededBy': newDraftId(),
        },
        {
          $set: { status: 'PENDING', rejectedAt: null },
          $pull: { auditTrail: { action: 'SUPERSEDED', 'meta.supersededBy': newDraftId() } },
        }
      );
      expect(ActivityLogService.logActivity).not.toHaveBeenCalledWith(
        userId, 'DRAFT_SUPERSEDED', expect.anything(), expect.anything(), expect.anything(), expect.anything()
      );
    });

    describe('when a concurrent generation saves a pending draft first (duplicate key)', () => {
      const winnerId = new Types.ObjectId();

      it('returns that draft when it matches the request, and records it as the replacement', async () => {
        const existing = arrangeExisting('formal');
        const winner = buildDraft({ _id: winnerId, tone: 'concise' });
        (Draft.findOne as unknown as Mock).mockResolvedValueOnce(existing) // pre-check
          .mockResolvedValueOnce(existing) // savePendingDraft
          .mockResolvedValueOnce(winner); // after the duplicate key
        (Draft as unknown as Mock).mockImplementation((data) =>
          buildDraft({ ...data, save: vi.fn().mockRejectedValue(duplicateKey()) })
        );

        await expect(DraftService.generateDraft(userId, 'msg-1', 'concise')).resolves.toBe(winner);

        expect(Draft.updateOne).toHaveBeenCalledWith(
          { _id: oldDraftId, 'auditTrail.meta.supersededBy': newDraftId() },
          { $set: { 'auditTrail.$.meta.supersededBy': winnerId.toString() } }
        );
        expect(ActivityLogService.logActivity).toHaveBeenCalledWith(
          userId, 'DRAFT_SUPERSEDED', 'Draft', 'info', oldDraftId.toString(), { supersededBy: winnerId.toString() }
        );
        expect(ActivityLogService.logActivity).not.toHaveBeenCalledWith(
          userId, 'DRAFT_GENERATED', expect.anything(), expect.anything(), expect.anything(), expect.anything()
        );
      });

      it('replaces that draft when it does not match the request', async () => {
        (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
        const winner = buildDraft({ _id: winnerId, tone: 'formal' });
        (Draft.findOne as unknown as Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
        const save = vi.fn().mockRejectedValueOnce(duplicateKey()).mockResolvedValueOnce(true);
        (Draft as unknown as Mock).mockImplementation((data) => buildDraft({ ...data, save }));
        (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValue({ ...winner, status: 'REJECTED' });

        const result = await DraftService.generateDraft(userId, 'msg-1', 'friendly');

        expect(result.tone).toBe('friendly');
        expect(save).toHaveBeenCalledTimes(2);
        expect(newDraftId(1)).toBe(newDraftId(0));
        expect(Draft.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: winnerId, userId: new Types.ObjectId(userId), status: 'PENDING' },
          expect.objectContaining({ $set: { status: 'REJECTED', rejectedAt: expect.any(Date) } }),
          { returnDocument: 'after' }
        );
        expect(ActivityLogService.logActivity).toHaveBeenCalledWith(
          userId, 'DRAFT_SUPERSEDED', 'Draft', 'info', winnerId.toString(), { supersededBy: newDraftId() }
        );
        expect(ActivityLogService.logActivity).toHaveBeenCalledWith(
          userId, 'DRAFT_GENERATED', 'Draft', 'info', newDraftId(), expect.any(Object)
        );
      });

      it('gives up with 409 when every attempt collides', async () => {
        (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
        (Draft.findOne as unknown as Mock).mockResolvedValue(null);
        const save = vi.fn().mockRejectedValue(duplicateKey());
        (Draft as unknown as Mock).mockImplementation((data) => buildDraft({ ...data, save }));

        await expect(DraftService.generateDraft(userId, 'msg-1', 'formal')).rejects.toMatchObject({ statusCode: 409 });
        expect(save).toHaveBeenCalledTimes(DraftService.MAX_PENDING_SAVE_ATTEMPTS);
      });
    });

    it('is not logged as superseded if it left PENDING meanwhile (e.g. approved)', async () => {
      arrangeExisting('formal');
      (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValue(null);

      await DraftService.generateDraft(userId, 'msg-1', 'concise');

      expect(ActivityLogService.logActivity).not.toHaveBeenCalledWith(
        userId, 'DRAFT_SUPERSEDED', expect.anything(), expect.anything(), expect.anything(), expect.anything()
      );
    });
  });

  describe('reply target never resolves to the user (regression: replies sent to self)', () => {
    const msg = (id: string, direction: 'INBOUND' | 'OUTBOUND', from: string, unread = false) => ({
      ...email,
      gmailMessageId: id,
      direction,
      from,
      labels: unread ? ['INBOX', 'UNREAD'] : ['INBOX'],
    });
    const arrangeNewDraft = () => {
      (Draft.findOne as unknown as Mock).mockResolvedValue(null);
      (Draft as unknown as Mock).mockImplementation((data) => buildDraft(data));
    };

    it('replies to the read inbound message when the newest messages are the user\'s own (exact thread shape seen in production)', async () => {
      // Newest first: three self-addressed replies (unread in the user's inbox),
      // two earlier sent replies, then the only message from the other person (read).
      (GmailService.fetchThreadEmails as unknown as Mock).mockResolvedValue([
        msg('self-3', 'OUTBOUND', 'User <user@gmail.com>', true),
        msg('self-2', 'OUTBOUND', 'User <user@gmail.com>', true),
        msg('self-1', 'OUTBOUND', 'User <user@gmail.com>', true),
        msg('sent-2', 'OUTBOUND', 'User <user@gmail.com>'),
        msg('sent-1', 'OUTBOUND', 'User <user@gmail.com>'),
        msg('from-them', 'INBOUND', 'Sender <sender@example.com>'),
      ]);
      arrangeNewDraft();

      const result = await DraftService.generateDraft(userId, undefined, 'formal', 'thread-1');

      expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, ['from-them'], 'formal', undefined);
      expect(result.replyToGmailMessageId).toBe('from-them');
      expect(result.isConsolidated).toBe(false);
    });

    it('picks the latest inbound message when none is unread', async () => {
      (GmailService.fetchThreadEmails as unknown as Mock).mockResolvedValue([
        msg('mine', 'OUTBOUND', 'user@gmail.com'),
        msg('their-newer', 'INBOUND', 'sender@example.com'),
        msg('their-older', 'INBOUND', 'sender@example.com'),
      ]);
      arrangeNewDraft();

      const result = await DraftService.generateDraft(userId, undefined, 'formal', 'thread-1');

      expect(result.replyToGmailMessageId).toBe('their-newer');
    });

    it('returns 422 for a thread with no message from someone else', async () => {
      (GmailService.fetchThreadEmails as unknown as Mock).mockResolvedValue([
        msg('mine-2', 'OUTBOUND', 'user@gmail.com', true),
        msg('mine-1', 'OUTBOUND', 'user@gmail.com'),
      ]);

      await expect(DraftService.generateDraft(userId, undefined, 'formal', 'thread-1')).rejects.toMatchObject({
        statusCode: 422,
        message: 'This thread has no message from someone else to reply to.',
      });
      expect(OpenAIService.generateDraft).not.toHaveBeenCalled();
    });

    it('returns 422 when asked to reply directly to the user\'s own message', async () => {
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(msg('mine', 'OUTBOUND', 'user@gmail.com'));

      await expect(DraftService.generateDraft(userId, 'mine', 'formal')).rejects.toMatchObject({ statusCode: 422 });
      expect(OpenAIService.generateDraft).not.toHaveBeenCalled();
    });

    it.each([
      ['an OUTBOUND target', msg('mine', 'OUTBOUND', 'Someone <someone@example.com>')],
      ['a target from the user\'s address (legacy misclassified as INBOUND)', msg('mine', 'INBOUND', 'User <USER@gmail.com>')],
    ])('approve refuses %s and creates no Gmail draft', async (_label, target) => {
      (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ replyToGmailMessageId: 'mine' }));
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(target);

      await expect(DraftService.approveDraft(userId, draftId)).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('would be sent to your own address'),
      });
      expect(GmailService.createDraft).not.toHaveBeenCalled();
    });

    describe('the user being one of several recipients does not block replies', () => {
      // From someone else; the user is in To/Cc alongside other people.
      const groupMail = {
        ...msg('group-1', 'INBOUND', 'Alice <alice@example.com>', true),
        to: 'User <user@gmail.com>, Bob <bob@example.com>',
      };

      it('generate targets the group message', async () => {
        (GmailService.fetchThreadEmails as unknown as Mock).mockResolvedValue([
          msg('mine', 'OUTBOUND', 'User <user@gmail.com>'),
          groupMail,
        ]);
        arrangeNewDraft();

        const result = await DraftService.generateDraft(userId, undefined, 'formal', 'thread-1');

        expect(result.replyToGmailMessageId).toBe('group-1');
      });

      it('approve creates the Gmail draft addressed to the sender', async () => {
        (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ replyToGmailMessageId: 'group-1' }));
        (EmailMessage.findOne as unknown as Mock).mockResolvedValue(groupMail);
        (GmailService.createDraft as unknown as Mock).mockResolvedValue('gmail-draft-1');

        await expect(DraftService.approveDraft(userId, draftId)).resolves.toMatchObject({ status: 'APPROVED' });
        expect(GmailService.createDraft).toHaveBeenCalledWith(
          userId,
          'Alice <alice@example.com>',
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String)
        );
      });

      it('send goes ahead', async () => {
        const approved = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1', replyToGmailMessageId: 'group-1' });
        (Draft.findOne as unknown as Mock).mockResolvedValue(approved);
        (EmailMessage.findOne as unknown as Mock).mockResolvedValue(groupMail);
        (Draft.findOneAndUpdate as unknown as Mock)
          .mockResolvedValueOnce({ ...approved, sendIdempotencyKey: 'key-1' })
          .mockResolvedValueOnce({ ...approved, status: 'SENT', sentGmailMessageId: 'sent-1' });
        (GmailService.sendDraft as unknown as Mock).mockResolvedValue('sent-1');

        await expect(DraftService.sendDraft(userId, draftId, 'key-1')).resolves.toMatchObject({ status: 'SENT' });
        expect(GmailService.sendDraft).toHaveBeenCalledTimes(1);
      });
    });

    it('send refuses an already-APPROVED draft addressed to the user, without claiming or calling Gmail', async () => {
      (Draft.findOne as unknown as Mock).mockResolvedValue(
        buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1', replyToGmailMessageId: 'mine' })
      );
      (EmailMessage.findOne as unknown as Mock).mockResolvedValue(msg('mine', 'OUTBOUND', 'user@gmail.com'));

      await expect(DraftService.sendDraft(userId, draftId, 'key-1')).rejects.toMatchObject({ statusCode: 409 });
      expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
      expect(GmailService.sendDraft).not.toHaveBeenCalled();
    });
  });

  it('supports thread consolidation', async () => {
    (GmailService.fetchThreadEmails as unknown as Mock).mockResolvedValue([
      { ...email, gmailMessageId: 'msg-1', direction: 'INBOUND' },
      { ...email, gmailMessageId: 'msg-2', direction: 'INBOUND' },
    ]);
    (Draft.findOne as unknown as Mock).mockResolvedValue(null);
    (Draft as unknown as Mock).mockImplementation((data) => buildDraft(data));

    const result = await DraftService.generateDraft(userId, undefined, 'friendly', 'thread-1');
    expect(result.isConsolidated).toBe(true);
    expect(result.gmailMessageId).toEqual(['msg-1', 'msg-2']);
    expect(result.replyToGmailMessageId).toBe('msg-1');
    expect(OpenAIService.generateDraft).toHaveBeenCalledWith(
      userId,
      ['msg-1', 'msg-2'],
      'friendly',
      undefined
    );
  });

  it('lists and gets drafts for a user', async () => {
    const draft = buildDraft();
    const chain = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([draft]) };
    (Draft.find as unknown as Mock).mockReturnValue(chain);
    await expect(DraftService.getUserDrafts(userId, 'PENDING', 10)).resolves.toHaveLength(1);
    expect(chain.limit).toHaveBeenCalledWith(10);

    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    await expect(DraftService.getDraftById(userId, draftId)).resolves.toBe(draft);
  });

  it('updates pending and approved drafts with a conditional write', async () => {
    const pending = buildDraft();
    (Draft.findOne as unknown as Mock).mockResolvedValue(pending);
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce({ ...pending, draftBody: 'Updated' });
    const result = await DraftService.updateDraft(userId, draftId, 'Updated');
    expect(result.draftBody).toBe('Updated');
    expect(Draft.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', sendIdempotencyKey: null }),
      expect.objectContaining({ $set: { draftBody: 'Updated' } }),
      { returnDocument: 'after' }
    );
    expect(GmailService.updateDraft).not.toHaveBeenCalled();

    const approved = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValueOnce(approved);
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce({ ...approved, draftBody: 'Updated approved' });
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    await DraftService.updateDraft(userId, draftId, 'Updated approved');
    expect(GmailService.updateDraft).toHaveBeenCalledWith(
      userId,
      'gmail-draft-1',
      'Updated approved',
      email.from,
      `Re: ${email.subject}`,
      'thread-1',
      '<rfc-message@example.com>',
      '<older@example.com> <rfc-message@example.com>'
    );
  });

  it.each([
    ['the Gmail draft update fails', () => (GmailService.updateDraft as unknown as Mock).mockRejectedValueOnce(new Error('Gmail 500'))],
    ['the original email is missing', () => (EmailMessage.findOne as unknown as Mock).mockResolvedValueOnce(null)],
  ])('does not save an APPROVED draft edit when %s', async (_label, arrange) => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' }));
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    arrange();

    await expect(DraftService.updateDraft(userId, draftId, 'New text')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Could not update the Gmail draft, so your edit was not saved. Please try again.',
    });
    expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['expired or revoked (403)', new ForbiddenError('Gmail access has expired or was revoked. Please reconnect Gmail.')],
    ['rate limited (429)', new AppError('Gmail rate limit exceeded. Please try again shortly.', 429)],
  ])('keeps the status when Gmail access is %s while editing an APPROVED draft', async (_label, gmailError) => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' }));
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (GmailService.updateDraft as unknown as Mock).mockRejectedValueOnce(gmailError);

    await expect(DraftService.updateDraft(userId, draftId, 'New text')).rejects.toBe(gmailError);
    expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['SENT', {}, 'Cannot edit draft with status: SENT'],
    ['REJECTED', {}, 'Cannot edit draft with status: REJECTED'],
    ['APPROVED', { sendIdempotencyKey: 'key-1', gmailDraftId: 'gmail-draft-1' }, 'This draft is being sent and can no longer be edited'],
  ])('refuses to edit a %s draft (409)', async (status, extra, message) => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status, ...extra }));

    await expect(DraftService.updateDraft(userId, draftId, 'New text')).rejects.toMatchObject({ statusCode: 409, message });
    expect(GmailService.updateDraft).not.toHaveBeenCalled();
    expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 when the draft changed between read and write (e.g. a send claimed it)', async () => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft());
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce(null);

    await expect(DraftService.updateDraft(userId, draftId, 'New text')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('approves only pending drafts and requires Gmail draft creation', async () => {
    const draft = buildDraft();
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (GmailService.createDraft as unknown as Mock).mockResolvedValue('gmail-draft-1');

    const result = await DraftService.approveDraft(userId, draftId);
    expect(result.status).toBe('APPROVED');
    expect(result.gmailDraftId).toBe('gmail-draft-1');
    expect(GmailService.createDraft).toHaveBeenCalledWith(
      userId,
      email.from,
      `Re: ${email.subject}`,
      draft.draftBody,
      draft.threadId,
      '<rfc-message@example.com>',
      '<older@example.com> <rfc-message@example.com>'
    );

    (Draft.findOne as unknown as Mock).mockResolvedValue(null);
    await expect(DraftService.approveDraft(userId, draftId)).rejects.toThrow();
  });

  it('rejects pending drafts with a conditional write', async () => {
    const draft = buildDraft();
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce({ ...draft, status: 'REJECTED' });

    const result = await DraftService.rejectDraft(userId, draftId);

    expect(result.status).toBe('REJECTED');
    expect(Draft.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', sendIdempotencyKey: null }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'REJECTED' }) }),
      { returnDocument: 'after' }
    );
    expect(GmailService.deleteDraft).not.toHaveBeenCalled();
  });

  it('withdraws an APPROVED draft and removes its Gmail draft (best effort)', async () => {
    const draft = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValue({ ...draft, status: 'REJECTED' });

    await expect(DraftService.rejectDraft(userId, draftId)).resolves.toMatchObject({ status: 'REJECTED' });
    expect(GmailService.deleteDraft).toHaveBeenCalledWith(userId, 'gmail-draft-1');

    (GmailService.deleteDraft as unknown as Mock).mockRejectedValueOnce(new Error('Gmail 500'));
    await expect(DraftService.rejectDraft(userId, draftId)).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it.each([
    ['SENT', {}],
    ['REJECTED', {}],
  ])('refuses to reject a %s draft (409)', async (status, extra) => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status, ...extra }));

    await expect(DraftService.rejectDraft(userId, draftId)).rejects.toMatchObject({ statusCode: 409 });
    expect(Draft.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to reject a draft whose send is in progress (409)', async () => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'APPROVED', sendIdempotencyKey: 'key-1' }));
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce(null);

    await expect(DraftService.rejectDraft(userId, draftId)).rejects.toMatchObject({ statusCode: 409 });
    expect(GmailService.deleteDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['getDraftById', () => DraftService.getDraftById(userId, draftId)],
    ['updateDraft', () => DraftService.updateDraft(userId, draftId, 'x')],
    ['approveDraft', () => DraftService.approveDraft(userId, draftId)],
    ['rejectDraft', () => DraftService.rejectDraft(userId, draftId)],
  ])('%s returns 404 for a missing or other user\'s draft', async (_name, call) => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(null);
    await expect(call()).rejects.toMatchObject({ statusCode: 404, message: 'Draft not found' });
  });

  it.each([
    ['getDraftById', () => DraftService.getDraftById(userId, 'not-an-id')],
    ['updateDraft', () => DraftService.updateDraft(userId, 'not-an-id', 'x')],
    ['approveDraft', () => DraftService.approveDraft(userId, 'not-an-id')],
    ['rejectDraft', () => DraftService.rejectDraft(userId, 'not-an-id')],
  ])('%s returns 404 (not 500) for a malformed draft id', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
    expect(Draft.findOne).not.toHaveBeenCalled();
  });

  it('refuses to approve a non-PENDING draft with 409', async () => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'APPROVED' }));
    await expect(DraftService.approveDraft(userId, draftId)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot approve draft with status: APPROVED',
    });
    expect(GmailService.createDraft).not.toHaveBeenCalled();
  });

  it('sends approved Gmail drafts and stores outbound email', async () => {
    const draft = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (Draft.findOneAndUpdate as unknown as Mock)
      .mockResolvedValueOnce({ ...draft, sendIdempotencyKey: 'key-1' })
      .mockResolvedValueOnce({ ...draft, status: 'SENT', sentGmailMessageId: 'sent-1' });
    (GmailService.sendDraft as unknown as Mock).mockResolvedValue('sent-1');
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (EmailMessage.create as unknown as Mock).mockResolvedValue({});

    const result = await DraftService.sendDraft(userId, draftId, 'key-1');
    expect(result.status).toBe('SENT');
    expect(result.sentGmailMessageId).toBe('sent-1');
    expect(GmailService.sendDraft).toHaveBeenCalledWith(userId, 'gmail-draft-1', 'thread-1');
    expect((Draft.findOneAndUpdate as unknown as Mock).mock.calls[0][0]).toMatchObject({
      userId: new Types.ObjectId(userId),
      status: 'APPROVED',
    });
    expect(EmailMessage.create).toHaveBeenCalledWith(expect.objectContaining({ direction: 'OUTBOUND' }));
  });

  it('caches the sent reply with escaped HTML, not the raw text, as its HTML body', async () => {
    const draft = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1', draftBody: 'Hi <team>\nThanks & bye' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (Draft.findOneAndUpdate as unknown as Mock)
      .mockResolvedValueOnce({ ...draft, sendIdempotencyKey: 'key-1' })
      .mockResolvedValueOnce({ ...draft, status: 'SENT', sentGmailMessageId: 'sent-1' });
    (GmailService.sendDraft as unknown as Mock).mockResolvedValue('sent-1');
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (EmailMessage.create as unknown as Mock).mockResolvedValue({});

    await DraftService.sendDraft(userId, draftId, 'key-1');

    expect(EmailMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      bodyPlain: 'Hi <team>\nThanks & bye',
      bodyHtml: 'Hi &lt;team&gt;<br>\r\nThanks &amp; bye',
    }));
  });

  it('blocks send for non-approved or missing Gmail draft id', async () => {
    const pending = buildDraft({ status: 'PENDING' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(pending);
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValue(null);
    await expect(DraftService.sendDraft(userId, draftId, 'key')).rejects.toThrow('Must be APPROVED');

    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'APPROVED', gmailDraftId: null }));
    await expect(DraftService.sendDraft(userId, draftId, 'key')).rejects.toThrow('Gmail draft ID not found');
    expect(GmailService.sendDraft).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed or foreign draft id without calling Gmail', async () => {
    await expect(DraftService.sendDraft(userId, 'not-an-id', 'key')).rejects.toMatchObject({ statusCode: 404 });

    (Draft.findOne as unknown as Mock).mockResolvedValue(null);
    await expect(DraftService.sendDraft(userId, draftId, 'key')).rejects.toMatchObject({ statusCode: 404 });
    expect(GmailService.sendDraft).not.toHaveBeenCalled();
  });

  it('releases the send claim when Gmail rejects the send', async () => {
    const draft = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (Draft.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce({ ...draft, sendIdempotencyKey: 'key-1' });
    (GmailService.sendDraft as unknown as Mock).mockRejectedValue(new Error('Gmail down'));

    await expect(DraftService.sendDraft(userId, draftId, 'key-1')).rejects.toThrow('Gmail down');
    expect(Draft.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sendIdempotencyKey: 'key-1', status: 'APPROVED' }),
      { $set: { sendIdempotencyKey: null, sendClaimedAt: null } }
    );
  });

  it('still reports success when caching the outbound message fails', async () => {
    const draft = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (Draft.findOneAndUpdate as unknown as Mock)
      .mockResolvedValueOnce({ ...draft, sendIdempotencyKey: 'key-1' })
      .mockResolvedValueOnce({ ...draft, status: 'SENT', sentGmailMessageId: 'sent-1' });
    (GmailService.sendDraft as unknown as Mock).mockResolvedValue('sent-1');
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (EmailMessage.create as unknown as Mock).mockRejectedValue(new Error('duplicate key'));

    await expect(DraftService.sendDraft(userId, draftId, 'key-1')).resolves.toMatchObject({ status: 'SENT' });
  });
});
