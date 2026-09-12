import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { PlansStore } from '../stores/plans.store';
import { WorkersStore } from '../stores/workers.store';
import { useAuth } from '../hooks/use-auth';
import { SafetyBoundaryBannerComponent } from '../components/common/safety-boundary-banner.component';
import { apiErrorMessage } from '../utils/api-error';
import { PlanInput, WorkPermitPlan } from '../types/permit';

@Component({
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, SafetyBoundaryBannerComponent,
  ],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Dose assumption register</span><h1>Work plan scenarios</h1><p>Edit rate, duration and controls before generating an immutable assessment.</p></div>
        <button *ngIf="auth.canPlan()" mat-flat-button color="primary" (click)="newPlan()">{{ formOpen() ? 'Reset form' : 'New scenario' }}</button>
      </header>
      <app-safety-boundary-banner title="Planning scenario, not a permit" detail="An accepted scenario still requires the site's independent work authorization process and qualified RPO judgment." />
      <p class="error-banner" *ngIf="error()">{{ error() }}</p>
      <form *ngIf="formOpen()" class="inline-form" [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field class="span-2" appearance="outline"><mat-label>Plan code</mat-label><input matInput formControlName="plan_code" [readonly]="!!editing()"></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Worker</mat-label><mat-select formControlName="worker_id"><mat-option *ngFor="let worker of activeWorkers()" [value]="worker.id">{{ worker.worker_code }} · {{ worker.display_name }}</mat-option></mat-select></mat-form-field>
        <mat-form-field class="span-3" appearance="outline"><mat-label>Work area</mat-label><input matInput formControlName="work_area"></mat-form-field>
        <mat-form-field class="span-2" appearance="outline"><mat-label>Dose rate mSv/h</mat-label><input matInput type="number" min="0" step="0.01" formControlName="estimated_rate_msvh"></mat-form-field>
        <mat-form-field class="span-2" appearance="outline"><mat-label>Minutes</mat-label><input matInput type="number" min="1" formControlName="planned_minutes"></mat-form-field>
        <mat-form-field class="span-4" appearance="outline"><mat-label>Task category</mat-label><input matInput formControlName="task_category"></mat-form-field>
        <mat-form-field class="span-6" appearance="outline"><mat-label>Controls, separated by commas</mat-label><textarea matInput rows="2" formControlName="controls"></textarea></mat-form-field>
        <div class="span-2 preview"><strong>{{ projectedPreview | number:'1.3-3' }}</strong><span>planned mSv</span></div>
        <div class="span-12 form-actions"><button mat-button type="button" (click)="closeForm()">Cancel</button><button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || saving()">{{ saving() ? 'Saving' : editing() ? 'Update draft' : 'Create draft' }}</button></div>
      </form>
      <div class="section-title"><h2>Scenario register</h2><span>{{ plans.plans().length }} plans · select a draft to edit</span></div>
      <div class="surface">
        <table class="data-table">
          <thead><tr><th>Plan</th><th>Worker</th><th>Area / task</th><th>Assumption</th><th>Controls</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let plan of plans.plans()" [class.selected]="editing()?.id === plan.id">
              <td><strong>{{ plan.plan_code }}</strong><br><span class="code muted">v{{ plan.version }}</span></td>
              <td>{{ plan.worker_name }}<br><span class="code muted">{{ plan.worker_code }}</span></td>
              <td>{{ plan.work_area }}<br><span class="muted">{{ plan.task_category }}</span></td>
              <td class="number">{{ plan.estimated_rate_msvh | number:'1.2-3' }} mSv/h × {{ plan.planned_minutes }} min<br><strong>{{ plan.projected_dose_msv | number:'1.3-3' }} mSv</strong></td>
              <td><span class="control" *ngFor="let control of plan.controls">{{ control }}</span></td>
              <td><span class="plan-status" [attr.data-status]="plan.permit_status">{{ statusLabel(plan.permit_status) }}</span></td>
              <td><button *ngIf="auth.canPlan() && plan.permit_status === 'draft'" mat-button (click)="edit(plan)">Edit</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .preview { min-height: 56px; display: flex; flex-direction: column; justify-content: center; padding: 0 12px; border-left: 3px solid #c47d10; }
    .preview strong { font-size: 20px; font-variant-numeric: tabular-nums; } .preview span { color: var(--muted); font-size: 10px; text-transform: uppercase; }
    .number { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .control { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 6px; background: #e7ece7; border-radius: 2px; font-size: 10px; }
    .plan-status { display: inline-flex; padding: 3px 7px; border: 1px solid #b6c2ba; border-radius: 3px; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .plan-status[data-status="pending_rpo_review"] { color: #76510b; border-color: #d6b262; background: #fff1ca; }
    .plan-status[data-status="planning_accepted"] { color: #185847; border-color: #8eb8a8; background: #e5f1eb; }
    .plan-status[data-status="rejected"] { color: #8c2929; border-color: #d89591; background: #f8dfde; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlansPage implements OnInit {
  readonly plans = inject(PlansStore);
  readonly workers = inject(WorkersStore);
  readonly auth = useAuth();
  private readonly builder = new FormBuilder().nonNullable;
  readonly editing = signal<WorkPermitPlan | null>(null);
  readonly formOpen = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly activeWorkers = computed(() => this.workers.workers().filter(worker => worker.profile_status === 'active'));
  readonly form = this.builder.group({
    plan_code: ['ALARA-', [Validators.required, Validators.minLength(3)]],
    worker_id: [0, [Validators.required, Validators.min(1)]],
    work_area: ['', [Validators.required, Validators.minLength(2)]],
    task_category: ['', [Validators.required, Validators.minLength(2)]],
    estimated_rate_msvh: [0.1, [Validators.required, Validators.min(0)]],
    planned_minutes: [30, [Validators.required, Validators.min(1), Validators.max(1440)]],
    controls: ['time limit, distance markers', Validators.required],
  });

  ngOnInit(): void { this.workers.load(); this.plans.load(); }
  get projectedPreview(): number {
    return this.form.controls.estimated_rate_msvh.value * this.form.controls.planned_minutes.value / 60;
  }

  newPlan(): void {
    this.editing.set(null); this.formOpen.set(true);
    this.form.reset({ plan_code: 'ALARA-', worker_id: this.activeWorkers()[0]?.id ?? 0, work_area: '', task_category: '', estimated_rate_msvh: 0.1, planned_minutes: 30, controls: 'time limit, distance markers' });
  }

  edit(plan: WorkPermitPlan): void {
    this.editing.set(plan); this.formOpen.set(true);
    this.form.setValue({
      plan_code: plan.plan_code, worker_id: plan.worker_id, work_area: plan.work_area,
      task_category: plan.task_category, estimated_rate_msvh: plan.estimated_rate_msvh,
      planned_minutes: plan.planned_minutes, controls: plan.controls.join(', '),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeForm(): void { this.formOpen.set(false); this.editing.set(null); }

  save(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const input: PlanInput = { ...raw, controls: raw.controls.split(',').map(value => value.trim()).filter(Boolean) };
    const editing = this.editing();
    const request = editing
      ? this.plans.update(editing.id, { worker_id: input.worker_id, work_area: input.work_area, task_category: input.task_category, estimated_rate_msvh: input.estimated_rate_msvh, planned_minutes: input.planned_minutes, controls: input.controls, version: editing.version })
      : this.plans.create(input);
    this.saving.set(true); this.error.set('');
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => this.closeForm(),
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }

  statusLabel(status: string): string { return status.replaceAll('_', ' '); }
}
