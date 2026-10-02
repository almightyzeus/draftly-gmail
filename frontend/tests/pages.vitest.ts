import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
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
      fetchEmailPage: vi.fn().mockReturnValue(of({ emails: [{ gmailMessageId: 'msg-1', snippet: 'hello world' }], nextPageToken: null })),
      revokeGmail: vi.fn().mockReturnValue(of({})),
    };
    const component = new DashboardComponent(auth as any, gmail as any, router as any);

    component.ngOnInit();
    expect(gmail.fetchEmailPage).toHaveBeenCalled();
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
    const gmail = { fetchEmailPage: vi.fn().mockReturnValue(throwError(() => ({ status: 401 }))) };
    const component = new DashboardComponent(auth as any, gmail as any, router as any);

    component.currentUser = null;
    component.fetchEmails();
    expect(component.emailsError).toContain('Gmail account not connected');

    component.currentUser = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    component.fetchEmails();
    expect(component.emailsError).toContain('Authentication failed');
  });

  it('DashboardComponent starts the Gmail connection and reports a failure', () => {
    const auth = {
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      isAuthenticated: vi.fn().mockReturnValue(false),
      connectGmail: vi.fn().mockReturnValueOnce(of(undefined)).mockReturnValueOnce(throwError(() => new Error('network'))),
    };
    const component = new DashboardComponent(auth as any, {} as any, router as any);
    component.ngOnInit();

    component.connectGmail();
    expect(auth.connectGmail).toHaveBeenCalledTimes(1);
    expect(component.emailsError).toBeNull();

    component.connectGmail();
    expect(component.emailsError).toBe('Could not start the Gmail connection. Please try again.');
  });

  it('DashboardComponent switches to Connect Gmail when the Gmail grant has expired (403)', () => {
    const auth = {
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      isAuthenticated: vi.fn().mockReturnValue(false),
    };
    const message = 'Gmail access has expired or was revoked. Please reconnect Gmail.';
    const gmail = { fetchEmailPage: vi.fn().mockReturnValue(throwError(() => ({ status: 403, error: { error: message } }))) };
    const component = new DashboardComponent(auth as any, gmail as any, router as any);
    component.currentUser = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    component.emails = [{ gmailMessageId: 'stale' } as any];

    component.fetchEmails();

    expect(component.emailsError).toBe(message);
    expect(component.currentUser?.googleConnected).toBe(false);
    expect(component.emails).toEqual([]);
    expect(component.isLoadingEmails).toBe(false);
  });

  describe('DashboardComponent Gmail search and pagination', () => {
    const user = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    const page = (ids: string[], nextPageToken: string | null) => ({
      emails: ids.map((id) => ({ gmailMessageId: id })),
      nextPageToken,
    });

    /** Gmail fake: 3 pages for the inbox, keyed by the opaque token it handed out. */
    const pagedGmail = () => ({
      fetchEmailPage: vi.fn((options: any) => {
        const pages: Record<string, any> = {
          first: page(['m1', 'm2'], 'tok-2'),
          'tok-2': page(['m3', 'm4'], 'tok-3'),
          'tok-3': page(['m5'], null),
        };
        return of(pages[options.pageToken ?? 'first']);
      }),
    });

    const create = (gmail: any) => {
      const auth = { currentUser$: of(user), isAuthenticated: vi.fn().mockReturnValue(false) };
      const component = new DashboardComponent(auth as any, gmail as any, router as any);
      component.ngOnInit();
      return component;
    };
    const lastOptions = (gmail: any) => gmail.fetchEmailPage.mock.calls.at(-1)[0];
    const ids = (component: DashboardComponent) => component.emails.map((e) => e.gmailMessageId);

    it('loads the first inbox page without a token', () => {
      const gmail = pagedGmail();
      const component = create(gmail);

      expect(gmail.fetchEmailPage).toHaveBeenCalledTimes(1);
      expect(lastOptions(gmail)).toEqual({ label: 'INBOX', limit: 20, unread: false, q: '', pageToken: null });
      expect(ids(component)).toEqual(['m1', 'm2']);
      expect(component.pageIndex).toBe(0);
      expect(component.hasPreviousPage).toBe(false);
      expect(component.hasNextPage).toBe(true);
    });

    it('Next uses the token Gmail returned, and Previous returns to the stored earlier token', () => {
      const gmail = pagedGmail();
      const component = create(gmail);

      component.nextPage();
      expect(lastOptions(gmail).pageToken).toBe('tok-2');
      expect(ids(component)).toEqual(['m3', 'm4']);
      expect(component.pageIndex).toBe(1);

      component.nextPage();
      expect(lastOptions(gmail).pageToken).toBe('tok-3');
      expect(ids(component)).toEqual(['m5']);
      expect(component.hasNextPage).toBe(false);

      // Last page: Next is a no-op.
      const callsBefore = gmail.fetchEmailPage.mock.calls.length;
      component.nextPage();
      expect(gmail.fetchEmailPage.mock.calls.length).toBe(callsBefore);

      component.previousPage();
      expect(lastOptions(gmail).pageToken).toBe('tok-2');
      expect(component.pageIndex).toBe(1);
      component.previousPage();
      expect(lastOptions(gmail).pageToken).toBeNull();
      expect(component.pageIndex).toBe(0);
      expect(component.hasPreviousPage).toBe(false);

      // First page: Previous is a no-op; the stored token for page 2 is still there.
      component.previousPage();
      expect(component.pageIndex).toBe(0);
      component.nextPage();
      expect(lastOptions(gmail).pageToken).toBe('tok-2');
    });

    it('Refresh reloads the current page with the same token', () => {
      const gmail = pagedGmail();
      const component = create(gmail);
      component.nextPage();

      component.fetchEmails();

      expect(lastOptions(gmail).pageToken).toBe('tok-2');
      expect(component.pageIndex).toBe(1);
    });

    it('Search sends the trimmed Gmail query and resets the token stack', () => {
      const gmail = pagedGmail();
      const component = create(gmail);
      component.nextPage();
      component.nextPage();
      expect(component.pageIndex).toBe(2);

      component.searchQuery = '  from:alice subject:"Q&A report"  ';
      component.search();

      expect(lastOptions(gmail)).toMatchObject({ q: 'from:alice subject:"Q&A report"', pageToken: null });
      expect(component.activeQuery).toBe('from:alice subject:"Q&A report"');
      expect(component.pageIndex).toBe(0);
      expect(component.hasPreviousPage).toBe(false);
    });

    it('Clear empties the search and returns to the unfiltered first page', () => {
      const gmail = pagedGmail();
      const component = create(gmail);
      component.searchQuery = 'from:bob';
      component.search();
      component.nextPage();

      component.clearSearch();

      expect(component.searchQuery).toBe('');
      expect(component.activeQuery).toBe('');
      expect(lastOptions(gmail)).toMatchObject({ q: '', pageToken: null });
      expect(component.pageIndex).toBe(0);
    });

    it('changing the Unread only filter resets to the first page and keeps the search', () => {
      const gmail = pagedGmail();
      const component = create(gmail);
      component.searchQuery = 'invoice';
      component.search();
      component.nextPage();

      component.toggleUnreadOnly();

      expect(component.unreadOnly).toBe(true);
      expect(lastOptions(gmail)).toMatchObject({ unread: true, q: 'invoice', pageToken: null });
      expect(component.pageIndex).toBe(0);

      component.toggleUnreadOnly();
      expect(lastOptions(gmail)).toMatchObject({ unread: false, pageToken: null });
    });

    it('shows a loading state and ignores Next/Previous while a page is loading', () => {
      const pending = new Subject<any>();
      const gmail = { fetchEmailPage: vi.fn().mockReturnValueOnce(of(page(['m1'], 'tok-2'))).mockReturnValue(pending) };
      const component = create(gmail);

      component.nextPage();
      expect(component.isLoadingEmails).toBe(true);
      expect(component.showEmptyState).toBe(false);
      component.nextPage();
      component.previousPage();
      expect(gmail.fetchEmailPage).toHaveBeenCalledTimes(2);

      pending.next(page(['m2'], null));
      expect(component.isLoadingEmails).toBe(false);
      expect(component.pageIndex).toBe(1);
    });

    it('drops a slow response that a newer request has superseded', () => {
      const slow = new Subject<any>();
      const gmail = { fetchEmailPage: vi.fn().mockReturnValueOnce(slow).mockReturnValue(of(page(['fresh'], null))) };
      const component = create(gmail);

      component.searchQuery = 'from:alice';
      component.search();
      slow.next(page(['stale'], 'stale-token'));

      expect(ids(component)).toEqual(['fresh']);
      expect(component.hasNextPage).toBe(false);
    });

    it('shows a search-specific empty state, and the plain one without a search', () => {
      const gmail = { fetchEmailPage: vi.fn().mockReturnValue(of(page([], null))) };
      const component = create(gmail);
      expect(component.showEmptyState).toBe(true);
      expect(component.emptyStateMessage).toBe('No emails found');
      expect(component.hasNextPage).toBe(false);

      component.searchQuery = 'from:nobody';
      component.search();
      expect(component.showEmptyState).toBe(true);
      expect(component.emptyStateMessage).toBe('No emails match "from:nobody"');
    });

    it('shows an error (not the empty state) and keeps the page position when a page fails', () => {
      const gmail = {
        fetchEmailPage: vi.fn()
          .mockReturnValueOnce(of(page(['m1'], 'tok-2')))
          .mockReturnValueOnce(throwError(() => ({ status: 400, error: { error: 'Invalid Gmail search query or page token' } })))
          .mockReturnValue(of(page(['m2'], null))),
      };
      const component = create(gmail);

      component.nextPage();
      expect(component.emailsError).toBe('Invalid Gmail search query or page token');
      expect(component.isLoadingEmails).toBe(false);
      expect(component.showEmptyState).toBe(false);
      expect(component.pageIndex).toBe(0);
      expect(component.hasNextPage).toBe(true);

      // Retrying Next reuses the same stored token.
      component.nextPage();
      expect(lastOptions(gmail).pageToken).toBe('tok-2');
      expect(component.emailsError).toBeNull();
      expect(component.pageIndex).toBe(1);
    });
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
    expect(draft.sendDraft).toHaveBeenCalledWith('draft-1', expect.any(String));

    component.draft = { ...(component.draft as any), status: 'PENDING' };
    component.rejectDraft();
    expect(draft.rejectDraft).toHaveBeenCalledWith('draft-1');
    // Restore before the test ends so fake timers do not stall the next test's hooks.
    vi.useRealTimers();
  });

  it('DraftDetailComponent reuses one idempotency key across send retries until success', () => {
    const draft = {
      getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Body', status: 'APPROVED' })),
      sendDraft: vi.fn()
        .mockReturnValueOnce(throwError(() => ({ error: { error: 'Gmail unavailable' } })))
        .mockReturnValueOnce(throwError(() => ({ error: { error: 'A send for this draft is already in progress' } })))
        .mockReturnValue(of({ _id: 'draft-1', status: 'SENT', sentGmailMessageId: 'sent-1' })),
    };
    const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft as any, {} as any);
    component.ngOnInit();

    component.sendDraft();
    expect(component.error).toContain('Gmail unavailable');
    expect(component.isSending).toBe(false);
    component.sendDraft();
    component.sendDraft();
    expect(component.draft?.status).toBe('SENT');

    const keys = draft.sendDraft.mock.calls.map((call: any[]) => call[1]);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toEqual(expect.any(String));

    // A brand-new send attempt after success gets a fresh key.
    component.draft = { ...(component.draft as any), status: 'APPROVED' };
    component.sendDraft();
    expect(draft.sendDraft.mock.calls[3][1]).not.toBe(keys[0]);
  });

  it('DraftDetailComponent does not send when the user cancels confirmation', () => {
    (globalThis as any).confirm = vi.fn().mockReturnValue(false);
    const draft = {
      getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Body', status: 'APPROVED' })),
      sendDraft: vi.fn(),
    };
    const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft as any, {} as any);
    component.ngOnInit();

    component.sendDraft();

    expect(draft.sendDraft).not.toHaveBeenCalled();
  });
});
