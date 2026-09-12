import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope, PageEnvelope } from '../types/api';
import { DoseBudgetAssessment, ScenarioComparison } from '../types/dose';

@Injectable({ providedIn: 'root' })
export class AssessmentsApi {
  private readonly http = inject(HttpClient);
  private readonly root = '/api/v1/assessments';

  list() { return this.http.get<PageEnvelope<DoseBudgetAssessment>>(this.root, { params: { page_size: 100 } }); }
  assess(planId: number, periodEnd: string, version: number) {
    return this.http.post<ApiEnvelope<DoseBudgetAssessment>>(this.root, { plan_id: planId, period_end: periodEnd, version });
  }
  compare(planIds: number[], periodEnd: string) {
    return this.http.post<ApiEnvelope<ScenarioComparison>>(`${this.root}/compare`, { plan_ids: planIds, period_end: periodEnd });
  }
  submit(id: number, version: number) {
    return this.http.post<ApiEnvelope<DoseBudgetAssessment>>(`${this.root}/${id}/submit`, { version });
  }
  review(id: number, version: number, decision: 'accept' | 'reject', note: string) {
    return this.http.post<ApiEnvelope<DoseBudgetAssessment>>(`${this.root}/${id}/review`, { version, decision, note });
  }
}
