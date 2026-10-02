import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface EmailListOptions {
  label?: string;
  unread?: boolean;
  limit?: number;
  q?: string;
  pageToken?: string | null;
}

export interface EmailPage {
  emails: any[];
  nextPageToken: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class GmailService {
  private gmailApiUrl = 'api/gmail';

  constructor(private http: HttpClient) {}

  /**
   * Fetch one page of emails from Gmail.
   * `q` is Gmail search syntax; `pageToken` is Gmail's opaque token from a previous page.
   */
  fetchEmailPage(options?: EmailListOptions): Observable<EmailPage> {
    let url = `${this.gmailApiUrl}/emails`;
    // URLSearchParams (not HttpParams) so a literal '+' in a search is sent as %2B
    // instead of being decoded as a space by the server.
    const params = new URLSearchParams();

    if (options?.label) {
      params.append('label', options.label);
    }
    if (options?.unread) {
      params.append('unread', 'true');
    }
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options?.q?.trim()) {
      params.append('q', options.q.trim());
    }
    if (options?.pageToken) {
      params.append('pageToken', options.pageToken);
    }

    if (params.toString()) {
      url += '?' + params.toString();
    }

    return this.http.get<EmailPage>(url);
  }

  /**
   * Fetch the emails of one page, without the pagination token.
   */
  fetchEmails(options?: EmailListOptions): Observable<any[]> {
    return this.fetchEmailPage(options).pipe(map((page) => page.emails));
  }

  /**
   * Get a single email by ID
   */
  getEmail(gmailMessageId: string): Observable<any> {
    return this.http.get<any>(`${this.gmailApiUrl}/emails/${gmailMessageId}`);
  }

  /**
   * Get email detail (alias for getEmail)
   */
  getEmailDetail(gmailMessageId: string): Observable<any> {
    return this.getEmail(gmailMessageId);
  }

  /**
   * Revoke Gmail account access
   */
  revokeGmail(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.gmailApiUrl}/oauth/revoke`, {});
  }
}
