import { CanActivateFn, Router, Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AuthStore } from '../stores/auth.store';

const authGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  return auth.authenticated() ? true : inject(Router).createUrlTree(['/login']);
};

const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  return auth.authenticated() ? inject(Router).createUrlTree(['/workers']) : true;
};

const reviewGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  return auth.canReview() ? true : inject(Router).createUrlTree(['/budgets']);
};

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('../pages/login.page').then(module => module.LoginPage) },
  { path: 'workers', canActivate: [authGuard], loadComponent: () => import('../pages/workers.page').then(module => module.WorkersPage) },
  { path: 'plans', canActivate: [authGuard], loadComponent: () => import('../pages/plans.page').then(module => module.PlansPage) },
  { path: 'exposures', canActivate: [authGuard], loadComponent: () => import('../pages/exposures.page').then(module => module.ExposuresPage) },
  { path: 'budgets', canActivate: [authGuard], loadComponent: () => import('../pages/budgets.page').then(module => module.BudgetsPage) },
  { path: 'audit', canActivate: [authGuard, reviewGuard], loadComponent: () => import('../pages/audit.page').then(module => module.AuditPage) },
  { path: '', pathMatch: 'full', redirectTo: 'workers' },
  { path: '**', redirectTo: 'workers' },
];
