import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { ActivityLog, ActivityService } from '../services/activity.service';
import { ACTIVITY_FILTERS, ActivityDescription, describeActivity } from '../shared/activity-format';
import { StateComponent } from '../shared/state.component';
import { TopBarComponent } from '../shared/top-bar.component';

export const ACTIVITY_PAGE_SIZE = 25;

export interface ActivityItem extends ActivityDescription {
  log: ActivityLog;
  /** Link to the draft the entry is about, if any. */
  draftLink: string[] | null;
}

/**
 * The user's activity history (GET /api/logs): drafts generated, edited,
 * approved, rejected, replaced and sent, newest first, with a filter by action
 * and paging.
 */
@Component({
  selector: 'app-activity',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    StateComponent,
    TopBarComponent,
  ],
  templateUrl: './activity.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ActivityComponent implements OnInit {
  readonly filters = ACTIVITY_FILTERS;
  readonly pageSize = ACTIVITY_PAGE_SIZE;

  items: ActivityItem[] = [];
  total = 0;
  pageIndex = 0;
  /** Selected action filter; '' shows everything. */
  action = '';
  isLoading = true;
  error: string | null = null;
  /** Only the latest request may update the page (filters can change quickly). */
  private requestId = 0;

  constructor(
    private activityService: ActivityService,
    private router: Router
  ) {}

  get filterLabel(): string {
    return this.filters.find((f) => f.value === this.action)?.label ?? 'All';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const requestId = ++this.requestId;
    this.isLoading = true;
    this.error = null;

    this.activityService
      .getActivity({ limit: this.pageSize, skip: this.pageIndex * this.pageSize, action: this.action || undefined })
      .subscribe({
        next: (page) => {
          if (requestId !== this.requestId) return;
          this.items = page.logs.map((log) => ({
            ...describeActivity(log),
            log,
            draftLink: log.entityType === 'Draft' && log.entityId ? ['/draft', log.entityId] : null,
          }));
          this.total = page.total;
          this.isLoading = false;
        },
        error: (error) => {
          if (requestId !== this.requestId) return;
          console.error('Failed to load activity:', error);
          this.error = error?.error?.error || 'Failed to load activity';
          this.isLoading = false;
        },
      });
  }

  /** Show one action only (or everything for ''), from the first page. */
  setFilter(action: string | null | undefined): void {
    const next = action ?? '';
    if (next === this.action) {
      return;
    }
    this.action = next;
    this.pageIndex = 0;
    this.load();
  }

  get isLastPage(): boolean {
    return (this.pageIndex + 1) * this.pageSize >= this.total;
  }

  /** e.g. "26–50 of 80" */
  get rangeLabel(): string {
    const first = this.pageIndex * this.pageSize + 1;
    const last = Math.min(this.total, first + this.items.length - 1);
    return `${first}–${last} of ${this.total}`;
  }

  goToPage(pageIndex: number): void {
    if (pageIndex < 0 || (pageIndex > this.pageIndex && this.isLastPage)) {
      return;
    }
    this.pageIndex = pageIndex;
    this.load();
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
