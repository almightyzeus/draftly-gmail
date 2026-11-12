import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { FormBuilder } from '@angular/forms';
import { LoginComponent } from '../src/app/pages/login.component';
import { RegisterComponent } from '../src/app/pages/register.component';
import { DEFAULT_PLACEHOLDER_ROWS, DashboardComponent } from '../src/app/pages/dashboard.component';
import { EmailDetailComponent } from '../src/app/pages/email-detail.component';
import { DraftDetailComponent } from '../src/app/pages/draft-detail.component';

const snackBar = { open: vi.fn() };
const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
/** ConfirmService double: answers every confirmation with `answer`. */
const confirmWith = (answer: boolean) => ({ confirm: vi.fn(() => of(answer)) });
let confirmYes = confirmWith(true);
/** ActivatedRoute double for the dashboard (?tab=...). */
const dashRoute = (tab?: string, extra: Record<string, string> = {}) => queryRoute({ ...(tab ? { tab } : {}), ...extra });
/** ActivatedRoute double with the given query parameters. */
function queryRoute(params: Record<string, string> = {}) {
  return { snapshot: { queryParamMap: { get: (key: string) => params[key] ?? null } } };
}
const draftsApi = { getDrafts: vi.fn(() => of([])) };
/** AuthService double for DraftDetail (Gmail access lost -> shared state). */
const draftAuth = { setGoogleConnected: vi.fn() };
/** PreferenceService double for EmailDetail. */
const prefsWith = (defaultTone = 'formal') => ({ getPreferences: vi.fn(() => of({ defaultTone, signature: '', learningEmailCount: 5 })) });

