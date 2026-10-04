import { Component, EventEmitter, Input, Output } from '@angular/core';
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
  template: `
    <mat-toolbar color="primary" class="top-bar">
      @if (showBack) {
        <button mat-icon-button (click)="back.emit()" aria-label="Back">
          <mat-icon>arrow_back</mat-icon>
        </button>
      }
      <a class="brand" routerLink="/dashboard" aria-label="Draftly home">
        <mat-icon>auto_awesome</mat-icon>
        <span class="brand-name">Draftly</span>
      </a>
      @if (title) {
        <span class="title hide-sm">{{ title }}</span>
      }
      <ng-content />
      <span class="spacer"></span>

      @if (user$ | async; as user) {
        @if (user.googleConnected) {
          <button
            mat-button
            class="gmail-status gmail-status--connected"
            [matMenuTriggerFor]="gmailMenu"
            [attr.aria-label]="'Gmail connected' + (user.gmailEmail ? ' as ' + user.gmailEmail : '')"
            matTooltip="Gmail connection"
          >
            <mat-icon>mark_email_read</mat-icon>
            <span class="hide-sm">{{ user.gmailEmail || 'Gmail connected' }}</span>
          </button>
          <mat-menu #gmailMenu="matMenu">
            <button mat-menu-item (click)="disconnectGmail()">
              <mat-icon>link_off</mat-icon>
              <span>Disconnect Gmail</span>
            </button>
          </mat-menu>
        } @else {
          <button mat-stroked-button class="gmail-status gmail-status--disconnected" (click)="connectGmail()">
            <mat-icon>add_link</mat-icon>
            <span>Connect Gmail</span>
          </button>
        }

        <button mat-icon-button [matMenuTriggerFor]="accountMenu" aria-label="Account menu">
          <mat-icon>account_circle</mat-icon>
        </button>
        <mat-menu #accountMenu="matMenu">
          <div class="account-header" mat-menu-item disabled>
            <span class="account-name">{{ user.name }}</span>
            <span class="account-email">{{ user.email }}</span>
          </div>
          <button mat-menu-item (click)="logout()">
            <mat-icon>logout</mat-icon>
            <span>Log out</span>
          </button>
        </mat-menu>
      }
    </mat-toolbar>
  `,
  styles: [`
    .top-bar { position: sticky; top: 0; z-index: 10; gap: 4px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12); }
    .brand { display: inline-flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; font-weight: 600; }
    .title { margin-left: 12px; padding-left: 12px; border-left: 1px solid rgba(255, 255, 255, 0.4); font-weight: 400; font-size: 18px; }
    .gmail-status { color: inherit; }
    .gmail-status--disconnected { border-color: rgba(255, 255, 255, 0.7); }
    .account-header { display: flex; flex-direction: column; line-height: 1.3; height: auto; padding-top: 8px; padding-bottom: 8px; }
    .account-name { font-weight: 500; color: rgba(0, 0, 0, 0.87); }
    .account-email { font-size: 12px; color: rgba(0, 0, 0, 0.6); }
    @media (max-width: 480px) { .brand-name { display: none; } }
  `],
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
