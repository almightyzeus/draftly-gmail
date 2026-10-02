import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse, HttpHeaders, HttpRequest } from '@angular/common/http';
import { AuthService } from '../src/app/services/auth.service';
import { GmailService } from '../src/app/services/gmail.service';
import { DraftService } from '../src/app/services/draft.service';
import { AuthInterceptor } from '../src/app/services/auth.interceptor';

const authResponse = {
  message: 'ok',
  user: { id: 'user-1', email: 'user@example.com', name: 'User', googleConnected: true },
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
};

describe('frontend services', () => {
  beforeEach(() => {
    localStorage.clear();
    (globalThis.window as any).location.href = '';
    (globalThis.document as any).cookie = '';
    vi.clearAllMocks();
  });

  it('AuthService registers, logs in, stores tokens, and logs out', () => {
    const http = {
      post: vi.fn().mockReturnValue(of(authResponse)),
      get: vi.fn(),
    };
    const service = new AuthService(http as any);

    service.register('User', 'user@example.com', 'password').subscribe((response) => {
      expect(response.user.email).toBe('user@example.com');
    });
    expect(http.post).toHaveBeenCalledWith('api/auth/register', {
      name: 'User',
      email: 'user@example.com',
      password: 'password',
    });
    expect(localStorage.getItem('accessToken')).toBe('access-token');

    service.login('user@example.com', 'password').subscribe();
    expect(http.post).toHaveBeenLastCalledWith('api/auth/login', {
      email: 'user@example.com',
      password: 'password',
    });
    expect(service.isAuthenticated()).toBe(true);

    service.logout();
    expect(service.getAccessToken()).toBeNull();
  });

  it('AuthService loads a stored token and validates current user', () => {
    localStorage.setItem('accessToken', 'stored-token');
    const http = {
      post: vi.fn(),
      get: vi.fn().mockReturnValue(of({ user: authResponse.user })),
    };
    const service = new AuthService(http as any);

    expect(service.getAccessToken()).toBe('stored-token');
    // No HTTP during construction: that would re-enter AuthInterceptor -> AuthService (NG0200).
    expect(http.get).not.toHaveBeenCalled();

    service.restoreSession();
    expect(http.get).toHaveBeenCalledWith('api/auth/me');
    expect(localStorage.getItem('accessToken')).toBe('stored-token');
  });

  it('AuthService.restoreSession clears an invalid session and skips when logged out', () => {
    const http = { post: vi.fn(), get: vi.fn().mockReturnValue(throwError(() => ({ status: 401 }))) };
    const loggedOut = new AuthService(http as any);
    loggedOut.restoreSession();
    expect(http.get).not.toHaveBeenCalled();

    localStorage.setItem('accessToken', 'stale-token');
    localStorage.setItem('refreshToken', 'stale-refresh');
    const service = new AuthService(http as any);
    service.restoreSession();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it.each([0, 429, 500, 503])('AuthService.restoreSession keeps the session on a transient %s error', (status) => {
    localStorage.setItem('accessToken', 'stored-token');
    localStorage.setItem('refreshToken', 'stored-refresh');
    const http = { post: vi.fn(), get: vi.fn().mockReturnValue(throwError(() => ({ status }))) };
    const service = new AuthService(http as any);

    service.restoreSession();

    expect(localStorage.getItem('accessToken')).toBe('stored-token');
    expect(localStorage.getItem('refreshToken')).toBe('stored-refresh');
    expect(service.isAuthenticated()).toBe(true);
  });

  it('AuthService refreshes and rotates stored tokens', () => {
    localStorage.setItem('refreshToken', 'stored-refresh-token');
    const http = {
      post: vi.fn().mockReturnValue(of({ accessToken: 'new-access', refreshToken: 'new-refresh' })),
      get: vi.fn(),
    };
    const service = new AuthService(http as any);

    service.refreshAccessToken().subscribe();

    expect(http.post).toHaveBeenCalledWith('api/auth/refresh', { refreshToken: 'stored-refresh-token' });
    expect(localStorage.getItem('accessToken')).toBe('new-access');
    expect(localStorage.getItem('refreshToken')).toBe('new-refresh');
  });

  it('AuthService fetches the Gmail consent URL over XHR, then navigates to it', () => {
    const consentUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=signed';
    const http = { post: vi.fn(), get: vi.fn().mockReturnValue(of({ url: consentUrl })) };
    const service = new AuthService(http as any);

    let completed = false;
    service.connectGmail().subscribe({ complete: () => (completed = true) });

    expect(http.get).toHaveBeenCalledWith('api/gmail/oauth/url');
    expect((globalThis.window as any).location.href).toBe(consentUrl);
    expect(completed).toBe(true);
  });

  it('AuthService refuses to navigate to a consent URL that is not Google', () => {
    const http = { post: vi.fn(), get: vi.fn().mockReturnValue(of({ url: 'https://evil.example.com/' })) };
    const service = new AuthService(http as any);

    let error: unknown;
    service.connectGmail().subscribe({ error: (e) => (error = e) });

    expect(error).toBeInstanceOf(Error);
    expect((globalThis.window as any).location.href).toBe('');
  });

  describe('AuthService token cookies', () => {
    let written: string[];
    const doc = globalThis.document as any;

    beforeEach(() => {
      written = [];
      Object.defineProperty(doc, 'cookie', {
        configurable: true,
        get: () => '',
        set: (value: string) => written.push(value),
      });
    });

    afterEach(() => {
      Object.defineProperty(doc, 'cookie', { configurable: true, writable: true, value: '' });
    });

    const expired = (name: string) =>
      expect.stringMatching(new RegExp(`^${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`));

    it('never writes tokens to cookies on login', () => {
      const http = { post: vi.fn().mockReturnValue(of(authResponse)), get: vi.fn() };
      const service = new AuthService(http as any);
      written = [];

      service.login('user@example.com', 'password').subscribe();

      expect(localStorage.getItem('accessToken')).toBe('access-token');
      expect(written).toEqual([]);
      expect(written.join(';')).not.toContain('access-token');
    });

    it('expires legacy token cookies on startup and on logout', () => {
      const service = new AuthService({ post: vi.fn(), get: vi.fn() } as any);
      expect(written).toEqual([expired('accessToken'), expired('refreshToken')]);

      written = [];
      service.logout();
      expect(written).toEqual([expired('accessToken'), expired('refreshToken')]);
    });
  });

  it('GmailService calls current Gmail endpoints', () => {
    const http = {
      get: vi.fn().mockReturnValue(of([])),
      post: vi.fn().mockReturnValue(of({ message: 'revoked' })),
    };
    const service = new GmailService(http as any);

    http.get.mockReturnValueOnce(of({ emails: [{ gmailMessageId: 'msg-1' }], nextPageToken: 'page-2' }));
    let emails: any[] = [];
    service.fetchEmails({ label: 'INBOX', unread: true, limit: 20 }).subscribe((result) => (emails = result));
    expect(http.get).toHaveBeenCalledWith('api/gmail/emails?label=INBOX&unread=true&limit=20');
    expect(emails).toEqual([{ gmailMessageId: 'msg-1' }]);

    // Search + pagination: Gmail syntax must survive URL encoding ('+' must not become a space).
    http.get.mockReturnValueOnce(of({ emails: [], nextPageToken: 'page-3' }));
    let pageResult: any;
    service
      .fetchEmailPage({ label: 'INBOX', limit: 20, q: '  from:alice+news@example.com subject:"Q&A report"  ', pageToken: 'page-2' })
      .subscribe((result) => (pageResult = result));
    const url: string = http.get.mock.calls.at(-1)[0];
    expect(url).toBe(
      'api/gmail/emails?label=INBOX&limit=20&q=from%3Aalice%2Bnews%40example.com+subject%3A%22Q%26A+report%22&pageToken=page-2'
    );
    const params = new URL(url, 'http://x').searchParams;
    expect(params.get('q')).toBe('from:alice+news@example.com subject:"Q&A report"');
    expect(pageResult).toEqual({ emails: [], nextPageToken: 'page-3' });

    // Blank search and first-page (null) token are omitted.
    service.fetchEmailPage({ label: 'INBOX', q: '   ', pageToken: null }).subscribe();
    expect(http.get).toHaveBeenLastCalledWith('api/gmail/emails?label=INBOX');

    service.getEmailDetail('msg-1').subscribe();
    expect(http.get).toHaveBeenCalledWith('api/gmail/emails/msg-1');

    service.revokeGmail().subscribe();
    expect(http.post).toHaveBeenCalledWith('api/gmail/oauth/revoke', {});
  });

  it('DraftService calls current draft endpoints', () => {
    const http = {
      post: vi.fn().mockReturnValue(of({ _id: 'draft-1' })),
      get: vi.fn().mockReturnValue(of({})),
      put: vi.fn().mockReturnValue(of({})),
    };
    const service = new DraftService(http as any);

    service.generateDraft('msg-1', 'friendly', 'extra').subscribe();
    expect(http.post).toHaveBeenCalledWith('api/drafts/generate', {
      gmailMessageId: 'msg-1',
      tone: 'friendly',
      customContext: 'extra',
    });

    service.generateThreadDraft('thread-1', 'concise', 'thread context').subscribe();
    expect(http.post).toHaveBeenLastCalledWith('api/drafts/generate', {
      threadId: 'thread-1',
      tone: 'concise',
      customContext: 'thread context',
    });

    service.getDrafts('PENDING', 5).subscribe();
    expect(http.get).toHaveBeenCalledWith('api/drafts?status=PENDING&limit=5');

    service.getDraftDetail('draft-1').subscribe();
    expect(http.get).toHaveBeenCalledWith('api/drafts/draft-1');

    service.updateDraft('draft-1', 'body').subscribe();
    expect(http.put).toHaveBeenCalledWith('api/drafts/draft-1', { draftBody: 'body' });

    service.approveDraft('draft-1').subscribe();
    expect(http.post).toHaveBeenCalledWith('api/drafts/draft-1/approve', {});

    service.rejectDraft('draft-1').subscribe();
    expect(http.post).toHaveBeenCalledWith('api/drafts/draft-1/reject', {});

    service.sendDraft('draft-1', 'key').subscribe();
    expect(http.post).toHaveBeenCalledWith('api/drafts/draft-1/send', {}, {
      headers: { 'Idempotency-Key': 'key' },
    });
  });

  it('AuthInterceptor keeps the Idempotency-Key header when retrying a send after refresh', () => {
    const auth = {
      getAccessToken: vi.fn().mockReturnValueOnce('expired-token').mockReturnValue('refreshed-token'),
      refreshAccessToken: vi.fn().mockReturnValue(of({ accessToken: 'refreshed-token', refreshToken: 'refresh-token' })),
      logout: vi.fn(),
    };
    const interceptor = new AuthInterceptor(auth as any, { navigate: vi.fn() } as any);
    const request = new HttpRequest('POST', '/api/drafts/draft-1/send', {}, {
      headers: new HttpHeaders({ 'Idempotency-Key': 'send-key-1' }),
    });
    const seenKeys: (string | null)[] = [];
    const next = {
      handle: vi.fn()
        .mockImplementationOnce((req: HttpRequest<any>) => {
          seenKeys.push(req.headers.get('Idempotency-Key'));
          return throwError(() => new HttpErrorResponse({ status: 401 }));
        })
        .mockImplementationOnce((req: HttpRequest<any>) => {
          seenKeys.push(req.headers.get('Idempotency-Key'));
          return of({ type: 4 });
        }),
    };

    interceptor.intercept(request, next as any).subscribe();

    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(seenKeys).toEqual(['send-key-1', 'send-key-1']);
  });

  it('AuthInterceptor adds a bearer token, refreshes once, and retries a 401 request', () => {
    const auth = {
      getAccessToken: vi.fn().mockReturnValueOnce('expired-token').mockReturnValue('refreshed-token'),
      refreshAccessToken: vi.fn().mockReturnValue(of({ accessToken: 'refreshed-token', refreshToken: 'refresh-token' })),
      logout: vi.fn(),
    };
    const router = { navigate: vi.fn() };
    const interceptor = new AuthInterceptor(auth as any, router as any);
    const request = new HttpRequest('GET', '/api/drafts');
    const next = {
      handle: vi.fn()
        .mockImplementationOnce((req: HttpRequest<any>) => {
        expect(req.headers.get('Authorization')).toBe('Bearer expired-token');
        expect(req.withCredentials).toBe(true);
        return throwError(() => new HttpErrorResponse({ status: 401 }));
        })
        .mockImplementationOnce((req: HttpRequest<any>) => {
          expect(req.headers.get('Authorization')).toBe('Bearer refreshed-token');
          return of({ type: 4 });
        }),
    };

    interceptor.intercept(request, next as any).subscribe({
      complete: () => {
        expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(auth.logout).not.toHaveBeenCalled();
      },
    });
  });
});
