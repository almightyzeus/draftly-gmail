import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { TopBarComponent } from '../src/app/shared/top-bar.component';
import { ConfirmService } from '../src/app/shared/confirm.service';
import { formatListDate, senderName } from '../src/app/shared/format';
import { AuthService } from '../src/app/services/auth.service';
import { DashboardComponent } from '../src/app/pages/dashboard.component';
import { DraftDetailComponent } from '../src/app/pages/draft-detail.component';

const user = { id: 'u1', name: 'User', email: 'user@example.com', googleConnected: true, gmailEmail: 'user@gmail.com' };

describe('TopBarComponent (Gmail status + account menu)', () => {
  let auth: any;
  let gmail: any;
  let confirm: any;
  let snackBar: any;
  let router: any;
  const create = () => new TopBarComponent(auth, gmail, confirm, snackBar, router);

  beforeEach(() => {
    auth = {
      currentUser$: of(user),
      connectGmail: vi.fn(() => of(undefined)),
      setGoogleConnected: vi.fn(),
      logout: vi.fn(),
    };
    gmail = { revokeGmail: vi.fn(() => of({ message: 'ok' })) };
    confirm = { confirm: vi.fn(() => of(true)) };
    snackBar = { open: vi.fn() };
    router = { navigate: vi.fn() };
  });

  it('exposes the shared user stream', () => {
    let seen: any;
    create().user$.subscribe((u) => (seen = u));
    expect(seen).toEqual(user);
  });

  it('starts the Gmail connection, reporting a failure in a snackbar', () => {
    create().connectGmail();
    expect(auth.connectGmail).toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();

    auth.connectGmail = vi.fn(() => throwError(() => new Error('network')));
    create().connectGmail();
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Could not start'), 'Close', expect.any(Object));
  });

  it('disconnects Gmail only after confirmation, then updates the shared state', () => {
    create().disconnectGmail();

    expect(confirm.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warn', confirmText: 'Disconnect' }));
    expect(gmail.revokeGmail).toHaveBeenCalled();
    expect(auth.setGoogleConnected).toHaveBeenCalledWith(false);
    expect(snackBar.open).toHaveBeenCalledWith('Gmail disconnected.', 'Close', expect.any(Object));
  });

  it('does nothing when the disconnect is cancelled', () => {
    confirm.confirm = vi.fn(() => of(false));
    create().disconnectGmail();
    expect(gmail.revokeGmail).not.toHaveBeenCalled();
    expect(auth.setGoogleConnected).not.toHaveBeenCalled();
  });

  it('keeps the connected state when revoking fails', () => {
    gmail.revokeGmail = vi.fn(() => throwError(() => ({ status: 500 })));
    create().disconnectGmail();
    expect(auth.setGoogleConnected).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Could not disconnect'), 'Close', expect.any(Object));
  });

  it('logs out and returns to the login page', () => {
    create().logout();
    expect(auth.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});

describe('ConfirmService', () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])('maps a dialog result of %s to %s', (result, expected) => {
    const dialog = { open: vi.fn(() => ({ afterClosed: () => of(result) })) };
    let answer: boolean | undefined;

    new ConfirmService(dialog as any)
      .confirm({ title: 'T', message: 'M', confirmText: 'OK' })
      .subscribe((value) => (answer = value));

    expect(answer).toBe(expected);
    expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ data: expect.objectContaining({ title: 'T' }) }));
  });
});

describe('AuthService.setGoogleConnected', () => {
  it('updates the shared user and clears the Gmail address on disconnect', () => {
    const service = new AuthService({ get: vi.fn(), post: vi.fn().mockReturnValue(of({ user, accessToken: 'a', refreshToken: 'r' })) } as any);
    service.login('user@example.com', 'pw').subscribe();
    const seen: any[] = [];
    service.currentUser$.subscribe((u) => seen.push(u));

    service.setGoogleConnected(false);
    service.setGoogleConnected(false); // no duplicate emission

    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ googleConnected: false, gmailEmail: null });
  });

  it('is a no-op when no user is loaded', () => {
    const service = new AuthService({ get: vi.fn(), post: vi.fn() } as any);
    const seen: any[] = [];
    service.currentUser$.subscribe((u) => seen.push(u));
    service.setGoogleConnected(false);
    expect(seen).toEqual([null]);
  });
});

