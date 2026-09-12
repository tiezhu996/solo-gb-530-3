import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { AssessmentsApi } from '../api/assessments.api';
import { DoseBudgetAssessment, ScenarioComparison } from '../types/dose';

@Injectable({ providedIn: 'root' })
export class BudgetStore {
  private readonly api = inject(AssessmentsApi);
  readonly assessments = signal<DoseBudgetAssessment[]>([]);
  readonly comparison = signal<ScenarioComparison | null>(null);
  readonly selected = signal<DoseBudgetAssessment | null>(null);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: response => {
        this.assessments.set(response.data);
        if (!this.selected() && response.data.length) this.selected.set(response.data[0]);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  assess(planId: number, periodEnd: string, version: number) {
    return this.api.assess(planId, periodEnd, version).pipe(tap(response => {
      this.assessments.update(items => [response.data, ...items]);
      this.selected.set(response.data);
    }));
  }

  compare(planIds: number[], periodEnd: string) {
    return this.api.compare(planIds, periodEnd).pipe(tap(response => this.comparison.set(response.data)));
  }

  submit(id: number, version: number) {
    return this.api.submit(id, version).pipe(tap(response => this.replace(response.data)));
  }

  review(id: number, version: number, decision: 'accept' | 'reject', note: string) {
    return this.api.review(id, version, decision, note).pipe(tap(response => this.replace(response.data)));
  }

  select(assessment: DoseBudgetAssessment): void { this.selected.set(assessment); }

  private replace(assessment: DoseBudgetAssessment): void {
    this.assessments.update(items => items.map(item => item.id === assessment.id ? assessment : item));
    this.selected.set(assessment);
  }
}
