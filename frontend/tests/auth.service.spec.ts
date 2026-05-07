import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from '../src/app/services/auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('register', () => {
    it('should register a new user', () => {
      const mockResponse = {
        user: {
          id: 'user123',
          email: 'test@example.com',
          name: 'Test User',
          googleConnected: false,
        },
        tokens: {
          accessToken: 'token123',
          refreshToken: 'refresh123',
        },
      };

      service.register('Test User', 'test@example.com', 'password123').subscribe((response) => {
        expect(response.user.email).toBe('test@example.com');
        expect(response.tokens.accessToken).toBeDefined();
      });

      const req = httpMock.expectOne('/api/auth/register');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });

  describe('login', () => {
    it('should login user and return tokens', () => {
      const mockResponse = {
        user: {
          id: 'user123',
          email: 'test@example.com',
          name: 'Test User',
          googleConnected: false,
        },
        tokens: {
          accessToken: 'token123',
          refreshToken: 'refresh123',
        },
      };

      service.login('test@example.com', 'password123').subscribe((response) => {
        expect(response.tokens.accessToken).toBeDefined();
        expect(service.isLoggedIn()).toBe(true);
      });

      const req = httpMock.expectOne('/api/auth/login');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });

    it('should store tokens in localStorage after login', () => {
      const mockResponse = {
        user: { id: 'user123', email: 'test@example.com', name: 'Test User' },
        tokens: { accessToken: 'token123', refreshToken: 'refresh123' },
      };

      service.login('test@example.com', 'password123').subscribe(() => {
        expect(localStorage.getItem('accessToken')).toBeDefined();
      });

      const req = httpMock.expectOne('/api/auth/login');
      req.flush(mockResponse);
    });
  });

  describe('logout', () => {
    it('should clear tokens and set isLoggedIn to false', () => {
      localStorage.setItem('accessToken', 'token123');
      localStorage.setItem('refreshToken', 'refresh123');

      service.logout();

      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
      expect(service.isLoggedIn()).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should retrieve access token from localStorage', () => {
      const token = 'test_access_token_123';
      localStorage.setItem('accessToken', token);

      const result = service.getAccessToken();

      expect(result).toBe(token);
    });

    it('should return null if no token stored', () => {
      localStorage.removeItem('accessToken');

      const result = service.getAccessToken();

      expect(result).toBeNull();
    });
  });

  describe('isLoggedIn', () => {
    it('should return true if tokens exist', () => {
      localStorage.setItem('accessToken', 'token123');

      const result = service.isLoggedIn();

      expect(result).toBe(true);
    });

    it('should return false if no tokens', () => {
      localStorage.clear();

      const result = service.isLoggedIn();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentUser', () => {
    it('should fetch current user from API', () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        googleConnected: false,
      };

      service.getCurrentUser().subscribe((user) => {
        expect(user.email).toBe('test@example.com');
      });

      const req = httpMock.expectOne('/api/auth/me');
      expect(req.request.method).toBe('GET');
      req.flush(mockUser);
    });
  });

  describe('refreshToken', () => {
    it('should refresh access token using refresh token', () => {
      const mockResponse = {
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
      };

      localStorage.setItem('refreshToken', 'old_refresh_token');

      service.refreshToken().subscribe(() => {
        expect(localStorage.getItem('accessToken')).toBe('new_access_token');
      });

      const req = httpMock.expectOne('/api/auth/refresh');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });
});
