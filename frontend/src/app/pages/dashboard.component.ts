import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
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
        CommonModule,
        RouterModule,
        MatButtonModule,
        MatCardModule,
        MatToolbarModule,
        MatIconModule,
        MatMenuModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatDividerModule,
    ],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  currentUser: User | null = null;
  emails: Email[] = [];
  isLoadingEmails = false;
  emailsError: string | null = null;
  displayedColumns: string[] = ['from', 'subject', 'snippet', 'internalDate'];
  private isInitialLoad = true;

  constructor(
    private authService: AuthService,
    private gmailService: GmailService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      // Only fetch emails on initial load, not on every user$ update
      if (this.isInitialLoad && user?.googleConnected && this.emails.length === 0) {
        this.fetchEmails();
      } else if (!user?.googleConnected) {
        // Clear emails if Gmail is not connected
        this.emails = [];
        this.isLoadingEmails = false;
      }
    });

    // On component load, ensure we have the latest user data
    if (this.authService.isAuthenticated()) {
      this.authService.getMe().subscribe(
        (response) => {
          this.currentUser = response.user;
          if (response.user?.googleConnected && this.isInitialLoad && this.emails.length === 0) {
            this.fetchEmails();
            this.isInitialLoad = false;
          }
        },
        (error) => {
          // If getMe fails, it's likely a token issue - let the interceptor handle it
          console.error('Failed to fetch user data:', error);
          this.isInitialLoad = false;
        }
      );
    }
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  connectGmail(): void {
    this.authService.connectGmail();
  }

  disconnectGmail(): void {
    if (confirm('Are you sure you want to disconnect your Gmail account?')) {
      this.gmailService.revokeGmail().subscribe(
        () => {
          if (this.currentUser) {
            this.currentUser.googleConnected = false;
            this.emails = [];
          }
        },
        (error) => {
          console.error('Failed to disconnect Gmail:', error);
        }
      );
    }
  }

  fetchEmails(): void {
    if (!this.currentUser?.googleConnected) {
      this.emailsError = 'Gmail account not connected. Please connect Gmail first.';
      return;
    }

    this.isLoadingEmails = true;
    this.emailsError = null;

    this.gmailService.fetchEmails({ label: 'INBOX', limit: 20 }).subscribe(
      (emails) => {
        this.emails = emails;
        this.isLoadingEmails = false;
      },
      (error) => {
        console.error('Failed to fetch emails:', error);
        if (error.status === 401) {
          this.emailsError = 'Authentication failed. Please log in again.';
        } else if (error.error?.error === 'Gmail account not connected') {
          this.emailsError = 'Gmail account not properly connected. Try disconnecting and reconnecting.';
        } else {
          this.emailsError = error.error?.error || 'Failed to fetch emails. Please try again.';
        }
        this.isLoadingEmails = false;
      }
    );
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
