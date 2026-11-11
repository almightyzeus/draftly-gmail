import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS, withXhr } from '@angular/common/http';
import { routes } from './app.routes';
import { AuthInterceptor } from './services/auth.interceptor';
import { AuthService } from './services/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    // No provideAnimations(): Angular Material animates with CSS and does not use
    // @angular/animations, so the engine (~60 kB) would only enlarge the initial bundle.
    // Auth is a Bearer header (never a cookie), so there is no XSRF cookie setup.
    provideHttpClient(withXhr(), withInterceptorsFromDi()),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
    // Validate a stored session once DI is ready (see AuthService.restoreSession).
    provideAppInitializer(() => {
      inject(AuthService).restoreSession();
    }),
  ],
};
