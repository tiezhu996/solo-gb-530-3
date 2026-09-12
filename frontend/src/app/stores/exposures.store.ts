import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { ExposuresApi } from '../api/exposures.api';
import { ExposureEntry, ExposureInput } from '../types/dose';

@Injectable({ providedIn: 'root' })
export class ExposuresStore {
  private readonly api = inject(ExposuresApi);
  readonly entries = signal<ExposureEntry[]>([]);
  readonly loading = signal(false);

  load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: response => { this.entries.set(response.data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  create(input: ExposureInput) {
    return this.api.create(input).pipe(tap(response => this.entries.update(items => [response.data, ...items])));
  }

  verify(id: number, quality: 'verified' | 'rejected', note: string) {
    return this.api.verify(id, quality, note).pipe(tap(response => this.replace(response.data)));
  }

  correct(id: number, sourceRef: string, replacementDose: number, occurredAt: string, note: string) {
    return this.api.correct(id, sourceRef, replacementDose, occurredAt, note).pipe(tap(response => {
      this.entries.update(items => [response.data.replacement, response.data.reversal, ...items]);
    }));
  }

  private replace(entry: ExposureEntry): void {
    this.entries.update(items => items.map(item => item.id === entry.id ? entry : item));
  }
}
