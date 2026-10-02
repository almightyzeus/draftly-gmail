import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';
import { DraftService } from '../src/services/draftService.js';
import { Draft } from '../src/models/Draft.js';
import { EmailMessage } from '../src/models/EmailMessage.js';
import { OpenAIService } from '../src/services/openaiService.js';
import { GmailService } from '../src/services/gmailService.js';
import { ActivityLogService } from '../src/services/activityLogService.js';

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
  },
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
    (GmailService.getReplyMetadata as unknown as Mock).mockResolvedValue({
      inReplyTo: '<rfc-message@example.com>',
      references: '<older@example.com> <rfc-message@example.com>',
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

  it('returns existing pending draft for the same thread', async () => {
    const existing = buildDraft();
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (Draft.findOne as unknown as Mock).mockResolvedValue(existing);

    await expect(DraftService.generateDraft(userId, 'msg-1', 'formal')).resolves.toBe(existing);
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
