import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class GmailService {
  private gmailApiUrl = 'api/gmail';

  constructor(private http: HttpClient) {}

  /**
   * Fetch emails from Gmail
   */
  fetchEmails(options?: {
    label?: string;
    unread?: boolean;
    limit?: number;
  }): Observable<any[]> {
    let url = `${this.gmailApiUrl}/emails`;
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

    if (params.toString()) {
      url += '?' + params.toString();
    }

    return this.http.get<any[]>(url);
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
