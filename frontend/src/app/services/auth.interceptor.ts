import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private authService: AuthService, private router: Router) {}

  intercept(
    req: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    const isAuthRequest = req.url.includes('/auth/register') ||
      req.url.includes('/auth/login') ||
      req.url.includes('/auth/refresh');

    // Add Authorization header if token exists.
    const token = this.authService.getAccessToken();
    if (token && !isAuthRequest) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    // Enable credentials for all requests to allow cookies
    req = req.clone({
      withCredentials: true,
    });

    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        // A non-auth request gets one refresh-and-retry attempt. Refresh
        // failures end the session, while a retried 401 is surfaced normally.
        if (error.status === 401 && !isAuthRequest) {
          return this.authService.refreshAccessToken().pipe(
            switchMap(() => {
              const refreshedToken = this.authService.getAccessToken();
              const retry = refreshedToken
                ? req.clone({ setHeaders: { Authorization: `Bearer ${refreshedToken}` } })
                : req;
              return next.handle(retry);
            }),
            catchError((refreshError: HttpErrorResponse) => {
              this.authService.logout();
              this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
              return throwError(() => refreshError);
            })
          );
        }
        return throwError(() => error);
      })
    );
  }
}
