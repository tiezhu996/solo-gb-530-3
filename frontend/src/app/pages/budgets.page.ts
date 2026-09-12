import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { useBudgetAssessment } from '../hooks/use-budget-assessment';
import { PlansStore } from '../stores/plans.store';
import { useAuth } from '../hooks/use-auth';
import { BudgetEvidencePanelComponent } from '../components/common/budget-evidence-panel.component';
import { DoseBandBadgeComponent } from '../components/common/dose-band-badge.component';
import { SafetyBoundaryBannerComponent } from '../components/common/safety-boundary-banner.component';
import { apiErrorMessage, inputToUTC, utcNowInput } from '../utils/api-error';

@Component({
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, BudgetEvidencePanelComponent, DoseBandBadgeComponent, SafetyBoundaryBannerComponent,
  ],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Reproducible calculation</span><h1>Dose budget assessments</h1><p>Freeze period inputs, apply versioned thresholds and compare time-weighted plan scenarios.</p></div>
      </header>
      <app-safety-boundary-banner />
      <p class="error-banner" *ngIf="error()">{{ error() }}</p>
      <form *ngIf="auth.canPlan()" class="assessment-bar" [formGroup]="assessmentForm" (ngSubmit)="assess()">
        <div><span class="eyebrow">New immutable assessment</span><strong>Choose a draft or reassessable plan</strong></div>
        <mat-form-field appearance="outline"><mat-label>Plan</mat-label><mat-select formControlName="plan_id"><mat-option *ngFor="let plan of assessablePlans" [value]="plan.id">{{ plan.plan_code }} · {{ plan.worker_code }} · v{{ plan.version }}</mat-option></mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Period end</mat-label><input matInput type="datetime-local" formControlName="period_end"></mat-form-field>
        <button mat-flat-button color="primary" type="submit" [disabled]="assessmentForm.invalid || running()">{{ running() ? 'Calculating' : 'Run assessment' }}</button>
      </form>
      <form *ngIf="auth.canPlan()" class="comparison-bar" [formGroup]="comparisonForm" (ngSubmit)="compare()">
        <span class="eyebrow">Scenario comparison</span>
        <mat-form-field appearance="outline"><mat-label>Plans for one worker</mat-label><mat-select formControlName="plan_ids" multiple><mat-option *ngFor="let plan of plans.plans()" [value]="plan.id">{{ plan.plan_code }} · {{ plan.worker_code }}</mat-option></mat-select></mat-form-field>
        <button mat-button type="submit" [disabled]="comparisonForm.invalid || running()">Compare selected</button>
      </form>
      <section *ngIf="budget.comparison() as comparison" class="comparison">
        <header><div><span class="eyebrow">Ephemeral comparison · not stored</span><h2>{{ comparison.scenarios.length }} scenarios for {{ comparison.scenarios[0].worker_code }}</h2></div><app-dose-band-badge [band]="comparison.highest_risk_band" /></header>
        <table class="data-table"><thead><tr><th>Plan</th><th>Current</th><th>Increment</th><th>Projected</th><th>Risk</th></tr></thead><tbody><tr *ngFor="let item of comparison.scenarios"><td>{{ item.plan_code }}</td><td>{{ item.period_dose_msv | number:'1.3-3' }}</td><td>{{ item.projected_dose_msv - item.period_dose_msv | number:'1.3-3' }}</td><td><strong>{{ item.projected_dose_msv | number:'1.3-3' }} mSv</strong></td><td><app-dose-band-badge [band]="item.risk_band" /></td></tr></tbody></table>
        <footer>{{ comparison.boundary_statement }}</footer>
      </section>
      <div class="section-title"><h2>Assessment history</h2><span>Snapshots are append-only</span></div>
      <div class="split">
        <div class="surface assessment-list">
          <button *ngFor="let item of budget.assessments()" type="button" [class.active]="budget.selected()?.id === item.id" (click)="budget.select(item)">
            <span><strong>{{ item.plan_code }}</strong><small>#{{ item.id }} · {{ item.worker_code }}</small></span>
            <span class="right"><app-dose-band-badge [band]="item.risk_band" /><small>{{ item.assessment_status }}</small></span>
          </button>
          <div class="empty" *ngIf="!budget.assessments().length">Run the first assessment from a plan scenario.</div>
        </div>
        <div *ngIf="budget.selected() as selected" class="detail">
          <app-budget-evidence-panel [assessment]="selected" />
          <div class="review-row">
            <div><strong>{{ selected.assessment_status.replaceAll('_', ' ') }}</strong><span>Calculated {{ selected.created_at | date:'medium':'UTC' }}</span></div>
            <button *ngIf="auth.canPlan() && selected.assessment_status === 'calculated'" mat-flat-button color="primary" (click)="submit(selected.id, selected.plan_version)">Submit to RPO review</button>
            <span *ngIf="selected.assessment_status === 'submitted'" class="waiting">Awaiting independent RPO review</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .assessment-bar { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(260px, 1.2fr) minmax(220px, .8fr) auto; gap: 14px; align-items: start; padding: 18px; background: #e8eeea; border: 1px solid var(--line); }
    .assessment-bar div { padding-top: 7px; } .assessment-bar strong { display: block; font-size: 13px; }
    .comparison-bar { display: grid; grid-template-columns: 180px minmax(280px, 1fr) auto; gap: 14px; align-items: start; margin-top: 10px; padding: 10px 18px; border: 1px solid var(--line); background: #f8f8f3; }
    .comparison-bar .eyebrow { padding-top: 12px; }
    .comparison { margin-top: 18px; border: 1px solid var(--line); background: #fbfbf7; }
    .comparison header { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
    .comparison h2 { margin: 0; font-size: 16px; } .comparison footer { padding: 10px 18px; background: #fff3c9; font-size: 11px; color: #493a13; }
    .assessment-list { overflow: hidden; }
    .assessment-list > button { width: 100%; min-height: 72px; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .assessment-list > button:hover, .assessment-list > button.active { background: #e8eeea; } .assessment-list > button.active { box-shadow: inset 3px 0 #286858; }
    .assessment-list span, .assessment-list small { display: block; } .assessment-list small { margin-top: 4px; color: var(--muted); font-size: 10px; }
    .assessment-list .right { text-align: right; }
    .review-row { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-top: 10px; padding: 14px 16px; border: 1px solid var(--line); background: #fbfbf7; }
    .review-row strong, .review-row span { display: block; } .review-row strong { text-transform: capitalize; } .review-row span { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .waiting { color: #76510b !important; font-weight: 700; }
    @media (max-width: 980px) { .assessment-bar, .comparison-bar { grid-template-columns: 1fr 1fr; } .assessment-bar > div, .comparison-bar .eyebrow { grid-column: 1 / -1; } }
    @media (max-width: 620px) { .assessment-bar, .comparison-bar { grid-template-columns: 1fr; } .review-row { align-items: stretch; flex-direction: column; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetsPage implements OnInit {
  readonly budget = useBudgetAssessment();
  readonly plans = inject(PlansStore);
  readonly auth = useAuth();
  private readonly builder = new FormBuilder().nonNullable;
  readonly running = signal(false);
  readonly error = signal('');
  readonly assessmentForm = this.builder.group({
    plan_id: [0, [Validators.required, Validators.min(1)]],
    period_end: [utcNowInput(), Validators.required],
  });
  readonly comparisonForm = this.builder.group({
    plan_ids: [[] as number[], [Validators.required, Validators.minLength(2)]],
  });

  ngOnInit(): void { this.plans.load(); this.budget.load(); }
  get assessablePlans() { return this.plans.plans().filter(plan => ['draft', 'assessed'].includes(plan.permit_status)); }

  assess(): void {
    if (this.assessmentForm.invalid) return;
    const raw = this.assessmentForm.getRawValue();
    const plan = this.plans.plans().find(item => item.id === raw.plan_id);
    if (!plan) { this.error.set('Select an available plan.'); return; }
    this.running.set(true); this.error.set('');
    this.budget.assess(plan.id, inputToUTC(raw.period_end), plan.version).pipe(finalize(() => this.running.set(false))).subscribe({
      next: () => this.plans.load(),
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }

  compare(): void {
    if (this.comparisonForm.invalid) return;
    this.running.set(true); this.error.set('');
    this.budget.compare(this.comparisonForm.controls.plan_ids.value, inputToUTC(this.assessmentForm.controls.period_end.value))
      .pipe(finalize(() => this.running.set(false))).subscribe({ error: error => this.error.set(apiErrorMessage(error)) });
  }

  submit(id: number, version: number): void {
    this.running.set(true); this.error.set('');
    this.budget.submit(id, version).pipe(finalize(() => this.running.set(false))).subscribe({
      next: () => this.plans.load(),
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }
}
