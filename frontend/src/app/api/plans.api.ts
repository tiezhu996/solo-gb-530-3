import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope, PageEnvelope } from '../types/api';
import { PlanInput, WorkPermitPlan } from '../types/permit';

@Injectable({ providedIn: 'root' })
export class PlansApi {
  private readonly http = inject(HttpClient);
  private readonly root = '/api/v1/plans';

  list() { return this.http.get<PageEnvelope<WorkPermitPlan>>(this.root, { params: { page_size: 100 } }); }
  get(id: number) { return this.http.get<ApiEnvelope<WorkPermitPlan>>(`${this.root}/${id}`); }
  create(input: PlanInput) { return this.http.post<ApiEnvelope<WorkPermitPlan>>(this.root, input); }
  update(id: number, input: Omit<PlanInput, 'plan_code'> & { version: number }) {
    return this.http.put<ApiEnvelope<WorkPermitPlan>>(`${this.root}/${id}`, input);
  }
  archive(id: number, version: number) {
    return this.http.post<ApiEnvelope<WorkPermitPlan>>(`${this.root}/${id}/archive`, { version });
  }
}
