import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope, PageEnvelope } from '../types/api';
import { WorkerInput, WorkerProfile } from '../types/permit';

@Injectable({ providedIn: 'root' })
export class WorkersApi {
  private readonly http = inject(HttpClient);
  private readonly root = '/api/v1/workers';

  list() { return this.http.get<PageEnvelope<WorkerProfile>>(this.root, { params: { page_size: 100 } }); }
  get(id: number) { return this.http.get<ApiEnvelope<WorkerProfile>>(`${this.root}/${id}`); }
  create(input: WorkerInput) { return this.http.post<ApiEnvelope<WorkerProfile>>(this.root, input); }
  update(id: number, input: Omit<WorkerInput, 'worker_code' | 'period_start'> & { version: number }) {
    return this.http.put<ApiEnvelope<WorkerProfile>>(`${this.root}/${id}`, input);
  }
}
