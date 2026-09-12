import { inject } from '@angular/core';
import { BudgetStore } from '../stores/budget.store';

export function useBudgetAssessment(): BudgetStore {
  return inject(BudgetStore);
}
