import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DraftService {
  private draftsApiUrl = 'api/drafts';

  constructor(private http: HttpClient) {}

  /**
   * Generate a draft for an email
   */
  generateDraft(gmailMessageId: string, tone: string = 'formal'): Observable<any> {
    return this.http.post<any>(`${this.draftsApiUrl}/generate`, {
      gmailMessageId,
      tone,
    });
  }

  /**
   * Get draft detail
   */
  getDraftDetail(draftId: string): Observable<any> {
    return this.http.get<any>(`${this.draftsApiUrl}/${draftId}`);
  }

  /**
   * Get all drafts with optional filtering
   */
  getDrafts(status?: string, limit?: number): Observable<any[]> {
    let url = `${this.draftsApiUrl}`;
    const params = new URLSearchParams();

    if (status) {
      params.append('status', status);
    }
    if (limit) {
      params.append('limit', limit.toString());
    }

    if (params.toString()) {
      url += '?' + params.toString();
    }

    return this.http.get<any[]>(url);
  }

  /**
   * Update draft content
   */
  updateDraft(draftId: string, draftBody: string): Observable<any> {
    return this.http.put<any>(`${this.draftsApiUrl}/${draftId}`, {
      draftBody,
    });
  }

  /**
   * Approve a draft
   */
  approveDraft(draftId: string): Observable<any> {
    return this.http.post<any>(`${this.draftsApiUrl}/${draftId}/approve`, {});
  }

  /**
   * Reject a draft
   */
  rejectDraft(draftId: string): Observable<any> {
    return this.http.post<any>(`${this.draftsApiUrl}/${draftId}/reject`, {});
  }
}
