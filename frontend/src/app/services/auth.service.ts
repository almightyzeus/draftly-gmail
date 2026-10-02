import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, tap, finalize, shareReplay } from 'rxjs';

export interface User {
  id: string;
  email: string;
  name: string;
  googleConnected?: boolean;
}

export interface AuthResponse {
  message: string;
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = 'api/auth';
  private gmailApiUrl = 'api/gmail';
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private accessTokenSubject = new BehaviorSubject<string | null>(null);
  public accessToken$ = this.accessTokenSubject.asObservable();
  private refreshRequest$: Observable<TokenPair> | null = null;

  constructor(private http: HttpClient) {
    this.loadTokenFromStorage();
  }

  /**
   * Load token from localStorage. Validation happens in restoreSession().
   */
  private loadTokenFromStorage(): void {
    const token = localStorage.getItem('accessToken');
    if (token) {
      this.accessTokenSubject.next(token);
    }
  }

  /**
   * Validate a stored token and load the current user.
   * Runs from an app initializer, not the constructor: an HTTP call during
   * construction makes AuthInterceptor inject AuthService before it exists
   * (Angular NG0200), which used to log the user out on every page load.
   */
  restoreSession(): void {
    if (this.getAccessToken()) {
      this.getMe().subscribe(
        (response) => this.currentUserSubject.next(response.user),
        (error) => {
          // Only a 401 (left over after the interceptor's refresh attempt) means
          // the session is invalid. Network/server errors keep the stored tokens.
          if (error?.status === 401) {
            this.logout();
          }
        }
      );
    }
  }

  /**
   * Register a new user
   */
  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, {
      name,
      email,
      password,
    }).pipe(
      tap((response) => {
        this.storeTokens(response.accessToken, response.refreshToken);
        this.currentUserSubject.next(response.user);
      })
    );
  }

  /**
   * Login user
   */
  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, {
      email,
      password,
    }).pipe(
      tap((response) => {
        this.storeTokens(response.accessToken, response.refreshToken);
        this.currentUserSubject.next(response.user);
      })
    );
  }

  /**
   * Get current user info
   */
  getMe(): Observable<{ user: User }> {
    return this.http.get<{ user: User }>(`${this.apiUrl}/me`);
  }

  /**
   * Refresh once for a group of concurrent failed requests, then let each
   * request retry with the rotated access token.
   */
  refreshAccessToken(): Observable<TokenPair> {
    if (this.refreshRequest$) {
      return this.refreshRequest$;
    }

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      return throwError(() => new Error('No refresh token available'));
    }

    this.refreshRequest$ = this.http
      .post<TokenPair>(`${this.apiUrl}/refresh`, { refreshToken })
      .pipe(
        tap((tokens) => this.storeTokens(tokens.accessToken, tokens.refreshToken)),
        finalize(() => {
          this.refreshRequest$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    return this.refreshRequest$;
  }

  /**
   * Logout user
   */
  logout(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    this.accessTokenSubject.next(null);
    this.currentUserSubject.next(null);
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!localStorage.getItem('accessToken');
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  /**
   * Store tokens in localStorage AND cookies
   */
  private storeTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    // Also store in cookies for redirect requests
    try {
      this.setCookie('accessToken', accessToken, 15); // 15 minutes
      this.setCookie('refreshToken', refreshToken, 7 * 24 * 60); // 7 days
    } catch (error) {
      console.error('Failed to set cookies:', error);
      // Continue even if cookies fail - localStorage is sufficient for API calls
    }
    this.accessTokenSubject.next(accessToken);
  }

  /**
   * Set a cookie with expiration time (in minutes)
   */
  private setCookie(name: string, value: string, minutesExpiry: number): void {
    const date = new Date();
    date.setTime(date.getTime() + minutesExpiry * 60 * 1000);
    const expires = date.toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  }

  /**
   * Initiate Gmail OAuth connection
   * Redirects to backend OAuth endpoint - do NOT use HttpClient
   */
  connectGmail(): void {
    window.location.href = `${this.gmailApiUrl}/oauth/connect`;
  }}
