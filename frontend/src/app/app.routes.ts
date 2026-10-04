import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';

// Pages are lazy-loaded so each one is only downloaded when first visited,
// keeping the initial bundle small.
export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'email/:gmailMessageId',
    loadComponent: () => import('./pages/email-detail.component').then((m) => m.EmailDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'draft/:id',
    loadComponent: () => import('./pages/draft-detail.component').then((m) => m.DraftDetailComponent),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'dashboard' },
];
