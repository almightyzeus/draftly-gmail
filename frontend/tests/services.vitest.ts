import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
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
    expect(http.get).toHaveBeenCalledWith('api/auth/me');
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

  it('AuthService redirects to Gmail OAuth endpoint', () => {
    const service = new AuthService({ post: vi.fn(), get: vi.fn() } as any);
    service.connectGmail();
    expect((globalThis.window as any).location.href).toBe('api/gmail/oauth/connect');
  });

  it('GmailService calls current Gmail endpoints', () => {
    const http = {
      get: vi.fn().mockReturnValue(of([])),
      post: vi.fn().mockReturnValue(of({ message: 'revoked' })),
    };
    const service = new GmailService(http as any);

    service.fetchEmails({ label: 'INBOX', unread: true, limit: 20 }).subscribe();
    expect(http.get).toHaveBeenCalledWith('api/gmail/emails?label=INBOX&unread=true&limit=20');

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
    expect(http.post).toHaveBeenCalledWith('api/drafts/draft-1/send', { idempotencyKey: 'key' });
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
