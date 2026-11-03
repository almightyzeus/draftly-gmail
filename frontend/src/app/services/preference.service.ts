import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type Tone = 'formal' | 'concise' | 'friendly';

export interface UserPreferences {
  defaultTone: Tone;
  signature: string;
  learningEmailCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class PreferenceService {
  private apiUrl = 'api/preferences';

  constructor(private http: HttpClient) {}

  getPreferences(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>(this.apiUrl);
  }

  /** Save preferences; fields left out keep their current value. Returns the stored preferences. */
  updatePreferences(changes: Partial<UserPreferences>): Observable<UserPreferences> {
    return this.http.put<UserPreferences>(this.apiUrl, changes);
  }
}
