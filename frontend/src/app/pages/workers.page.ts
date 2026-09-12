import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { WorkersStore } from '../stores/workers.store';
import { useAuth } from '../hooks/use-auth';
import { SafetyBoundaryBannerComponent } from '../components/common/safety-boundary-banner.component';
import { apiErrorMessage } from '../utils/api-error';
import { ProfileStatus, WorkerInput } from '../types/permit';

@Component({
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, SafetyBoundaryBannerComponent,
  ],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Authorization context</span><h1>Worker dose profiles</h1><p>Minimum planning identity, configured limits and confirmed period totals.</p></div>
        <button *ngIf="auth.canPlan()" mat-flat-button color="primary" (click)="formOpen.set(!formOpen())">{{ formOpen() ? 'Close form' : 'Add profile' }}</button>
      </header>
      <app-safety-boundary-banner />
      <p class="error-banner" *ngIf="error()">{{ error() }}</p>
      <form *ngIf="formOpen()" class="inline-form" [formGroup]="form" (ngSubmit)="create()">
        <mat-form-field class="span-2" appearance="outline"><mat-label>Worker code</mat-label><input matInput formControlName="worker_code"></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Display name</mat-label><input matInput formControlName="display_name"></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Authorization level</mat-label><input matInput formControlName="authorization_level"></mat-form-field>
        <mat-form-field class="span-2" appearance="outline"><mat-label>Administrative mSv</mat-label><input matInput type="number" step="0.1" formControlName="administrative_limit_msv"></mat-form-field>
        <mat-form-field class="span-2" appearance="outline"><mat-label>Annual legal mSv</mat-label><input matInput type="number" step="0.1" formControlName="annual_limit_msv"></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Period start</mat-label><input matInput type="date" formControlName="period_start"></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Profile status</mat-label><mat-select formControlName="profile_status"><mat-option value="active">Active</mat-option><mat-option value="suspended">Suspended</mat-option><mat-option value="archived">Archived</mat-option></mat-select></mat-form-field>
        <div class="span-6 form-actions"><button mat-button type="button" (click)="formOpen.set(false)">Cancel</button><button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || saving()">{{ saving() ? 'Saving' : 'Create profile' }}</button></div>
      </form>
      <section class="metric-strip">
        <div class="metric"><strong>{{ store.workers().length }}</strong><span>Profiles</span></div>
        <div class="metric"><strong>{{ activeCount }}</strong><span>Active</span></div>
        <div class="metric"><strong>{{ totalDose | number:'1.3-3' }}</strong><span>Confirmed mSv</span></div>
      </section>
      <div class="section-title"><h2>Current authorization set</h2><span>Period totals use verified records only</span></div>
      <div class="surface">
        <table class="data-table">
          <thead><tr><th>Worker</th><th>Authorization</th><th>Status</th><th>Period dose</th><th>Admin margin</th><th>Legal margin</th><th>Period start</th></tr></thead>
          <tbody>
            <tr *ngFor="let worker of store.workers()">
              <td><strong>{{ worker.display_name }}</strong><br><span class="code muted">{{ worker.worker_code }}</span></td>
              <td>{{ worker.authorization_level }}</td>
              <td><span class="status" [class.warn]="worker.profile_status !== 'active'">{{ worker.profile_status }}</span></td>
              <td class="number">{{ worker.period_dose_msv | number:'1.3-3' }} mSv</td>
              <td class="number">{{ worker.remaining_admin_msv | number:'1.3-3' }} mSv</td>
              <td class="number">{{ worker.remaining_legal_msv | number:'1.3-3' }} mSv</td>
              <td>{{ worker.period_start | date:'mediumDate':'UTC' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="empty" *ngIf="!store.loading() && !store.workers().length">No worker profiles match the current planning set.</div>
      </div>
    </div>
  `,
  styles: [`
    .number { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .status { display: inline-block; padding: 3px 8px; background: #e3eee9; color: #185847; border-radius: 3px; font-size: 11px; font-weight: 700; text-transform: capitalize; }
    .status.warn { background: #fff0ce; color: #7b5109; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkersPage implements OnInit {
  readonly store = inject(WorkersStore);
  readonly auth = useAuth();
  private readonly builder = new FormBuilder().nonNullable;
  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly form = this.builder.group({
    worker_code: ['RP-', [Validators.required, Validators.minLength(2)]],
    display_name: ['', [Validators.required, Validators.minLength(2)]],
    authorization_level: ['Controlled area L2', Validators.required],
    administrative_limit_msv: [12, [Validators.required, Validators.min(0.001)]],
    annual_limit_msv: [20, [Validators.required, Validators.min(0.001)]],
    profile_status: ['active' as ProfileStatus, Validators.required],
    period_start: [`${new Date().getFullYear()}-01-01`, Validators.required],
  });

  ngOnInit(): void { this.store.load(); }
  get activeCount(): number { return this.store.workers().filter(item => item.profile_status === 'active').length; }
  get totalDose(): number { return this.store.workers().reduce((sum, item) => sum + item.period_dose_msv, 0); }

  create(): void {
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    const input: WorkerInput = { ...value, period_start: new Date(`${value.period_start}T00:00:00Z`).toISOString() };
    this.saving.set(true); this.error.set('');
    this.store.create(input).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.formOpen.set(false); this.form.reset({ ...value, worker_code: 'RP-', display_name: '' }); },
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }
}
