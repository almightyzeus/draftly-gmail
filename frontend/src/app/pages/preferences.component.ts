import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { filter } from 'rxjs';
import { PreferenceService, Tone, UserPreferences } from '../services/preference.service';
import { ConfirmService } from '../shared/confirm.service';
import { TopBarComponent } from '../shared/top-bar.component';

/** Limits enforced by the API (PUT /api/preferences). */
export const MAX_SIGNATURE_LENGTH = 1000;
export const MIN_STYLE_EXAMPLES = 1;
export const MAX_STYLE_EXAMPLES = 20;

/**
 * Preferences used when drafting replies: the default tone (preselected on the
 * email page and used when no tone is sent), the signature the AI ends every
 * draft with, and how many of the user's sent emails are shown to the AI as
 * style examples.
 */
@Component({
  selector: 'app-preferences',
  imports: [
    TitleCasePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TopBarComponent,
  ],
  templateUrl: './preferences.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./preferences.component.css'],
})
export class PreferencesComponent implements OnInit {
  readonly toneOptions: Tone[] = ['formal', 'concise', 'friendly'];
  readonly maxSignatureLength = MAX_SIGNATURE_LENGTH;
  readonly minStyleExamples = MIN_STYLE_EXAMPLES;
  readonly maxStyleExamples = MAX_STYLE_EXAMPLES;

  form: FormGroup;
  isLoading = true;
  isSaving = false;
  /** Failure to load (replaces the form). */
  loadError: string | null = null;
  /** Failure to save (the form stays visible). */
  saveError: string | null = null;

  constructor(
    private fb: FormBuilder,
    private preferenceService: PreferenceService,
    private router: Router,
    private snackBar: MatSnackBar,
    private confirmService: ConfirmService
  ) {
    this.form = this.fb.group({
      defaultTone: ['formal' as Tone, Validators.required],
      signature: ['', Validators.maxLength(MAX_SIGNATURE_LENGTH)],
      learningEmailCount: [
        5,
        [
          Validators.required,
          Validators.min(MIN_STYLE_EXAMPLES),
          Validators.max(MAX_STYLE_EXAMPLES),
          Validators.pattern(/^\d+$/),
        ],
      ],
    });
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.loadError = null;
    this.preferenceService.getPreferences().subscribe({
      next: (preferences) => {
        this.reset(preferences);
        this.isLoading = false;
      },
      error: (error) => {
        this.loadError = error?.error?.error || 'Failed to load your preferences.';
        this.isLoading = false;
      },
    });
  }

  get signatureLength(): number {
    return (this.form.get('signature')?.value ?? '').length;
  }

  save(): void {
    if (this.form.invalid || this.form.pristine || this.isSaving) {
      this.form.markAllAsTouched();
      return;
    }

    const { defaultTone, signature, learningEmailCount } = this.form.getRawValue();
    this.isSaving = true;
    this.saveError = null;

    this.preferenceService
      .updatePreferences({
        defaultTone,
        // Trailing whitespace/newlines would be repeated at the end of every draft.
        signature: (signature ?? '').trimEnd(),
        learningEmailCount: Number(learningEmailCount),
      })
      .subscribe({
        next: (saved) => {
          this.reset(saved);
          this.isSaving = false;
          this.snackBar.open('Preferences saved.', 'Close', { duration: 3000 });
        },
        error: (error) => {
          this.saveError = error?.error?.error || 'Failed to save your preferences. Please try again.';
          this.isSaving = false;
        },
      });
  }

  goBack(): void {
    if (this.form.pristine) {
      this.toDashboard();
      return;
    }
    this.confirmService
      .confirm({
        title: 'Discard unsaved changes?',
        message: 'Your changes to your preferences have not been saved.',
        confirmText: 'Discard',
        tone: 'warn',
      })
      .pipe(filter(Boolean))
      .subscribe(() => this.toDashboard());
  }

  /** Show stored values and mark the form as unchanged. */
  private reset(preferences: UserPreferences): void {
    this.form.reset({
      defaultTone: this.toneOptions.includes(preferences.defaultTone) ? preferences.defaultTone : 'formal',
      signature: preferences.signature ?? '',
      learningEmailCount: preferences.learningEmailCount ?? 5,
    });
  }

  private toDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