describe('frontend page classes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    confirmYes = confirmWith(true);
  });

  it('LoginComponent validates and submits login', () => {
    const auth = { login: vi.fn().mockReturnValue(of({})) };
    const component = new LoginComponent(new FormBuilder(), auth as any, router as any, snackBar as any, queryRoute() as any);

    component.onSubmit();
    expect(auth.login).not.toHaveBeenCalled();

    component.loginForm.setValue({ email: 'user@example.com', password: 'password' });
    component.onSubmit();
    expect(auth.login).toHaveBeenCalledWith('user@example.com', 'password');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it.each([
    ['an in-app returnUrl', '/draft/abc?x=1', '/draft/abc?x=1'],
    ['the OAuth error redirect', '/dashboard?gmailError=access_denied', '/dashboard?gmailError=access_denied'],
    ['an absolute URL', 'https://evil.example.com', '/dashboard'],
    ['a protocol-relative URL', '//evil.example.com', '/dashboard'],
    ['a backslash host', '/\\evil.example.com', '/dashboard'],
  ])('LoginComponent returns to %s after login', (_label, returnUrl, expected) => {
    const auth = { login: vi.fn().mockReturnValue(of({})) };
    const component = new LoginComponent(new FormBuilder(), auth as any, router as any, snackBar as any, queryRoute({ returnUrl }) as any);
    component.loginForm.setValue({ email: 'user@example.com', password: 'password' });

    component.onSubmit();

    expect(router.navigateByUrl).toHaveBeenCalledWith(expected);
  });

  it('LoginComponent handles login errors', () => {
    const auth = { login: vi.fn().mockReturnValue(throwError(() => ({ error: { error: 'Bad login' } }))) };
    const component = new LoginComponent(new FormBuilder(), auth as any, router as any, snackBar as any, queryRoute() as any);
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

  it.each([
    ['7 characters', 'short12', 'minlength'],
    ['over 72 bytes', 'é'.repeat(37), 'maxbytes'],
  ])('RegisterComponent rejects a password of %s, like the API', (_label, password, error) => {
    const auth = { register: vi.fn().mockReturnValue(of({})) };
    const component = new RegisterComponent(new FormBuilder(), auth as any, router as any, snackBar as any);
    component.registerForm.setValue({ name: 'User', email: 'user@example.com', password, confirmPassword: password });

    expect(component.registerForm.get('password')?.hasError(error)).toBe(true);
    component.onSubmit();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('RegisterComponent accepts exactly 72 bytes', () => {
    const component = new RegisterComponent(new FormBuilder(), {} as any, router as any, snackBar as any);
    component.registerForm.patchValue({ password: 'é'.repeat(36) });
    expect(component.registerForm.get('password')?.valid).toBe(true);
  });

  it('DashboardComponent fetches the inbox, marks unread mail, and opens an email', () => {
    const user$ = new BehaviorSubject<any>({ id: '1', name: 'User', email: 'user@example.com', googleConnected: true });
    const auth = { currentUser$: user$.asObservable() };
    const gmail = {
      fetchEmailPage: vi.fn().mockReturnValue(
        of({ emails: [{ gmailMessageId: 'msg-1', snippet: 'hello world', labels: ['INBOX', 'UNREAD'] }], nextPageToken: null })
      ),
    };
    const component = new DashboardComponent(auth as any, gmail as any, draftsApi as any, router as any, dashRoute() as any);

    component.ngOnInit();
    expect(gmail.fetchEmailPage).toHaveBeenCalled();
    expect(component.emails).toHaveLength(1);
    expect(component.isUnread(component.emails[0] as any)).toBe(true);
    expect(component.senderName('Alice Example <alice@example.com>')).toBe('Alice Example');

    component.openEmailDetail(component.emails[0] as any);
    expect(router.navigate).toHaveBeenCalledWith(['/email', 'msg-1']);
  });

  it('DashboardComponent reports fetch errors and blocks fetch without Gmail', () => {
    const auth = {
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      isAuthenticated: vi.fn().mockReturnValue(false),
    };
    const gmail = { fetchEmailPage: vi.fn().mockReturnValue(throwError(() => ({ status: 401 }))) };
    const component = new DashboardComponent(auth as any, gmail as any, draftsApi as any, router as any, dashRoute() as any);

    component.currentUser = null;
    component.fetchEmails();
    expect(component.emailsError).toContain('Gmail account not connected');

    component.currentUser = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    component.fetchEmails();
    expect(component.emailsError).toContain('Authentication failed');
  });

  it('DashboardComponent loads the inbox once at startup, however often the user stream emits', () => {
    const user$ = new BehaviorSubject<any>(null);
    const auth = { currentUser$: user$.asObservable(), getMe: vi.fn() };
    const gmail = { fetchEmailPage: vi.fn().mockReturnValue(of({ emails: [], nextPageToken: null })) };
    const component = new DashboardComponent(auth as any, gmail as any, draftsApi as any, router as any, dashRoute() as any);

    component.ngOnInit();
    expect(gmail.fetchEmailPage).not.toHaveBeenCalled();

    const user = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    user$.next(user);
    user$.next({ ...user });
    expect(gmail.fetchEmailPage).toHaveBeenCalledTimes(1);
    expect(auth.getMe).not.toHaveBeenCalled();
  });

  it('DashboardComponent stops listening to the user stream when destroyed', () => {
    const user$ = new BehaviorSubject<any>({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false });
    const component = new DashboardComponent({ currentUser$: user$.asObservable() } as any, {} as any, draftsApi as any, router as any, dashRoute() as any);
    component.ngOnInit();
    expect(user$.observed).toBe(true);

    component.ngOnDestroy();

    expect(user$.observed).toBe(false);
  });

  it('DashboardComponent starts the Gmail connection and reports a failure', () => {
    const auth = {
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      isAuthenticated: vi.fn().mockReturnValue(false),
      connectGmail: vi.fn().mockReturnValueOnce(of(undefined)).mockReturnValueOnce(throwError(() => new Error('network'))),
    };
    const component = new DashboardComponent(auth as any, {} as any, draftsApi as any, router as any, dashRoute() as any);
    component.ngOnInit();

    component.connectGmail();
    expect(auth.connectGmail).toHaveBeenCalledTimes(1);
    expect(component.emailsError).toBeNull();

    component.connectGmail();
    expect(component.emailsError).toBe('Could not start the Gmail connection. Please try again.');
  });

  describe('DashboardComponent Gmail connection errors from the OAuth callback (?gmailError=)', () => {
    const disconnectedAuth = () => ({
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      connectGmail: vi.fn().mockReturnValue(of(undefined)),
    });

    it('shows the message once and removes the code from the URL', () => {
      const route = dashRoute(undefined, { gmailError: 'access_denied' });
      const component = new DashboardComponent(disconnectedAuth() as any, {} as any, draftsApi as any, router as any, route as any);

      component.ngOnInit();

      expect(component.gmailConnectError).toBe('Gmail was not connected because access was not granted on the Google screen.');
      expect(router.navigate).toHaveBeenCalledWith([], {
        relativeTo: route,
        queryParams: { gmailError: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });

      component.dismissGmailConnectError();
      expect(component.gmailConnectError).toBeNull();
    });

    it('shows a generic message for an unknown code (URL text is never displayed)', () => {
      const component = new DashboardComponent(disconnectedAuth() as any, {} as any, draftsApi as any, router as any, dashRoute(undefined, { gmailError: '<b>hi</b>' }) as any);
      component.ngOnInit();
      expect(component.gmailConnectError).toBe('Gmail could not be connected. Please try again.');
    });

    it('does nothing without a code, and clears the message on a new connection attempt', () => {
      const component = new DashboardComponent(disconnectedAuth() as any, {} as any, draftsApi as any, router as any, dashRoute() as any);
      component.ngOnInit();
      expect(component.gmailConnectError).toBeNull();
      expect(router.navigate).not.toHaveBeenCalled();

      component.gmailConnectError = 'previous failure';
      component.connectGmail();
      expect(component.gmailConnectError).toBeNull();
    });
  });

  it('DashboardComponent switches to Connect Gmail when the Gmail grant has expired (403)', () => {
    const auth = {
      currentUser$: of({ id: '1', name: 'User', email: 'user@example.com', googleConnected: false }),
      setGoogleConnected: vi.fn(),
    };
    const message = 'Gmail access has expired or was revoked. Please reconnect Gmail.';
    const gmail = { fetchEmailPage: vi.fn().mockReturnValue(throwError(() => ({ status: 403, error: { error: message } }))) };
    const component = new DashboardComponent(auth as any, gmail as any, draftsApi as any, router as any, dashRoute() as any);
    component.currentUser = { id: '1', name: 'User', email: 'user@example.com', googleConnected: true };
    component.emails = [{ gmailMessageId: 'stale' } as any];

    component.fetchEmails();

    expect(component.emailsError).toBe(message);
    expect(component.currentUser?.googleConnected).toBe(false);
    // Shared state, so the top bar also switches to "Connect Gmail".
    expect(auth.setGoogleConnected).toHaveBeenCalledWith(false);
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
      const component = new DashboardComponent(auth as any, gmail as any, draftsApi as any, router as any, dashRoute() as any);
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

    it('shows placeholder rows while a page loads: the default number first, then as many as the list had', () => {
      const first = new Subject<any>();
      const refresh = new Subject<any>();
      const gmail = { fetchEmailPage: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(refresh) };
      const component = create(gmail);
      const allPlaceholders = () => component.emailRows.every((row, i) => component.isPlaceholder(i, row));

      expect(component.emailRows).toHaveLength(DEFAULT_PLACEHOLDER_ROWS);
      expect(allPlaceholders()).toBe(true);

      first.next(page(['m1', 'm2', 'm3'], null));
      expect(component.emailRows).toBe(component.emails);
      expect(component.isPlaceholder(0, component.emailRows[0])).toBe(false);

      component.fetchEmails();
      expect(component.emailRows).toHaveLength(3);
      expect(allPlaceholders()).toBe(true);
      // The same array on every read, so the table does not re-render each change detection.
      expect(component.emailRows).toBe(component.emailRows);
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

  it('EmailDetailComponent loads email, generates drafts, and navigates back', () => {
    const route = { params: of({ gmailMessageId: 'msg-1' }) };
    const gmail = { getEmailDetail: vi.fn().mockReturnValue(of({ gmailMessageId: 'msg-1', threadId: 'thread-1', bodyPlain: 'Hi' })) };
    const draft = { generateThreadDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1' })) };
    const sanitizer = { sanitize: vi.fn() };
    const component = new EmailDetailComponent(route as any, router as any, gmail as any, draft as any, sanitizer as any, prefsWith() as any);

    component.ngOnInit();
    expect(component.email?.gmailMessageId).toBe('msg-1');
    // Plain-text email: rendered via interpolation, no HTML sanitizing or trust bypass.
    expect(component.safeBodyHtml).toBeNull();
    expect(sanitizer.sanitize).not.toHaveBeenCalled();

    component.customContext = 'context';
    component.generateDraft();
    expect(draft.generateThreadDraft).toHaveBeenCalledWith('thread-1', 'formal', 'context');
    expect(router.navigate).toHaveBeenCalledWith(['/draft', 'draft-1']);

    component.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('EmailDetailComponent sanitizes an HTML body once, when the email loads', () => {
    const gmail = {
      getEmailDetail: vi.fn().mockReturnValue(of({ gmailMessageId: 'msg-1', threadId: 't', bodyHtml: '<p onclick="x()">Hi</p><script>bad()</script>' })),
    };
    const sanitizer = { sanitize: vi.fn().mockReturnValue('<p>Hi</p>') };
    const component = new EmailDetailComponent({ params: of({ gmailMessageId: 'msg-1' }) } as any, router as any, gmail as any, {} as any, sanitizer as any, prefsWith() as any);

    component.ngOnInit();

    expect(sanitizer.sanitize).toHaveBeenCalledTimes(1);
    expect(sanitizer.sanitize).toHaveBeenCalledWith(1 /* SecurityContext.HTML */, '<p onclick="x()">Hi</p><script>bad()</script>');
    expect(component.safeBodyHtml).toBe('<p>Hi</p>');
  });

  it('EmailDetailComponent shows the backend reason when generation fails and keeps the email visible', () => {
    const gmail = { getEmailDetail: vi.fn().mockReturnValue(of({ gmailMessageId: 'msg-1', threadId: 'thread-1', bodyPlain: 'Hi' })) };
    const reason = 'This thread has no message from someone else to reply to.';
    const draft = { generateThreadDraft: vi.fn().mockReturnValue(throwError(() => ({ status: 422, error: { error: reason } }))) };
    const component = new EmailDetailComponent({ params: of({ gmailMessageId: 'msg-1' }) } as any, router as any, gmail as any, draft as any, { sanitize: vi.fn() } as any, prefsWith() as any);
    component.ngOnInit();

    component.generateDraft();

    expect(component.actionError).toBe(reason);
    expect(component.error).toBeNull();
    expect(component.email?.gmailMessageId).toBe('msg-1');
    expect(component.isGenerating).toBe(false);
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
    const component = new DraftDetailComponent(route as any, router as any, draft as any, confirmYes as any, snackBar as any, draftAuth as any);

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
    const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft as any, confirmYes as any, snackBar as any, draftAuth as any);
    component.ngOnInit();

    component.sendDraft();
    expect(component.actionError).toContain('Gmail unavailable');
    expect(component.error).toBeNull();
    expect(component.isSending()).toBe(false);
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

  it('DraftDetailComponent derives one busy state from all in-flight actions', () => {
    const pending = new Subject<any>();
    const draft = {
      getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Body', status: 'PENDING' })),
      approveDraft: vi.fn().mockReturnValue(pending),
    };
    const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft as any, confirmYes as any, snackBar as any, draftAuth as any);
    component.ngOnInit();
    expect(component.isBusy()).toBe(false);

    component.approveDraft();
    expect(component.isApproving()).toBe(true);
    expect(component.isBusy()).toBe(true);

    pending.next({ _id: 'draft-1', draftBody: 'Body', status: 'APPROVED' });
    pending.complete();
    expect(component.isBusy()).toBe(false);
  });

  it('DraftDetailComponent names the running action for the page overlay', () => {
    const component = new DraftDetailComponent({ params: of({}) } as any, router as any, {} as any, confirmYes as any, snackBar as any, draftAuth as any);
    expect(component.busyMessage()).toBe('');

    const cases: [keyof DraftDetailComponent, string][] = [
      ['isSaving', 'Saving changes…'],
      ['isApproving', 'Approving and saving to Gmail…'],
      ['isRejecting', 'Rejecting draft…'],
      ['isSending', 'Sending reply…'],
      ['isUpdatingRecipients', 'Updating recipients…'],
    ];
    for (const [flag, message] of cases) {
      (component[flag] as any).set(true);
      expect(component.busyMessage()).toBe(message);
      expect(component.isBusy()).toBe(true);
      (component[flag] as any).set(false);
    }
    expect(component.busyMessage()).toBe('');
  });

  describe('DraftDetailComponent saves unsaved edits before approve/send', () => {
    const setup = (status: string, overrides: Record<string, any> = {}) => {
      const draft: any = {
        getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Original', status })),
        updateDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Edited', status })),
        approveDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Edited', status: 'APPROVED' })),
        sendDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1', status: 'SENT', sentGmailMessageId: 'sent-1' })),
        ...overrides,
      };
      const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft, confirmYes as any, snackBar as any, draftAuth as any);
      component.ngOnInit();
      component.editedContent = 'Edited';
      component.onContentChange();
      return { component, draft };
    };

    it('approves only after the edit has been saved', () => {
      const pendingSave = new Subject<any>();
      const { component, draft } = setup('PENDING', { updateDraft: vi.fn().mockReturnValue(pendingSave) });

      component.approveDraft();
      expect(draft.updateDraft).toHaveBeenCalledWith('draft-1', 'Edited');
      expect(draft.approveDraft).not.toHaveBeenCalled();

      pendingSave.next({ _id: 'draft-1', draftBody: 'Edited', status: 'PENDING' });
      pendingSave.complete();
      expect(draft.approveDraft).toHaveBeenCalledWith('draft-1');
      expect(component.draft?.status).toBe('APPROVED');
      expect(component.hasChanges).toBe(false);
    });

    it('does not approve when saving the edit fails, and keeps the editor and text', () => {
      const { component, draft } = setup('PENDING', {
        updateDraft: vi.fn().mockReturnValue(throwError(() => ({ status: 409, error: { error: 'The draft changed while saving' } }))),
      });

      component.approveDraft();

      expect(draft.approveDraft).not.toHaveBeenCalled();
      expect(component.actionError).toBe('The draft changed while saving');
      expect(component.error).toBeNull();
      expect(component.editedContent).toBe('Edited');
      expect(component.hasChanges).toBe(true);
      expect(component.isApproving()).toBe(false);
    });

    it('approves directly when there are no unsaved edits', () => {
      const { component, draft } = setup('PENDING');
      component.editedContent = 'Original';
      component.onContentChange();

      component.approveDraft();

      expect(draft.updateDraft).not.toHaveBeenCalled();
      expect(draft.approveDraft).toHaveBeenCalledWith('draft-1');
    });

    it('sends only after the edit has been saved to the Gmail draft', () => {
      const { component, draft } = setup('APPROVED');

      component.sendDraft();

      expect(draft.updateDraft).toHaveBeenCalledWith('draft-1', 'Edited');
      expect(draft.sendDraft).toHaveBeenCalledWith('draft-1', expect.any(String));
      expect(draft.updateDraft.mock.invocationCallOrder[0]).toBeLessThan(draft.sendDraft.mock.invocationCallOrder[0]);
      expect(component.draft?.status).toBe('SENT');
    });

    it('does not send when the Gmail draft could not be updated (502)', () => {
      const message = 'Could not update the Gmail draft, so your edit was not saved. Please try again.';
      const { component, draft } = setup('APPROVED', {
        updateDraft: vi.fn().mockReturnValue(throwError(() => ({ status: 502, error: { error: message } }))),
      });

      component.sendDraft();

      expect(draft.sendDraft).not.toHaveBeenCalled();
      expect(component.actionError).toContain(message);
      expect(component.error).toBeNull();
      expect(component.hasChanges).toBe(true);
    });
  });

  it('DraftDetailComponent does not send when the user cancels confirmation', () => {
    confirmYes = confirmWith(false);
    const draft = {
      getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Body', status: 'APPROVED' })),
      sendDraft: vi.fn(),
    };
    const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft as any, confirmYes as any, snackBar as any, draftAuth as any);
    component.ngOnInit();

    component.sendDraft();

    expect(draft.sendDraft).not.toHaveBeenCalled();
  });

  describe('EmailDetailComponent default tone (user preference)', () => {
    const create = (prefs: any) => {
      const gmail = { getEmailDetail: vi.fn().mockReturnValue(of({ gmailMessageId: 'msg-1', threadId: 'thread-1', bodyPlain: 'Hi' })) };
      const draft = { generateThreadDraft: vi.fn().mockReturnValue(of({ _id: 'draft-1' })) };
      const component = new EmailDetailComponent(
        { params: of({ gmailMessageId: 'msg-1' }) } as any, router as any, gmail as any, draft as any, { sanitize: vi.fn() } as any, prefs as any
      );
      return { component, draft };
    };

    it("preselects the user's default tone and generates with it", () => {
      const { component, draft } = create(prefsWith('friendly'));
      component.ngOnInit();

      expect(component.selectedTone).toBe('friendly');
      component.generateDraft();
      expect(draft.generateThreadDraft).toHaveBeenCalledWith('thread-1', 'friendly', undefined);
    });

    it('never overrides a tone the user already picked (late preference response)', () => {
      const late = new Subject<any>();
      const { component } = create({ getPreferences: vi.fn(() => late) });
      component.ngOnInit();

      component.selectedTone = 'concise';
      component.onToneChange();
      late.next({ defaultTone: 'friendly' });

      expect(component.selectedTone).toBe('concise');
    });

    it('keeps formal when preferences fail to load or hold an unknown tone', () => {
      const failing = create({ getPreferences: vi.fn(() => throwError(() => ({ status: 500 }))) }).component;
      failing.ngOnInit();
      expect(failing.selectedTone).toBe('formal');
      expect(failing.error).toBeNull();

      const unknown = create(prefsWith('shouting' as any)).component;
      unknown.ngOnInit();
      expect(unknown.selectedTone).toBe('formal');
    });
  });

  describe('DraftDetailComponent when Gmail access has expired (403)', () => {
    const expired = () => throwError(() => ({ status: 403, error: { error: 'Gmail access has expired or was revoked. Please reconnect Gmail.' } }));
    const setup = (status: string, api: Record<string, any>) => {
      const auth = { setGoogleConnected: vi.fn() };
      const draft = { getDraftDetail: vi.fn().mockReturnValue(of({ _id: 'draft-1', draftBody: 'Body', status })), ...api };
      const component = new DraftDetailComponent({ params: of({ id: 'draft-1' }) } as any, router as any, draft as any, confirmYes as any, snackBar as any, auth as any);
      component.ngOnInit();
      return { component, auth };
    };

    it.each([
      ['approve', 'PENDING', { approveDraft: vi.fn(expired) }, (c: DraftDetailComponent) => c.approveDraft()],
      ['send', 'APPROVED', { sendDraft: vi.fn(expired) }, (c: DraftDetailComponent) => c.sendDraft()],
      ['reject', 'APPROVED', { rejectDraft: vi.fn(expired) }, (c: DraftDetailComponent) => c.rejectDraft()],
      ['save', 'APPROVED', { updateDraft: vi.fn(expired) }, (c: DraftDetailComponent) => { c.editedContent = 'Edited'; c.onContentChange(); c.saveDraft(); }],
    ])('%s marks Gmail disconnected in shared state and shows the reconnect message', (_label, status, api, act) => {
      const { component, auth } = setup(status, api);

      act(component);

      expect(auth.setGoogleConnected).toHaveBeenCalledWith(false);
      expect(component.actionError).toContain('Gmail access has expired or was revoked. Please reconnect Gmail.');
    });

    it('other failures leave the Gmail connection state alone', () => {
      const { component, auth } = setup('PENDING', { approveDraft: vi.fn(() => throwError(() => ({ status: 502, error: { error: 'Upstream failed' } }))) });

      component.approveDraft();

      expect(auth.setGoogleConnected).not.toHaveBeenCalled();
      expect(component.actionError).toBe('Upstream failed');
    });
  });
});
