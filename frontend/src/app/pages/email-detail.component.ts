import { Component, OnInit, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { DomSanitizer } from '@angular/platform-browser';
import { GmailService } from '../services/gmail.service';
import { DraftService } from '../services/draft.service';

interface Email {
  id: string;
  gmailMessageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  bodyPlain?: string;
  bodyHtml?: string;
  direction: string;
  internalDate: Date;
}

@Component({
    selector: 'app-email-detail',
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        MatButtonModule,
        MatCardModule,
        MatToolbarModule,
        MatIconModule,
        MatSelectModule,
        MatFormFieldModule,
        MatInputModule,
        MatProgressSpinnerModule,
        MatDividerModule,
    ],
    templateUrl: './email-detail.component.html',
    styleUrls: ['./email-detail.component.css']
})
export class EmailDetailComponent implements OnInit {
  email: Email | null = null;
  isLoading = true;
  isGenerating = false;
  selectedTone = 'formal';
  customContext = '';
  toneOptions = ['formal', 'concise', 'friendly'];
  /** Failure to load the email (replaces the page content). */
  error: string | null = null;
  /** Failure to generate a draft; the email stays visible. */
  actionError: string | null = null;
  /** The HTML body, sanitized once when the email loads. */
  safeBodyHtml: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private gmailService: GmailService,
    private draftService: DraftService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      const gmailMessageId = params['gmailMessageId'];
      if (gmailMessageId) {
        this.fetchEmailDetail(gmailMessageId);
      }
    });
  }

  private fetchEmailDetail(gmailMessageId: string): void {
    this.isLoading = true;
    this.error = null;

    this.gmailService.getEmailDetail(gmailMessageId).subscribe({
      next: (response) => {
        this.email = response;
        // Angular's sanitizer strips scripts and event handlers; doing it once
        // here avoids re-sanitizing on every change-detection pass.
        this.safeBodyHtml = response.bodyHtml
          ? this.sanitizer.sanitize(SecurityContext.HTML, response.bodyHtml)
          : null;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Failed to fetch email:', error);
        this.error = error?.error?.error || 'Failed to load email';
        this.isLoading = false;
      },
    });
  }

  generateDraft(): void {
    if (!this.email) {
      return;
    }

    this.isGenerating = true;
    this.actionError = null;

    this.draftService
      .generateThreadDraft(this.email.threadId, this.selectedTone, this.customContext || undefined)
      .subscribe({
        next: (draft: any) => {
          this.isGenerating = false;
          // Navigate to draft detail view
          this.router.navigate(['/draft', draft._id]);
        },
        error: (error) => {
          console.error('Failed to generate draft:', error);
          // e.g. 422 "This thread has no message from someone else to reply to."
          this.actionError = error?.error?.error || 'Failed to generate draft';
          this.isGenerating = false;
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
