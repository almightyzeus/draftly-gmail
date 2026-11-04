import { Component } from '@angular/core';

import { AbstractControl, ReactiveFormsModule, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../services/auth.service';

/** Same rules as the API (POST /api/auth/register). */
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt only uses the first 72 bytes of a password. */
export const MAX_PASSWORD_BYTES = 72;

/** Fails when the value is longer than `max` bytes in UTF-8 (e.g. "é" counts as 2). */
export function maxUtf8Bytes(max: number) {
  return (control: AbstractControl): ValidationErrors | null =>
    new TextEncoder().encode(control.value ?? '').length > max ? { maxbytes: { max } } : null;
}

@Component({
    selector: 'app-register',
    imports: [
    ReactiveFormsModule,
    RouterModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
],
    templateUrl: './register.component.html'
})
export class RegisterComponent {
  readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  readonly maxPasswordBytes = MAX_PASSWORD_BYTES;
  registerForm: FormGroup;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.registerForm = this.fb.group(
      {
        name: ['', [Validators.required, Validators.minLength(2)]],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH), maxUtf8Bytes(MAX_PASSWORD_BYTES)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: this.passwordMatchValidator }
    );
  }

  passwordMatchValidator(form: FormGroup): { [key: string]: boolean } | null {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');

    if (password && confirmPassword && password.value !== confirmPassword.value) {
      return { passwordMismatch: true };
    }
    return null;
  }

  onSubmit(): void {
    if (this.registerForm.invalid) return;

    this.isLoading = true;
    const { name, email, password } = this.registerForm.value;

    this.authService.register(name, email, password).subscribe({
      next: () => {
        this.snackBar.open('Registration successful! Welcome to Draftly!', 'Close', {
          duration: 3000,
        });
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.isLoading = false;
        const message = error?.error?.error || 'Registration failed. Please try again.';
        this.snackBar.open(message, 'Close', { duration: 5000, panelClass: ['error'] });
      },
    });
  }
}
