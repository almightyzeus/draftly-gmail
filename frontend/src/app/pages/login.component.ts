import { Component } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../services/auth.service';

@Component({
    selector: 'app-login',
    imports: [
    ReactiveFormsModule,
    RouterModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
],
    templateUrl: './login.component.html'
})
export class LoginComponent {
  loginForm: FormGroup;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  onSubmit(): void {
    if (this.loginForm.invalid) return;

    this.isLoading = true;
    const { email, password } = this.loginForm.value;

    this.authService.login(email, password).subscribe({
      next: () => {
        this.snackBar.open('Login successful!', 'Close', { duration: 3000 });
        this.router.navigateByUrl(this.safeReturnUrl());
      },
      error: (error) => {
        this.isLoading = false;
        const message = error?.error?.error || 'Login failed. Please try again.';
        this.snackBar.open(message, 'Close', { duration: 5000, panelClass: ['error'] });
      },
    });
  }

  /**
   * Where to go after login: the page the auth guard redirected from
   * (?returnUrl=), if it is an in-app path; otherwise the dashboard.
   * Absolute and protocol-relative URLs are ignored (no open redirect).
   */
  private safeReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    // Browsers treat "/\host" like "//host", so both are rejected.
    if (returnUrl && /^\/(?![/\\])/.test(returnUrl)) {
      return returnUrl;
    }
    return '/dashboard';
  }
}
