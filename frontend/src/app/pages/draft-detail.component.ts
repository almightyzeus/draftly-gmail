import { Component, OnInit } from '@angular/core';
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
  isSaving = false;
  isApproving = false;
  isRejecting = false;
  isSending = false;
  error: string | null = null;
  hasChanges = false;
  successMessage: string | null = null;

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

    this.draftService.getDraftDetail(draftId).subscribe(
      (response) => {
        this.draft = response;
        this.editedContent = response.draftBody;
        this.isLoading = false;
      },
      (error) => {
        console.error('Failed to fetch draft:', error);
        this.error = 'Failed to load draft';
        this.isLoading = false;
      }
    );
  }

  onContentChange(): void {
    this.hasChanges = this.editedContent !== (this.draft?.draftBody || '');
  }

  saveDraft(): void {
    if (!this.draft || !this.hasChanges) {
      return;
    }

    this.isSaving = true;
    this.error = null;
    this.successMessage = null;

    this.draftService.updateDraft(this.draft._id, this.editedContent).subscribe(
      (updated) => {
        this.draft = updated;
        this.hasChanges = false;
        this.isSaving = false;
        this.successMessage = 'Draft saved successfully!';
        setTimeout(() => (this.successMessage = null), 3000);
      },
      (error) => {
        console.error('Failed to save draft:', error);
        this.error = 'Failed to save draft';
        this.isSaving = false;
      }
    );
  }

  approveDraft(): void {
    if (!this.draft) {
      return;
    }

    // Save any unsaved changes first
    if (this.hasChanges) {
      this.saveDraft();
    }

    this.isApproving = true;
    this.error = null;
    this.successMessage = null;

    this.draftService.approveDraft(this.draft._id).subscribe(
      (updated) => {
        this.draft = updated;
        this.isApproving = false;
        this.successMessage = 'Draft approved and saved to Gmail drafts. You can now send or edit further.';
        this.hasChanges = false;
      },
      (error) => {
        console.error('Failed to approve draft:', error);
        this.error = 'Failed to approve draft. Please confirm Gmail is connected and try again.';
        this.isApproving = false;
      }
    );
  }

  rejectDraft(): void {
    if (!this.draft) {
      return;
    }

    if (confirm('Are you sure you want to reject this draft?')) {
      this.isRejecting = true;
      this.error = null;
      this.successMessage = null;

      this.draftService.rejectDraft(this.draft._id).subscribe(
        (updated) => {
          this.draft = updated;
          this.isRejecting = false;
          this.successMessage = 'Draft rejected.';
          setTimeout(() => this.router.navigate(['/dashboard']), 2000);
        },
        (error) => {
          console.error('Failed to reject draft:', error);
          this.error = 'Failed to reject draft';
          this.isRejecting = false;
        }
      );
    }
  }

  sendDraft(): void {
    if (!this.draft) {
      return;
    }

    if (confirm('Are you sure you want to send this draft?')) {
      this.isSending = true;
      this.error = null;
      this.successMessage = null;

      // Generate idempotency key
      const idempotencyKey = `${this.draft._id}-${Date.now()}`;

      this.draftService.sendDraft(this.draft._id, idempotencyKey).subscribe(
        (updated) => {
          this.draft = updated;
          this.isSending = false;
          this.successMessage = 'Draft sent successfully. Message ID: ' + updated.sentGmailMessageId;
          setTimeout(() => this.router.navigate(['/dashboard']), 2000);
        },
        (error) => {
          console.error('Failed to send draft:', error);
          this.error = 'Failed to send draft: ' + (error?.error?.error || error.message);
          this.isSending = false;
        }
      );
    }
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
