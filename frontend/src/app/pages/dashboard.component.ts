import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { RouterModule, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService, User } from '../services/auth.service';
import { GmailService } from '../services/gmail.service';

interface Email {
  id: string;
  gmailMessageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  direction: string;
  internalDate: Date;
  labels?: string[];
}

@Component({
    selector: 'app-dashboard',
    imports: [
    RouterModule,
    MatButtonModule,
    MatCardModule,
    MatToolbarModule,
    MatIconModule,
    MatMenuModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule
],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly pageSize = 20;
  currentUser: User | null = null;
  emails: Email[] = [];
  isLoadingEmails = false;
  emailsError: string | null = null;
  displayedColumns: string[] = ['from', 'subject', 'snippet', 'internalDate'];
  /** The startup inbox load happens once, when a Gmail-connected user is known. */
  private initialLoadRequested = false;
  private userSubscription?: Subscription;

  /** Text in the search box. */
  searchQuery = '';
  /** The Gmail query the current results were loaded with. */
  activeQuery = '';
  unreadOnly = false;
  /**
   * Gmail page tokens by page index. pageTokens[0] is null (first page);
   * pageTokens[i + 1] is the nextPageToken returned for page i. Tokens are opaque.
   */
  private pageTokens: (string | null)[] = [null];
  pageIndex = 0;
  private listSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private gmailService: GmailService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // AuthService.restoreSession() loads /me at startup and login/register set
    // the user, so currentUser$ is the single source of user state here.
    this.userSubscription = this.authService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      if (user?.googleConnected) {
        if (!this.initialLoadRequested) {
          this.initialLoadRequested = true;
          this.fetchEmails();
        }
      } else {
        // Clear emails if Gmail is not connected
        this.emails = [];
        this.isLoadingEmails = false;
      }
    });
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  connectGmail(): void {
    this.emailsError = null;
    this.authService.connectGmail().subscribe({
      error: (error) => {
        console.error('Failed to start Gmail connection:', error);
        this.emailsError = 'Could not start the Gmail connection. Please try again.';
      },
    });
  }

  disconnectGmail(): void {
    if (confirm('Are you sure you want to disconnect your Gmail account?')) {
      this.gmailService.revokeGmail().subscribe({
        next: () => {
          if (this.currentUser) {
            this.currentUser.googleConnected = false;
            this.emails = [];
            this.resetPagination();
          }
        },
        error: (error) => {
          console.error('Failed to disconnect Gmail:', error);
        },
      });
    }
  }

  /** Reload the current page (Refresh button and initial load). */
  fetchEmails(): void {
    this.loadPage(this.pageIndex);
  }

  /** Run a new Gmail search from the first page. */
  search(): void {
    this.activeQuery = this.searchQuery.trim();
    this.resetPagination();
    this.loadPage(0);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.activeQuery = '';
    this.resetPagination();
    this.loadPage(0);
  }

  toggleUnreadOnly(): void {
    this.unreadOnly = !this.unreadOnly;
    this.resetPagination();
    this.loadPage(0);
  }

  /** Empty state only when a load finished without error and found nothing. */
  get showEmptyState(): boolean {
    return !this.isLoadingEmails && !this.emailsError && this.emails.length === 0;
  }

  get emptyStateMessage(): string {
    return this.activeQuery ? `No emails match "${this.activeQuery}"` : 'No emails found';
  }

  get hasPreviousPage(): boolean {
    return this.pageIndex > 0;
  }

  get hasNextPage(): boolean {
    return !!this.pageTokens[this.pageIndex + 1];
  }

  nextPage(): void {
    if (this.hasNextPage && !this.isLoadingEmails) {
      this.loadPage(this.pageIndex + 1);
    }
  }

  previousPage(): void {
    if (this.hasPreviousPage && !this.isLoadingEmails) {
      this.loadPage(this.pageIndex - 1);
    }
  }

  private resetPagination(): void {
    this.pageTokens = [null];
    this.pageIndex = 0;
  }

  private loadPage(index: number): void {
    if (!this.currentUser?.googleConnected) {
      this.emailsError = 'Gmail account not connected. Please connect Gmail first.';
      return;
    }

    // A newer request supersedes any in-flight one, so a slow response can't
    // overwrite the page the user asked for last.
    this.listSubscription?.unsubscribe();
    this.isLoadingEmails = true;
    this.emailsError = null;

    this.listSubscription = this.gmailService
      .fetchEmailPage({
        label: 'INBOX',
        limit: this.pageSize,
        unread: this.unreadOnly,
        q: this.activeQuery,
        pageToken: this.pageTokens[index],
      })
      .subscribe({
        next: (page) => {
          this.emails = page.emails;
          this.pageIndex = index;
          // Keep the history up to this page and record the token for the next one.
          this.pageTokens = [...this.pageTokens.slice(0, index + 1), page.nextPageToken];
          this.isLoadingEmails = false;
        },
        error: (error) => {
          console.error('Failed to fetch emails:', error);
          this.emails = [];
          if (error.status === 401) {
            this.emailsError = 'Authentication failed. Please log in again.';
          } else if (error.status === 403 && this.currentUser) {
            // The backend found the Gmail grant expired/revoked and disconnected it;
            // show the Connect Gmail card instead of a dead inbox.
            this.emailsError = error.error?.error || 'Gmail access has expired. Please reconnect Gmail.';
            this.currentUser = { ...this.currentUser, googleConnected: false };
            this.resetPagination();
          } else if (error.error?.error === 'Gmail account not connected') {
            this.emailsError = 'Gmail account not properly connected. Try disconnecting and reconnecting.';
          } else {
            this.emailsError = error.error?.error || 'Failed to fetch emails. Please try again.';
          }
          this.isLoadingEmails = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.userSubscription?.unsubscribe();
    this.listSubscription?.unsubscribe();
  }

  formatDate(date: any): string {
    if (!date) return '';
    const dateObj = new Date(date);
    return dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  }

  truncateSnippet(snippet: string, length: number = 60): string {
    if (!snippet) return '';
    return snippet.length > length ? snippet.substring(0, length) + '...' : snippet;
  }

  openEmailDetail(email: Email): void {
    this.router.navigate(['/email', email.gmailMessageId]);
  }
}
