import { Component, OnInit, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, filter, of, switchMap, tap } from 'rxjs';
import { DraftService } from '../services/draft.service';
import { AuthService } from '../services/auth.service';
import { ConfirmService } from '../shared/confirm.service';
import { TopBarComponent } from '../shared/top-bar.component';
import { BusyOverlayComponent } from '../shared/busy-overlay.component';

interface Draft {
  _id: string;
  gmailMessageId: string | string[];
  threadId: string;
  tone: string;
  draftBody: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT';
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date | null;
  /** The sender and subject of the email being answered (from the API). */
  replyTo?: { from: string; subject: string } | null;
  /** Exactly who the reply goes to (Reply-To aware; Cc only with reply all). */
  recipients?: { to: string[]; cc: string[] } | null;
  replyAll?: boolean;
  /** The original email has other recipients that reply all would copy. */
  canReplyAll?: boolean;
}

@Component({
  selector: 'app-draft-detail',
  imports: [
    DatePipe,
    TitleCasePipe,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    TopBarComponent,
    BusyOverlayComponent,
  ],
  templateUrl: './draft-detail.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./draft-detail.component.css'],
})
export class DraftDetailComponent implements OnInit {
  draft: Draft | null = null;
  editedContent: string = '';
  isLoading = true;
  readonly isSaving = signal(false);
  readonly isApproving = signal(false);
  readonly isRejecting = signal(false);
  readonly isSending = signal(false);
  readonly isUpdatingRecipients = signal(false);
  /** Any action in flight: all action buttons and the editor are disabled. */
  readonly isBusy = computed(
    () => this.isSaving() || this.isApproving() || this.isRejecting() || this.isSending() || this.isUpdatingRecipients()
  );
  /** Text of the page overlay shown while an action runs. */
  readonly busyMessage = computed(() => {
    if (this.isSending()) return 'Sending reply…';
    if (this.isApproving()) return 'Approving and saving to Gmail…';
    if (this.isRejecting()) return 'Rejecting draft…';
    if (this.isSaving()) return 'Saving changes…';
    if (this.isUpdatingRecipients()) return 'Updating recipients…';
    return '';
  });
  /** Failure to load the draft (replaces the page content). */
  error: string | null = null;
  /** Failure of an action (save/approve/reject/send); the editor stays visible. */
  actionError: string | null = null;
  hasChanges = false;
  /** Key for the current user send attempt; reused on retry until the send succeeds. */
  private sendIdempotencyKey: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private draftService: DraftService,
    private confirmService: ConfirmService,
    private snackBar: MatSnackBar,
    private authService: AuthService
  ) {}

  /** The To line: the API's recipients, or the original sender for older responses. */
  get toLine(): string {
    return this.draft?.recipients?.to.join(', ') || this.draft?.replyTo?.from || '';
  }

  get ccList(): string[] {
    return this.draft?.recipients?.cc ?? [];
  }

  /** Only PENDING and APPROVED drafts can still be edited or acted on. */
  get isEditable(): boolean {
    return this.draft?.status === 'PENDING' || this.draft?.status === 'APPROVED';
  }

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

    this.saveIfChanged().subscribe({
      next: () => {
        this.isSaving.set(false);
        this.notify('Draft saved.');
      },
      error: (error) => {
        console.error('Failed to save draft:', error);
        this.noteGmailAccessLost(error);
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

  /**
   * Switch between replying to the sender and reply all. Unsaved body edits
   * stay in the editor. On failure the toggle flips back.
   */
  toggleReplyAll(replyAll: boolean, toggle?: { checked: boolean }): void {
    if (!this.draft) {
      return;
    }

    this.isUpdatingRecipients.set(true);
    this.actionError = null;

    this.draftService.setReplyAll(this.draft._id, replyAll).subscribe({
      next: (updated: Draft) => {
        this.draft = updated;
        this.onContentChange();
        this.isUpdatingRecipients.set(false);
        this.notify(replyAll ? 'Reply all: everyone on the email is copied.' : 'Replying to the sender only.');
      },
      error: (error) => {
        console.error('Failed to change recipients:', error);
        this.noteGmailAccessLost(error);
        this.actionError = error?.error?.error || 'Failed to change the recipients';
        if (toggle) {
          toggle.checked = !replyAll;
        }
        this.isUpdatingRecipients.set(false);
      },
    });
  }

  approveDraft(): void {
    if (!this.draft) {
      return;
    }

    const draftId = this.draft._id;
    this.isApproving.set(true);
    this.actionError = null;

    this.saveIfChanged()
      .pipe(switchMap(() => this.draftService.approveDraft(draftId)))
      .subscribe({
        next: (updated) => {
          this.draft = updated;
          this.isApproving.set(false);
          this.notify('Approved and saved to your Gmail drafts. You can still edit it, or send it.');
        },
        error: (error) => {
          console.error('Failed to approve draft:', error);
          this.noteGmailAccessLost(error);
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
    const draft = this.draft;

    this.confirmService
      .confirm({
        title: draft.status === 'APPROVED' ? 'Withdraw this approved reply?' : 'Reject this draft?',
        message:
          draft.status === 'APPROVED'
            ? 'It will not be sent, and its copy is removed from your Gmail drafts.'
            : 'The draft will be marked rejected and cannot be sent.',
        confirmText: 'Reject',
        tone: 'warn',
      })
      .pipe(
        filter(Boolean),
        tap(() => {
          this.isRejecting.set(true);
          this.actionError = null;
        }),
        switchMap(() => this.draftService.rejectDraft(draft._id))
      )
      .subscribe({
        next: (updated) => {
          this.draft = updated;
          this.isRejecting.set(false);
          this.notify('Draft rejected.');
          this.backToDrafts();
        },
        error: (error) => {
          console.error('Failed to reject draft:', error);
          this.noteGmailAccessLost(error);
          this.actionError = error?.error?.error || 'Failed to reject draft';
          this.isRejecting.set(false);
        },
      });
  }

  sendDraft(): void {
    if (!this.draft) {
      return;
    }
    const draftId = this.draft._id;
    const recipient = this.toLine;
    const cc = this.ccList.length ? ` (Cc: ${this.ccList.join(', ')})` : '';

    this.confirmService
      .confirm({
        title: 'Send this reply?',
        message: recipient
          ? `It will be sent to ${recipient}${cc} from your Gmail account.`
          : 'It will be sent from your Gmail account.',
        confirmText: 'Send',
      })
      .pipe(filter(Boolean))
      .subscribe(() => {
        this.isSending.set(true);
        this.actionError = null;

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
              this.notify('Reply sent.');
              this.backToDrafts();
            },
            error: (error) => {
              console.error('Failed to send draft:', error);
              this.noteGmailAccessLost(error);
              this.actionError = 'Failed to send draft: ' + (error?.error?.error || error.message);
              this.isSending.set(false);
            },
          });
      });
  }

  private createIdempotencyKey(draftId: string): string {
    // randomUUID is unavailable outside secure contexts (e.g. plain http on a LAN IP).
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${draftId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  goBack(): void {
    if (!this.hasChanges) {
      this.backToDrafts();
      return;
    }
    this.confirmService
      .confirm({
        title: 'Discard unsaved changes?',
        message: 'Your edits to this draft have not been saved.',
        confirmText: 'Discard',
        tone: 'warn',
      })
      .pipe(filter(Boolean))
      .subscribe(() => this.backToDrafts());
  }

  private backToDrafts(): void {
    this.router.navigate(['/dashboard'], { queryParams: { tab: 'drafts' } });
  }

  /**
   * A 403 from a draft action means the backend found the Gmail grant expired
   * or revoked and disconnected it. Update the shared user state so the top
   * bar (and the dashboard) switch to "Connect Gmail" right away.
   */
  private noteGmailAccessLost(error: any): void {
    if (error?.status === 403) {
      this.authService.setGoogleConnected(false);
    }
  }

  private notify(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 4000 });
  }
}
