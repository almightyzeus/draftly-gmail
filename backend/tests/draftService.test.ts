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
    expect(OpenAIService.generateDraft).toHaveBeenCalledWith(userId, 'msg-1', 'formal', undefined);
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

  it('updates pending and approved drafts', async () => {
    const pending = buildDraft();
    (Draft.findOne as unknown as Mock).mockResolvedValue(pending);
    await DraftService.updateDraft(userId, draftId, 'Updated');
    expect(pending.draftBody).toBe('Updated');

    const approved = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValueOnce(approved);
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    await DraftService.updateDraft(userId, draftId, 'Updated approved');
    expect(GmailService.updateDraft).toHaveBeenCalled();
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

  it('rejects pending drafts', async () => {
    const draft = buildDraft();
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    const result = await DraftService.rejectDraft(userId, draftId);
    expect(result.status).toBe('REJECTED');
  });

  it('sends approved Gmail drafts and stores outbound email', async () => {
    const draft = buildDraft({ status: 'APPROVED', gmailDraftId: 'gmail-draft-1' });
    (Draft.findOne as unknown as Mock).mockResolvedValue(draft);
    (GmailService.sendDraft as unknown as Mock).mockResolvedValue('sent-1');
    (EmailMessage.findOne as unknown as Mock).mockResolvedValue(email);
    (EmailMessage.create as unknown as Mock).mockResolvedValue({});

    const result = await DraftService.sendDraft(userId, draftId, 'key-1');
    expect(result.status).toBe('SENT');
    expect(result.sentGmailMessageId).toBe('sent-1');
    expect(EmailMessage.create).toHaveBeenCalledWith(expect.objectContaining({ direction: 'OUTBOUND' }));
  });

  it('blocks send for non-approved or missing Gmail draft id', async () => {
    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'PENDING' }));
    await expect(DraftService.sendDraft(userId, draftId, 'key')).rejects.toThrow('Must be APPROVED');

    (Draft.findOne as unknown as Mock).mockResolvedValue(buildDraft({ status: 'APPROVED', gmailDraftId: null }));
    await expect(DraftService.sendDraft(userId, draftId, 'key')).rejects.toThrow('Gmail draft ID not found');
  });
});