describe('format helpers', () => {
  it.each([
    ['Alice Example <alice@example.com>', 'Alice Example'],
    ['"Doe, John" <john@example.com>', 'Doe, John'],
    ['bob@example.com', 'bob@example.com'],
    ['<carol@example.com>', 'carol@example.com'],
    ['', ''],
  ])('senderName(%j) = %j', (input, expected) => {
    expect(senderName(input)).toBe(expected);
  });

  it('formats list dates relative to today', () => {
    const now = new Date(2026, 9, 4, 15, 0);
    expect(formatListDate(new Date(2026, 9, 4, 9, 5), now)).toBe('9:05 AM');
    expect(formatListDate(new Date(2026, 2, 7), now)).toBe('Mar 7');
    expect(formatListDate(new Date(2024, 2, 7), now)).toBe('Mar 7, 2024');
    expect(formatListDate('not a date', now)).toBe('');
    expect(formatListDate(null, now)).toBe('');
  });
});

describe('DashboardComponent drafts tab', () => {
  const route = (tab?: string) => ({ snapshot: { queryParamMap: { get: (k: string) => (k === 'tab' ? tab ?? null : null) } } });
  const draftsList = [{ _id: 'd1', status: 'PENDING', replyTo: { from: 'Alice <a@x.com>', subject: 'Budget' } }];
  let router: any;
  let gmail: any;
  let draftsApi: any;

  beforeEach(() => {
    router = { navigate: vi.fn() };
    gmail = { fetchEmailPage: vi.fn(() => of({ emails: [], nextPageToken: null })) };
    draftsApi = { getDrafts: vi.fn(() => of(draftsList)) };
  });

  const create = (tab?: string, user$ = new BehaviorSubject<any>(user)) => {
    const component = new DashboardComponent({ currentUser$: user$ } as any, gmail, draftsApi, router, route(tab) as any);
    component.ngOnInit();
    return { component, user$ };
  };

  it('opens on the Drafts tab from ?tab=drafts and loads drafts', () => {
    const { component } = create('drafts');
    expect(component.selectedTab).toBe(1);
    expect(draftsApi.getDrafts).toHaveBeenCalledWith(undefined, 50);
    expect(component.drafts).toEqual(draftsList);
  });

  it('loads drafts lazily on first switch, and records the tab in the URL', () => {
    const { component } = create();
    expect(draftsApi.getDrafts).not.toHaveBeenCalled();

    component.onTabChange(1);
    component.onTabChange(0);
    component.onTabChange(1);

    expect(draftsApi.getDrafts).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'drafts' }, replaceUrl: true }));
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: null } }));
  });

  it('filters by status and explains empty results', () => {
    const { component } = create('drafts');
    draftsApi.getDrafts.mockReturnValue(of([]));

    component.setDraftsFilter('APPROVED');

    expect(draftsApi.getDrafts).toHaveBeenLastCalledWith('APPROVED', 50);
    expect(component.showDraftsEmptyState).toBe(true);
    expect(component.draftsEmptyMessage).toBe('No approved drafts.');
    component.setDraftsFilter('');
    expect(component.draftsEmptyMessage).toContain('No drafts yet');
  });

  it('shows the API error for drafts, not the empty state', () => {
    draftsApi.getDrafts.mockReturnValue(throwError(() => ({ status: 500, error: { error: 'Failed to process draft request' } })));
    const { component } = create('drafts');
    expect(component.draftsError).toBe('Failed to process draft request');
    expect(component.showDraftsEmptyState).toBe(false);
  });

  it('opens a draft', () => {
    const { component } = create('drafts');
    component.openDraft(draftsList[0] as any);
    expect(router.navigate).toHaveBeenCalledWith(['/draft', 'd1']);
  });

  it('clears the inbox when Gmail is disconnected elsewhere (e.g. the top bar)', () => {
    gmail.fetchEmailPage.mockReturnValue(of({ emails: [{ gmailMessageId: 'm1' }], nextPageToken: 'p2' }));
    const { component, user$ } = create();
    expect(component.emails).toHaveLength(1);

    user$.next({ ...user, googleConnected: false });

    expect(component.emails).toEqual([]);
    expect(component.hasNextPage).toBe(false);
  });
});

