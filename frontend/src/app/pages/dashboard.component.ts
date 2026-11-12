import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService, User } from '../services/auth.service';
import { GmailService } from '../services/gmail.service';
import { DraftService } from '../services/draft.service';
import { StateComponent } from '../shared/state.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { TopBarComponent } from '../shared/top-bar.component';
import { formatFullDate, formatListDate, senderName } from '../shared/format';
import { gmailConnectErrorMessage } from '../shared/gmail-connect-error';

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

export interface DraftSummary {
  _id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT';
  tone: string;
  updatedAt: string;
  createdAt: string;
  replyTo: { from: string; subject: string } | null;
}

export type DraftFilter = '' | DraftSummary['status'];

/** Stand-in row shown in a list table while it loads. */
export interface PlaceholderRow {
  placeholder: true;
}

/** Placeholder rows for a first load, before the list's length is known. */
export const DEFAULT_PLACEHOLDER_ROWS = 10;

function placeholderRows(count: number): PlaceholderRow[] {
  return Array.from({ length: count }, () => ({ placeholder: true }));
}

@Component({
  selector: 'app-dashboard',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    MatTableModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    StateComponent,
    StatusBadgeComponent,
    TopBarComponent,
  ],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly pageSize = 20;
  currentUser: User | null = null;
  emails: Email[] = [];
  isLoadingEmails = false;
  emailsError: string | null = null;
  displayedColumns: string[] = ['from', 'subject', 'internalDate'];
  readonly formatDate = formatListDate;
  readonly formatFullDate = formatFullDate;
  readonly senderName = senderName;
  /** Row template switch for the list tables: placeholder rows use their own, non-interactive row. */
  readonly isPlaceholder = (_index: number, row: unknown): boolean => (row as PlaceholderRow | null)?.placeholder === true;
  /** Shown instead of the emails while a page loads; as many rows as the list had, so it keeps its height. */
  emailPlaceholders = placeholderRows(DEFAULT_PLACEHOLDER_ROWS);

  /** Why the last Gmail connection attempt failed (from the OAuth callback redirect). */
  gmailConnectError: string | null = null;

  /** 0 = Inbox, 1 = Drafts; mirrored in the URL (?tab=drafts). */
  selectedTab = 0;

  drafts: DraftSummary[] = [];
  draftsFilter: DraftFilter = '';
  readonly draftFilters: { value: DraftFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'SENT', label: 'Sent' },
    { value: 'REJECTED', label: 'Rejected' },
  ];
  draftColumns: string[] = ['to', 'subject', 'status', 'updatedAt'];
  isLoadingDrafts = false;
  draftsError: string | null = null;
  /** Shown instead of the drafts while they load. */
  draftPlaceholders = placeholderRows(DEFAULT_PLACEHOLDER_ROWS);
  private draftsLoaded = false;
  private draftsSubscription?: Subscription;
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
    private draftService: DraftService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.selectedTab = this.route.snapshot.queryParamMap.get('tab') === 'drafts' ? 1 : 0;

    // The Gmail OAuth callback reports a failed connection as ?gmailError=<code>.
    // Show it once, then drop it from the URL so a reload doesn't repeat it.
    this.gmailConnectError = gmailConnectErrorMessage(this.route.snapshot.queryParamMap.get('gmailError'));
    if (this.gmailConnectError) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { gmailError: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    // AuthService.restoreSession() loads /me at startup and login/register set
    // the user, so currentUser$ is the single source of user state here.
    this.userSubscription = this.authService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      if (user?.googleConnected) {
        if (!this.initialLoadRequested) {
          this.initialLoadRequested = true;
          this.fetchEmails();
          if (this.selectedTab === 1) {
            this.loadDrafts();
          }
        }
      } else {
        // Gmail not connected (or just disconnected): nothing to show.
        this.listSubscription?.unsubscribe();
        this.emails = [];
        this.isLoadingEmails = false;
        this.resetPagination();
        this.initialLoadRequested = false;
      }
    });
  }

  onTabChange(index: number): void {
    this.selectedTab = index;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: index === 1 ? 'drafts' : null },
      replaceUrl: true,
    });
    if (index === 1 && !this.draftsLoaded) {
      this.loadDrafts();
    }
  }

  setDraftsFilter(filter: DraftFilter): void {
    this.draftsFilter = filter;
    this.loadDrafts();
  }

  loadDrafts(): void {
    this.draftsSubscription?.unsubscribe();
    this.draftPlaceholders = placeholderRows(this.drafts.length || DEFAULT_PLACEHOLDER_ROWS);
    this.isLoadingDrafts = true;
    this.draftsError = null;
    this.draftsLoaded = true;

    this.draftsSubscription = this.draftService.getDrafts(this.draftsFilter || undefined, 50).subscribe({
      next: (drafts) => {
        this.drafts = drafts;
        this.isLoadingDrafts = false;
      },
      error: (error) => {
        console.error('Failed to load drafts:', error);
        this.drafts = [];
        this.draftsError = error?.error?.error || 'Failed to load drafts. Please try again.';
        this.isLoadingDrafts = false;
      },
    });
  }

  /** Rows for the inbox table: the emails, or placeholders while a page loads. */
  get emailRows(): (Email | PlaceholderRow)[] {
    return this.isLoadingEmails ? this.emailPlaceholders : this.emails;
  }

  /** Rows for the drafts table: the drafts, or placeholders while they load. */
  get draftRows(): (DraftSummary | PlaceholderRow)[] {
    return this.isLoadingDrafts ? this.draftPlaceholders : this.drafts;
  }

  get showDraftsEmptyState(): boolean {
    return !this.isLoadingDrafts && !this.draftsError && this.drafts.length === 0;
  }

  get draftsEmptyMessage(): string {
    return this.draftsFilter
      ? `No ${this.draftsFilter.toLowerCase()} drafts.`
      : 'No drafts yet. Open an email and generate a reply.';
  }

  openDraft(draft: DraftSummary): void {
    this.router.navigate(['/draft', draft._id]);
  }

  isUnread(email: Email): boolean {
    return !!email.labels?.includes('UNREAD');
  }

  dismissGmailConnectError(): void {
    this.gmailConnectError = null;
  }

  connectGmail(): void {
    this.emailsError = null;
    this.gmailConnectError = null;
    this.authService.connectGmail().subscribe({
      error: (error) => {
        console.error('Failed to start Gmail connection:', error);
        this.emailsError = 'Could not start the Gmail connection. Please try again.';
      },
    });
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
    this.emailPlaceholders = placeholderRows(this.emails.length || DEFAULT_PLACEHOLDER_ROWS);
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
            // The backend found the Gmail grant expired/revoked and disconnected it.
            // Update the shared state so the top bar and this page show "Connect Gmail".
            this.emailsError = error.error?.error || 'Gmail access has expired. Please reconnect Gmail.';
            this.currentUser = { ...this.currentUser, googleConnected: false };
            this.authService.setGoogleConnected(false);
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
    this.draftsSubscription?.unsubscribe();
  }

  openEmailDetail(email: Email): void {
    this.router.navigate(['/email', email.gmailMessageId]);
  }
}
