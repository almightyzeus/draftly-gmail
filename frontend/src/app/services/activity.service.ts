import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ActivityLog {
  _id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  level: 'info' | 'warn' | 'error';
  meta?: Record<string, any> | null;
  createdAt: string;
}

export interface ActivityPage {
  logs: ActivityLog[];
  /** All matching logs, not just this page. */
  total: number;
}

@Injectable({
  providedIn: 'root',
})
export class ActivityService {
  private apiUrl = 'api/logs';

  constructor(private http: HttpClient) {}

  /** One page of the user's activity, newest first, optionally one action only. */
  getActivity(options: { limit: number; skip: number; action?: string }): Observable<ActivityPage> {
    return this.http.get<ActivityPage>(this.apiUrl, {
      params: {
        limit: String(options.limit),
        skip: String(options.skip),
        ...(options.action && { action: options.action }),
      },
    });
  }
}