describe('DraftDetailComponent dialogs and navigation', () => {
  let router: any;
  let snackBar: any;
  let confirm: any;
  const approved = { _id: 'd1', draftBody: 'Body', status: 'APPROVED', replyTo: { from: 'Alice <alice@example.com>', subject: 'Budget' } };

  const create = (api: any) => {
    const component = new DraftDetailComponent({ params: of({ id: 'd1' }) } as any, router, api, confirm, snackBar);
    component.ngOnInit();
    return component;
  };

  beforeEach(() => {
    router = { navigate: vi.fn() };
    snackBar = { open: vi.fn() };
    confirm = { confirm: vi.fn(() => of(true)) };
  });

  it('names the recipient in the send confirmation, then returns to the drafts tab', () => {
    const api = {
      getDraftDetail: vi.fn(() => of(approved)),
      sendDraft: vi.fn(() => of({ ...approved, status: 'SENT' })),
    };
    const component = create(api);

    component.sendDraft();

    expect(confirm.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('alice@example.com') }));
    expect(api.sendDraft).toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith('Reply sent.', 'Close', expect.any(Object));
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { queryParams: { tab: 'drafts' } });
  });

  it('rejects only after confirmation; withdrawing an approved draft says so', () => {
    const api = { getDraftDetail: vi.fn(() => of(approved)), rejectDraft: vi.fn(() => of({ ...approved, status: 'REJECTED' })) };
    confirm.confirm = vi.fn(() => of(false));
    const component = create(api);

    component.rejectDraft();
    expect(confirm.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Withdraw this approved reply?', tone: 'warn' }));
    expect(api.rejectDraft).not.toHaveBeenCalled();

    confirm.confirm = vi.fn(() => of(true));
    component.rejectDraft();
    expect(api.rejectDraft).toHaveBeenCalledWith('d1');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { queryParams: { tab: 'drafts' } });
  });

  it('shows the busy state only once the rejection is confirmed and in flight', () => {
    const pending = new Subject<any>();
    const api = { getDraftDetail: vi.fn(() => of({ ...approved, status: 'PENDING' })), rejectDraft: vi.fn(() => pending) };
    const component = create(api);

    component.rejectDraft();
    expect(component.isRejecting()).toBe(true);
    pending.error({ error: { error: 'Cannot reject draft with status: SENT' } });
    expect(component.isRejecting()).toBe(false);
    expect(component.actionError).toBe('Cannot reject draft with status: SENT');
  });

  it('asks before discarding unsaved edits when going back', () => {
    const component = create({ getDraftDetail: vi.fn(() => of(approved)) });
    component.editedContent = 'Changed';
    component.onContentChange();

    confirm.confirm = vi.fn(() => of(false));
    component.goBack();
    expect(router.navigate).not.toHaveBeenCalled();

    confirm.confirm = vi.fn(() => of(true));
    component.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { queryParams: { tab: 'drafts' } });
  });

  it('goes straight back when there is nothing to lose, and knows which drafts are editable', () => {
    const component = create({ getDraftDetail: vi.fn(() => of({ ...approved, status: 'SENT' })) });
    expect(component.isEditable).toBe(false);
    component.goBack();
    expect(confirm.confirm).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { queryParams: { tab: 'drafts' } });
  });
});
