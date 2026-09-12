import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { PlansApi } from '../api/plans.api';
import { PlanInput, WorkPermitPlan } from '../types/permit';

@Injectable({ providedIn: 'root' })
export class PlansStore {
  private readonly api = inject(PlansApi);
  readonly plans = signal<WorkPermitPlan[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: response => { this.plans.set(response.data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  create(input: PlanInput) {
    return this.api.create(input).pipe(tap(response => this.plans.update(items => [response.data, ...items])));
  }

  update(id: number, input: Omit<PlanInput, 'plan_code'> & { version: number }) {
    return this.api.update(id, input).pipe(tap(response => this.replace(response.data)));
  }

  replace(plan: WorkPermitPlan): void {
    this.plans.update(items => items.map(item => item.id === plan.id ? plan : item));
  }
}
