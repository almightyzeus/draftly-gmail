import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login.component';
import { RegisterComponent } from './pages/register.component';
import { DashboardComponent } from './pages/dashboard.component';
import { EmailDetailComponent } from './pages/email-detail.component';
import { DraftDetailComponent } from './pages/draft-detail.component';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard],
  },
  {
    path: 'email/:gmailMessageId',
    component: EmailDetailComponent,
    canActivate: [authGuard],
  },
  {
    path: 'draft/:id',
    component: DraftDetailComponent,
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'dashboard' },
];
