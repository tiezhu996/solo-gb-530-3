import { Injectable, computed, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { Router } from '@angular/router';
import { ApiService } from '../api/api.service';
import { LoginResponse, UserView } from '../types/api';

const STORAGE_KEY = 'alara-ledger-session';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = signal<LoginResponse | null>(this.restore());

  readonly user = computed<UserView | null>(() => this.session()?.user ?? null);
  readonly authenticated = computed(() => Boolean(this.session()?.token));
  readonly canPlan = computed(() => ['planner', 'admin'].includes(this.user()?.role ?? ''));
  readonly canReview = computed(() => ['rpo_reviewer', 'admin'].includes(this.user()?.role ?? ''));

  token(): string { return this.session()?.token ?? ''; }

  login(username: string, password: string) {
    return this.api.login(username, password).pipe(tap((response) => {
      this.session.set(response.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(response.data));
    }));
  }

  logout(): void {
    this.session.set(null);
    localStorage.removeItem(STORAGE_KEY);
    void this.router.navigateByUrl('/login');
  }

  private restore(): LoginResponse | null {
    try {
      const encoded = localStorage.getItem(STORAGE_KEY);
      if (!encoded) return null;
      const value = JSON.parse(encoded) as LoginResponse;
      if (new Date(value.expires_at).getTime() <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return value;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }
}
