import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LoginComponent } from '../src/app/pages/login.component';
import { AuthService } from '../src/app/services/auth.service';
import { of, throwError } from 'rxjs';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authService: AuthService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LoginComponent],
      imports: [ReactiveFormsModule],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
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
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('form validation', () => {
    it('should initialize form with empty email and password', () => {
      expect(component.loginForm.get('email')?.value).toBe('');
      expect(component.loginForm.get('password')?.value).toBe('');
    });

    it('should require email field', () => {
      const emailControl = component.loginForm.get('email');
      emailControl?.setValue('');
      expect(emailControl?.hasError('required')).toBe(true);
    });

    it('should require password field', () => {
      const passwordControl = component.loginForm.get('password');
      passwordControl?.setValue('');
      expect(passwordControl?.hasError('required')).toBe(true);
    });

    it('should validate email format', () => {
      const emailControl = component.loginForm.get('email');
      emailControl?.setValue('invalid-email');
      expect(emailControl?.hasError('email')).toBe(true);
    });
  });

  describe('login functionality', () => {
    it('should call authService.login on form submit', () => {
      const mockResponse = {
        user: { id: 'user123', email: 'test@example.com' },
        tokens: { accessToken: 'token123' },
      };

      (authService.login as jest.Mock).mockReturnValue(of(mockResponse));

      component.loginForm.patchValue({
        email: 'test@example.com',
        password: 'password123',
      });

      component.onSubmit();

      expect(authService.login).toHaveBeenCalledWith('test@example.com', 'password123');
    });

    it('should navigate to dashboard on successful login', (done) => {
      const mockResponse = {
        user: { id: 'user123', email: 'test@example.com' },
        tokens: { accessToken: 'token123' },
      };

      (authService.login as jest.Mock).mockReturnValue(of(mockResponse));

      component.loginForm.patchValue({
        email: 'test@example.com',
        password: 'password123',
      });

      component.onSubmit();

      setTimeout(() => {
        expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
        done();
      }, 100);
    });

    it('should display error message on login failure', (done) => {
      const error = { status: 401, error: { message: 'Invalid credentials' } };
      (authService.login as jest.Mock).mockReturnValue(throwError(() => error));

      component.loginForm.patchValue({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      component.onSubmit();

      setTimeout(() => {
        expect(component.errorMessage).toBeTruthy();
        done();
      }, 100);
    });

    it('should disable submit button during login', (done) => {
      const mockResponse = {
        user: { id: 'user123', email: 'test@example.com' },
        tokens: { accessToken: 'token123' },
      };

      (authService.login as jest.Mock).mockReturnValue(of(mockResponse));

      component.loginForm.patchValue({
        email: 'test@example.com',
        password: 'password123',
      });

      component.onSubmit();

      expect(component.isLoading).toBe(true);

      setTimeout(() => {
        done();
      }, 100);
    });
  });

  describe('navigation', () => {
    it('should have link to register page', () => {
      const registerLink = fixture.nativeElement.querySelector('a[routerLink="/register"]');
      expect(registerLink).toBeTruthy();
    });
  });
});
