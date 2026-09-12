import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiEnvelope, LoginResponse } from '../types/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly root = '/api/v1';

  login(username: string, password: string): Observable<ApiEnvelope<LoginResponse>> {
    return this.http.post<ApiEnvelope<LoginResponse>>(`${this.root}/auth/login`, { username, password });
  }
}
