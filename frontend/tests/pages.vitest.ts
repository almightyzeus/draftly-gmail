import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { FormBuilder } from '@angular/forms';
import { LoginComponent } from '../src/app/pages/login.component';
import { RegisterComponent } from '../src/app/pages/register.component';
import { DashboardComponent } from '../src/app/pages/dashboard.component';
import { EmailDetailComponent } from '../src/app/pages/email-detail.component';
import { DraftDetailComponent } from '../src/app/pages/draft-detail.component';

const snackBar = { open: vi.fn() };
const router = { navigate: vi.fn() };

describe('frontend page classes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);
  });

  it('LoginComponent validates and submits login', () => {
    const auth = { login: vi.fn().mockReturnValue(of({})) };
    const component = new LoginComponent(new FormBuilder(), auth as any, router as any, snackBar as any);

    component.onSubmit();
    expect(auth.login).not.toHaveBeenCalled();

    component.loginForm.setValue({ email: 'user@example.com', password: 'password' });
    component.onSubmit();
    expect(auth.login).toHaveBeenCalledWith('user@example.com', 'password');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('LoginComponent handles login errors', () => {
    const auth = { login: vi.fn().mockReturnValue(throwError(() => ({ error: { error: 'Bad login' } }))) };
    const component = new LoginComponent(new FormBuilder(), auth as any, router as any, snackBar as any);
    component.loginForm.setValue({ email: 'user@example.com', password: 'password' });
    component.onSubmit();
    expect(component.isLoading).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Bad login', 'Close', expect.any(Object));
  });

  it('RegisterComponent validates password match and submits registration', () => {
    const auth = { register: vi.fn().mockReturnValue(of({})) };
    const component = new RegisterComponent(new FormBuilder(), auth as any, router as any, snackBar as any);

    component.registerForm.setValue({
      name: 'User',
      email: 'user@example.com',
      password: 'password',
      confirmPassword: 'different',
    });
    expect(component.registerForm.hasError('passwordMismatch')).toBe(true);

    component.registerForm.patchValue({ confirmPassword: 'password' });
    component.onSubmit();
    expect(auth.register).toHaveBeenCalledWith('User', 'user@example.com', 'password');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('DashboardComponent fetches, formats, navigates, and disconnects Gmail', () => {
    const user$ = new BehaviorSubject<any>({ id: '1', name: 'User', email: 'user@example.com', googleConnected: true });
    const auth = {
      currentUser$: user$.asObservable(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      logout: vi.fn(),
      connectGmail: vi.fn(),
    };
    const gmail = {
      fetchEmails: vi.fn().mockReturnValue(of([{ gmailMessageId: 'msg-1', snippet: 'hello world' }])),
      revokeGmail: vi.fn().mockReturnValue(of({})),
    };
    const component = new DashboardComponent(auth as any, gmail as any, router as any);

    component.ngOnInit();
    expect(gmail.fetchEmails).toHaveBeenCalled();
    expect(component.emails).toHaveLength(1);
    expect(component.truncateSnippet('abcdef', 3)).toBe('abc...');

    component.openEmailDetail(component.emails[0] as any);
    expect(router.navigate).toHaveBeenCalledWith(['/email', 'msg-1']);

    component.disconnectGmail();
    expect(gmail.revokeGmail).toHaveBeenCalled();

    component.logout();
    expect(auth.logout).toHaveBeenCalled();
  });

  it('DashboardComponent reports fetch errors and blocks fetch without Gmail', () => {
    const auth = {
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      isAuthenticated: vi.fn().mockReturnValue(false),
    };
    const gmail = { fetchEmails: vi.fn().mockReturnValue(throwError(() => ({ status: 401 }))) };
    const component = new DashboardComponent(auth as any, gmail as any, router as any);

    component.currentUser = null;
    component.fetchEmails();
    expect(component.emailsError).toContain('Gmail account not connected');

    component.currentUser = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    component.fetchEmails();
    expect(component.emailsError).toContain('Authentication failed');
  });

  it('EmailDetailComponent loads email, generates drafts, sanitizes, and navigates back', () => {
    const route = { params: of({ gmailMessageId: 'msg-1' }) };
    const gmail = { getEmailDetail: vi.fn().mockReturnValue(of({ gmailMessageId: 'msg-1', threadId: 'thread-1', bodyPlain: 'Hi' })) };
    const draft = { generateThreadDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1' })) };
    const sanitizer = {
      sanitize: vi.fn().mockReturnValue('<p>safe</p>'),
      bypassSecurityTrustHtml: vi.fn((value) => value),
    };
    const component = new EmailDetailComponent(route as any, router as any, gmail as any, draft as any, sanitizer as any);

    component.ngOnInit();
    expect(component.email?.gmailMessageId).toBe('msg-1');

    component.customContext = 'context';
    component.generateDraft();
    expect(draft.generateThreadDraft).toHaveBeenCalledWith('thread-1', 'formal', 'context');
    expect(router.navigate).toHaveBeenCalledWith(['/draft', 'draft-1']);

    expect(component.sanitizeHtml('<p>x</p>')).toBe('<p>safe</p>');
    expect(component.formatPlainText('<x>\n&')).toContain('&lt;x&gt;');
    component.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('DraftDetailComponent loads, edits, approves, rejects, and sends drafts', () => {
    vi.useFakeTimers();
    const route = { params: of({ id: 'draft-1' }) };
    const draft = {
      getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Body', status: 'PENDING' })),
      updateDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Updated', status: 'PENDING' })),
      approveDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Updated', status: 'APPROVED' })),
      rejectDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Updated', status: 'REJECTED' })),
      sendDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', status: 'SENT', sentGmailMessageId: 'sent-1' })),
    };
    const component = new DraftDetailComponent(route as any, router as any, draft as any, {} as any);

    component.ngOnInit();
    expect(component.draft?._id).toBe('draft-1');

    component.editedContent = 'Updated';
    component.onContentChange();
    expect(component.hasChanges).toBe(true);
    component.saveDraft();
    expect(draft.updateDraft).toHaveBeenCalledWith('draft-1', 'Updated');

    component.approveDraft();
    expect(draft.approveDraft).toHaveBeenCalledWith('draft-1');

    component.draft = { ...(component.draft as any), status: 'APPROVED' };
    component.sendDraft();
    expect(draft.sendDraft).toHaveBeenCalledWith('draft-1', expect.stringContaining('draft-1-'));

    component.draft = { ...(component.draft as any), status: 'PENDING' };
    component.rejectDraft();
    expect(draft.rejectDraft).toHaveBeenCalledWith('draft-1');
  });
});
