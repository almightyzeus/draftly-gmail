import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { GmailService } from '../services/gmail.service';
import { ConfirmService } from './confirm.service';

/**
 * App bar for signed-in pages: brand, optional back button and title, the
 * Gmail connection status (with connect/disconnect), and the account menu.
 * Extra content (e.g. a status badge) can be projected after the title.
 */
@Component({
  selector: 'app-top-bar',
  imports: [AsyncPipe, RouterLink, MatToolbarModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './top-bar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./top-bar.component.css'],
})
export class TopBarComponent {
  @Input() title = '';
  @Input() showBack = false;
  @Output() back = new EventEmitter<void>();

  readonly user$;

  constructor(
    private authService: AuthService,
    private gmailService: GmailService,
    private confirmService: ConfirmService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {
    this.user$ = this.authService.currentUser$;
  }

  connectGmail(): void {
    this.authService.connectGmail().subscribe({
      error: () => this.snackBar.open('Could not start the Gmail connection. Please try again.', 'Close', { duration: 5000 }),
    });
  }

  disconnectGmail(): void {
    this.confirmService
      .confirm({
        title: 'Disconnect Gmail?',
        message: 'Draftly will lose access to your inbox until you connect Gmail again. Your drafts are kept.',
        confirmText: 'Disconnect',
        tone: 'warn',
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.gmailService.revokeGmail())
      )
      .subscribe({
        next: () => {
          this.authService.setGoogleConnected(false);
          this.snackBar.open('Gmail disconnected.', 'Close', { duration: 3000 });
        },
        error: () => this.snackBar.open('Could not disconnect Gmail. Please try again.', 'Close', { duration: 5000 }),
      });
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
