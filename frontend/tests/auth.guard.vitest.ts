import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector } from '@angular/core';
import { Router } from '@angular/router';
import { authGuard } from '../src/app/services/auth.guard';
import { AuthService } from '../src/app/services/auth.service';

describe('authGuard', () => {
  let authService: AuthService;
  let router: Router;
  let injector: Injector;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock services
    authService = {
      isAuthenticated: vi.fn(),
    } as any;

    router = {
      navigate: vi.fn(),
    } as any;

    // Create a minimal injector with mocked services
    injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('should allow navigation when user is authenticated', () => {
    (authService.isAuthenticated as any).mockReturnValue(true);

    const result = injector.runInContext(() =>
      authGuard({} as any, { url: '/dashboard' } as any)
    );

    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('should deny navigation and redirect to login when user is not authenticated', () => {
    (authService.isAuthenticated as any).mockReturnValue(false);

    const result = injector.runInContext(() =>
      authGuard({} as any, { url: '/dashboard' } as any)
    );

    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login'], expect.objectContaining({
      queryParams: { returnUrl: '/dashboard' },
    }));
  });

  it('should pass the original URL as returnUrl query parameter', () => {
    (authService.isAuthenticated as any).mockReturnValue(false);

    injector.runInContext(() =>
      authGuard({} as any, { url: '/email/msg-123' } as any)
    );

    expect(router.navigate).toHaveBeenCalledWith(['/login'], expect.objectContaining({
      queryParams: { returnUrl: '/email/msg-123' },
    }));
  });
});
