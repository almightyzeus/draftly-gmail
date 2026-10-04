import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

/**
 * Ask the user to confirm an action. Emits true only when they confirm
 * (Cancel, Escape and clicking outside all count as "no").
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  constructor(private dialog: MatDialog) {}

  confirm(data: ConfirmDialogData): Observable<boolean> {
    return this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        data,
        autoFocus: 'dialog',
        width: '440px',
        maxWidth: '92vw',
      })
      .afterClosed()
      .pipe(map((result) => result === true));
  }
}
