import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { Observable, of, switchMap, tap } from 'rxjs';
import { DraftService } from '../services/draft.service';

interface Draft {
  _id: string;
  gmailMessageId: string;
  threadId: string;
  tone: string;
  draftBody: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Component({
    selector: 'app-draft-detail',
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        MatButtonModule,
        MatCardModule,
        MatToolbarModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatProgressSpinnerModule,
        MatDividerModule,
        MatDialogModule,
    ],
    templateUrl: './draft-detail.component.html',
    styleUrls: ['./draft-detail.component.css']
})
export class DraftDetailComponent implements OnInit {
  draft: Draft | null = null;
  editedContent: string = '';
  isLoading = true;
  readonly isSaving = signal(false);
  readonly isApproving = signal(false);
  readonly isRejecting = signal(false);
  readonly isSending = signal(false);
  /** Any action in flight: all action buttons and the editor are disabled. */
  readonly isBusy = computed(() => this.isSaving() || this.isApproving() || this.isRejecting() || this.isSending());
  /** Failure to load the draft (replaces the page content). */
  error: string | null = null;
  /** Failure of an action (save/approve/reject/send); the editor stays visible. */
  actionError: string | null = null;
  hasChanges = false;
  successMessage: string | null = null;
  /** Key for the current user send attempt; reused on retry until the send succeeds. */
  private sendIdempotencyKey: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private draftService: DraftService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      const draftId = params['id'];
      if (draftId) {
        this.fetchDraftDetail(draftId);
      }
    });
  }

  private fetchDraftDetail(draftId: string): void {
    this.isLoading = true;
    this.error = null;

    this.draftService.getDraftDetail(draftId).subscribe({
      next: (response) => {
        this.draft = response;
        this.editedContent = response.draftBody;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Failed to fetch draft:', error);
        this.error = error?.error?.error || 'Failed to load draft';
        this.isLoading = false;
      },
    });
  }

  onContentChange(): void {
    this.hasChanges = this.editedContent !== (this.draft?.draftBody || '');
  }

  saveDraft(): void {
    if (!this.draft || !this.hasChanges) {
      return;
    }

    this.isSaving.set(true);
    this.actionError = null;
    this.successMessage = null;

    this.saveIfChanged().subscribe({
      next: () => {
        this.isSaving.set(false);
        this.successMessage = 'Draft saved successfully!';
        setTimeout(() => (this.successMessage = null), 3000);
      },
      error: (error) => {
        console.error('Failed to save draft:', error);
        this.actionError = error?.error?.error || 'Failed to save draft';
        this.isSaving.set(false);
      },
    });
  }

  /**
   * Persist unsaved edits before an action that uses the stored/Gmail copy,
   * so what the user approves or sends is exactly what is on screen.
   */
  private saveIfChanged(): Observable<unknown> {
    if (!this.draft || !this.hasChanges) {
      return of(null);
    }
    return this.draftService.updateDraft(this.draft._id, this.editedContent).pipe(
      tap((updated: Draft) => {
        this.draft = updated;
        this.hasChanges = false;
      })
    );
  }

  approveDraft(): void {
    if (!this.draft) {
      return;
    }

    const draftId = this.draft._id;
    this.isApproving.set(true);
    this.actionError = null;
    this.successMessage = null;

    this.saveIfChanged()
      .pipe(switchMap(() => this.draftService.approveDraft(draftId)))
      .subscribe({
        next: (updated) => {
          this.draft = updated;
          this.isApproving.set(false);
          this.successMessage = 'Draft approved and saved to Gmail drafts. You can now send or edit further.';
        },
        error: (error) => {
          console.error('Failed to approve draft:', error);
          this.actionError =
            error?.error?.error || 'Failed to approve draft. Please confirm Gmail is connected and try again.';
          this.isApproving.set(false);
        },
      });
  }

  rejectDraft(): void {
    if (!this.draft) {
      return;
    }

    if (confirm('Are you sure you want to reject this draft?')) {
      this.isRejecting.set(true);
      this.actionError = null;
      this.successMessage = null;

      this.draftService.rejectDraft(this.draft._id).subscribe({
        next: (updated) => {
          this.draft = updated;
          this.isRejecting.set(false);
          this.successMessage = 'Draft rejected.';
          setTimeout(() => this.router.navigate(['/dashboard']), 2000);
        },
        error: (error) => {
          console.error('Failed to reject draft:', error);
          this.actionError = error?.error?.error || 'Failed to reject draft';
          this.isRejecting.set(false);
        },
      });
    }
  }

  sendDraft(): void {
    if (!this.draft) {
      return;
    }

    if (confirm('Are you sure you want to send this draft?')) {
      const draftId = this.draft._id;
      this.isSending.set(true);
      this.actionError = null;
      this.successMessage = null;

      // Reuse the key from a failed attempt so a retry can never double-send.
      const idempotencyKey = (this.sendIdempotencyKey ??= this.createIdempotencyKey(draftId));

      // Unsaved edits are saved (and synced to the Gmail draft) first, so the
      // message sent is the one on screen.
      this.saveIfChanged()
        .pipe(switchMap(() => this.draftService.sendDraft(draftId, idempotencyKey)))
        .subscribe({
          next: (updated) => {
            this.draft = updated;
            this.sendIdempotencyKey = null;
            this.isSending.set(false);
            this.successMessage = 'Draft sent successfully. Message ID: ' + updated.sentGmailMessageId;
            setTimeout(() => this.router.navigate(['/dashboard']), 2000);
          },
          error: (error) => {
            console.error('Failed to send draft:', error);
            this.actionError = 'Failed to send draft: ' + (error?.error?.error || error.message);
            this.isSending.set(false);
          },
        });
    }
  }

  private createIdempotencyKey(draftId: string): string {
    // randomUUID is unavailable outside secure contexts (e.g. plain http on a LAN IP).
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${draftId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  goBack(): void {
    if (this.hasChanges) {
      if (confirm('You have unsaved changes. Do you want to discard them?')) {
        this.router.navigate(['/dashboard']);
      }
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
