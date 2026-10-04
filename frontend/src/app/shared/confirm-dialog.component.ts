import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText: string;
  /** 'warn' for destructive or irreversible actions. */
  tone?: 'primary' | 'warn';
}

/**
 * Material replacement for window.confirm(). Closes with true when confirmed.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Cancel</button>
      <button mat-flat-button [color]="data.tone ?? 'primary'" [mat-dialog-close]="true" cdkFocusInitial>
        {{ data.confirmText }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`.message { margin: 0; max-width: 420px; line-height: 1.5; }`],
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
