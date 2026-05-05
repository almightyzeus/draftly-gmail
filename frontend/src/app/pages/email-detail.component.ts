import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
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
  direction: string;
  internalDate: Date;
}

@Component({
  selector: 'app-email-detail',
  standalone: true,
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
    MatProgressSpinnerModule,
    MatDividerModule,
  ],
  templateUrl: './email-detail.component.html',
  styleUrls: ['./email-detail.component.css'],
})
export class EmailDetailComponent implements OnInit {
  email: Email | null = null;
  isLoading = true;
  isGenerating = false;
  selectedTone = 'formal';
  toneOptions = ['formal', 'concise', 'friendly'];
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private gmailService: GmailService,
    private draftService: DraftService
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

    this.gmailService.getEmailDetail(gmailMessageId).subscribe(
      (response) => {
        this.email = response;
        this.isLoading = false;
      },
      (error) => {
        console.error('Failed to fetch email:', error);
        this.error = 'Failed to load email';
        this.isLoading = false;
      }
    );
  }

  generateDraft(): void {
    if (!this.email) {
      return;
    }

    this.isGenerating = true;
    this.error = null;

    this.draftService
      .generateDraft(this.email.gmailMessageId, this.selectedTone)
      .subscribe(
        (draft: any) => {
          this.isGenerating = false;
          // Navigate to draft detail view
          this.router.navigate(['/draft', draft._id]);
        },
        (error) => {
          console.error('Failed to generate draft:', error);
          this.error = 'Failed to generate draft';
          this.isGenerating = false;
        }
      );
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
