import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { WorkersApi } from '../api/workers.api';
import { WorkerInput, WorkerProfile } from '../types/permit';

@Injectable({ providedIn: 'root' })
export class WorkersStore {
  private readonly api = inject(WorkersApi);
  readonly workers = signal<WorkerProfile[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: response => { this.workers.set(response.data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  create(input: WorkerInput) {
    return this.api.create(input).pipe(tap(response => this.workers.update(items => [...items, response.data])));
  }
}
