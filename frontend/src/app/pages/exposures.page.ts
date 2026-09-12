import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { ExposuresStore } from '../stores/exposures.store';
import { WorkersStore } from '../stores/workers.store';
import { useAuth } from '../hooks/use-auth';
import { apiErrorMessage, inputToUTC, utcNowInput } from '../utils/api-error';
import { ExposureEntry, ExposureInput } from '../types/dose';

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Immutable source ledger</span><h1>Confirmed exposure records</h1><p>New facts, quality review and correction chains remain independently traceable.</p></div>
        <button *ngIf="auth.canPlan()" mat-flat-button color="primary" (click)="entryFormOpen.set(!entryFormOpen())">{{ entryFormOpen() ? 'Close form' : 'Record exposure' }}</button>
      </header>
      <p class="notice-banner">Original values are never overwritten. A correction creates a verified reversal and replacement linked to the source record.</p>
      <p class="error-banner" *ngIf="error()">{{ error() }}</p>
      <form *ngIf="entryFormOpen()" class="inline-form" [formGroup]="entryForm" (ngSubmit)="create()">
        <mat-form-field class="span-3" appearance="outline"><mat-label>Worker</mat-label><mat-select formControlName="worker_id"><mat-option *ngFor="let worker of workers.workers()" [value]="worker.id">{{ worker.worker_code }} · {{ worker.display_name }}</mat-option></mat-select></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Source reference</mat-label><input matInput formControlName="source_ref"></mat-form-field>
        <mat-form-field class="span-2" appearance="outline"><mat-label>Dose mSv</mat-label><input matInput type="number" min="0" step="0.001" formControlName="dose_msv"></mat-form-field>
        <mat-form-field class="span-4" appearance="outline"><mat-label>Occurred at</mat-label><input matInput type="datetime-local" formControlName="occurred_at"></mat-form-field>
        <mat-form-field class="span-8" appearance="outline"><mat-label>Source note</mat-label><input matInput formControlName="note"></mat-form-field>
        <div class="span-4 form-actions"><button mat-button type="button" (click)="entryFormOpen.set(false)">Cancel</button><button mat-flat-button color="primary" type="submit" [disabled]="entryForm.invalid || saving()">{{ saving() ? 'Recording' : 'Record pending entry' }}</button></div>
      </form>
      <form *ngIf="correctionTarget()" class="correction-strip" [formGroup]="correctionForm" (ngSubmit)="correct()">
        <div class="correction-title"><span class="eyebrow">Correct source #{{ correctionTarget()?.id }}</span><strong>{{ correctionTarget()?.source_ref }} · {{ correctionTarget()?.dose_msv | number:'1.3-3' }} mSv</strong></div>
        <mat-form-field appearance="outline"><mat-label>Replacement reference</mat-label><input matInput formControlName="source_ref"></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Replacement mSv</mat-label><input matInput type="number" min="0" step="0.001" formControlName="replacement_dose_msv"></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Occurred at</mat-label><input matInput type="datetime-local" formControlName="occurred_at"></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Correction rationale</mat-label><input matInput formControlName="note"></mat-form-field>
        <div class="form-actions"><button mat-button type="button" (click)="correctionTarget.set(null)">Cancel</button><button mat-flat-button color="primary" type="submit" [disabled]="correctionForm.invalid || saving()">Create chain</button></div>
      </form>
      <div class="section-title"><h2>Exposure ledger</h2><span>{{ exposures.entries().length }} immutable entries</span></div>
      <div class="surface">
        <table class="data-table">
          <thead><tr><th>Source</th><th>Worker</th><th>Occurred</th><th>Dose</th><th>Type / link</th><th>Quality</th><th>Actions</th></tr></thead>
          <tbody>
            <tr *ngFor="let entry of exposures.entries()" [class.selected]="correctionTarget()?.id === entry.id">
              <td><strong class="code">{{ entry.source_ref }}</strong><br><span class="muted">{{ entry.note }}</span></td>
              <td>{{ entry.worker_name }}<br><span class="code muted">{{ entry.worker_code }}</span></td>
              <td>{{ entry.occurred_at | date:'medium':'UTC' }}</td>
              <td class="number" [class.negative]="entry.dose_msv < 0">{{ entry.dose_msv | number:'1.3-3' }} mSv</td>
              <td><span class="entry-type">{{ entry.entry_type }}</span><br><span *ngIf="entry.correction_of_id" class="code muted">corrects #{{ entry.correction_of_id }}</span></td>
              <td><span class="quality" [attr.data-quality]="entry.quality_flag">{{ entry.quality_flag }}</span></td>
              <td class="actions">
                <button *ngIf="auth.canReview() && entry.quality_flag === 'pending'" mat-button (click)="verify(entry, 'verified')">Verify</button>
                <button *ngIf="auth.canReview() && entry.quality_flag === 'pending'" mat-button color="warn" (click)="verify(entry, 'rejected')">Reject</button>
                <button *ngIf="auth.canReview() && entry.quality_flag === 'verified'" mat-button (click)="openCorrection(entry)">Correct</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .correction-strip { display: grid; grid-template-columns: 1.3fr repeat(3, minmax(150px, 1fr)) 1.4fr auto; gap: 12px; align-items: start; padding: 18px; background: #fff3c9; border: 1px solid #d8b75c; }
    .correction-title { padding-top: 8px; } .correction-title strong { display: block; font-size: 13px; }
    .number { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 700; } .negative { color: #8c2929; }
    .entry-type { font-size: 11px; text-transform: capitalize; }
    .quality { display: inline-flex; padding: 3px 7px; border: 1px solid #d6b262; border-radius: 3px; background: #fff1ca; color: #76510b; font-size: 10px; font-weight: 800; }
    .quality[data-quality="verified"] { border-color: #8eb8a8; background: #e5f1eb; color: #185847; }
    .quality[data-quality="rejected"] { border-color: #d89591; background: #f8dfde; color: #8c2929; }
    .actions { white-space: nowrap; }
    @media (max-width: 1180px) { .correction-strip { grid-template-columns: 1fr 1fr; } .correction-title, .correction-strip .form-actions { grid-column: 1 / -1; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExposuresPage implements OnInit {
  readonly exposures = inject(ExposuresStore);
  readonly workers = inject(WorkersStore);
  readonly auth = useAuth();
  private readonly builder = new FormBuilder().nonNullable;
  readonly entryFormOpen = signal(false);
  readonly correctionTarget = signal<ExposureEntry | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly entryForm = this.builder.group({
    worker_id: [0, [Validators.required, Validators.min(1)]],
    source_ref: ['', [Validators.required, Validators.minLength(3)]],
    occurred_at: [utcNowInput(), Validators.required],
    dose_msv: [0, [Validators.required, Validators.min(0)]],
    note: ['', Validators.maxLength(500)],
  });
  readonly correctionForm = this.builder.group({
    source_ref: ['', [Validators.required, Validators.minLength(3)]],
    replacement_dose_msv: [0, [Validators.required, Validators.min(0)]],
    occurred_at: [utcNowInput(), Validators.required],
    note: ['', [Validators.required, Validators.minLength(3)]],
  });

  ngOnInit(): void { this.workers.load(); this.exposures.load(); }

  create(): void {
    if (this.entryForm.invalid) return;
    const raw = this.entryForm.getRawValue();
    const input: ExposureInput = { ...raw, occurred_at: inputToUTC(raw.occurred_at) };
    this.saving.set(true); this.error.set('');
    this.exposures.create(input).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.entryFormOpen.set(false); this.entryForm.patchValue({ source_ref: '', dose_msv: 0, note: '', occurred_at: utcNowInput() }); },
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }

  verify(entry: ExposureEntry, quality: 'verified' | 'rejected'): void {
    this.error.set('');
    this.exposures.verify(entry.id, quality, quality === 'verified' ? 'Independent source review completed' : 'Source rejected during independent review').subscribe({
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }

  openCorrection(entry: ExposureEntry): void {
    this.correctionTarget.set(entry);
    this.correctionForm.setValue({
      source_ref: `${entry.source_ref}-C`, replacement_dose_msv: Math.max(0, entry.dose_msv),
      occurred_at: utcNowInput(), note: '',
    });
  }

  correct(): void {
    const target = this.correctionTarget();
    if (!target || this.correctionForm.invalid) return;
    const raw = this.correctionForm.getRawValue();
    this.saving.set(true); this.error.set('');
    this.exposures.correct(target.id, raw.source_ref, raw.replacement_dose_msv, inputToUTC(raw.occurred_at), raw.note)
      .pipe(finalize(() => this.saving.set(false))).subscribe({
        next: () => this.correctionTarget.set(null),
        error: error => this.error.set(apiErrorMessage(error)),
      });
  }
}
