import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuditEvent, PageEnvelope } from '../types/api';

@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);
  list() { return this.http.get<PageEnvelope<AuditEvent>>('/api/v1/audit', { params: { page_size: 100 } }); }
}
