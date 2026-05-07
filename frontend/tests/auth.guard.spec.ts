import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthGuard } from '../src/app/services/auth.guard';
import { AuthService } from '../src/app/services/auth.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let authService: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        {
          provide: AuthService,
          useValue: {
            isLoggedIn: jest.fn(),
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: jest.fn(),
          },
        },
      ],
    });

    guard = TestBed.inject(AuthGuard);
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  describe('canActivate', () => {
    it('should allow navigation if user is logged in', () => {
      (authService.isLoggedIn as jest.Mock).mockReturnValue(true);

      const result = guard.canActivate(
        {} as any,
        {} as any
      );

      expect(result).toBe(true);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should deny navigation if user is not logged in', () => {
      (authService.isLoggedIn as jest.Mock).mockReturnValue(false);

      const result = guard.canActivate(
        {} as any,
        {} as any
      );

      expect(result).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should redirect to login on denied access', () => {
      (authService.isLoggedIn as jest.Mock).mockReturnValue(false);

      guard.canActivate({} as any, {} as any);

      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });
});
