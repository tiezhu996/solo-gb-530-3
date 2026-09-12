import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { AuditApi } from '../api/audit.api';
import { AuditEvent } from '../types/api';
import { useBudgetAssessment } from '../hooks/use-budget-assessment';
import { BudgetEvidencePanelComponent } from '../components/common/budget-evidence-panel.component';
import { DoseBandBadgeComponent } from '../components/common/dose-band-badge.component';
import { SafetyBoundaryBannerComponent } from '../components/common/safety-boundary-banner.component';
import { apiErrorMessage } from '../utils/api-error';

@Component({
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    BudgetEvidencePanelComponent, DoseBandBadgeComponent, SafetyBoundaryBannerComponent,
  ],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Independent review ledger</span><h1>RPO review & audit</h1><p>Compare frozen evidence, record a human planning decision and trace every state change.</p></div>
      </header>
      <app-safety-boundary-banner title="Planning acceptance is not work authorization" detail="RPO review records a planning disposition only. Site permit controls, current conditions and qualified judgment remain independent." />
      <p class="error-banner" *ngIf="error()">{{ error() }}</p>
      <div class="review-layout">
        <aside class="queue surface">
          <header><h2>Review queue</h2><span>{{ pending().length }} pending</span></header>
          <button *ngFor="let item of pending()" type="button" [class.active]="budget.selected()?.id === item.id" (click)="budget.select(item)">
            <span><strong>{{ item.plan_code }}</strong><small>{{ item.worker_code }} · assessment #{{ item.id }}</small></span>
            <app-dose-band-badge [band]="item.risk_band" />
          </button>
          <div class="empty" *ngIf="!pending().length">No assessments are awaiting RPO review.</div>
        </aside>
        <section *ngIf="budget.selected() as selected" class="review-detail">
          <app-budget-evidence-panel [assessment]="selected" />
          <form *ngIf="selected.assessment_status === 'submitted'" class="review-form" [formGroup]="form">
            <mat-form-field appearance="outline"><mat-label>RPO review note</mat-label><textarea matInput rows="3" formControlName="note"></textarea></mat-form-field>
            <div>
              <button mat-button color="warn" type="button" [disabled]="form.invalid || saving()" (click)="review('reject')">Reject planning scenario</button>
              <button mat-flat-button color="primary" type="button" [disabled]="form.invalid || saving()" (click)="review('accept')">Accept for planning</button>
            </div>
          </form>
          <div *ngIf="selected.assessment_status !== 'submitted'" class="resolved">
            <strong>{{ selected.assessment_status.replaceAll('_', ' ') }}</strong>
            <span>{{ selected.review_note || 'No RPO disposition recorded.' }}</span>
          </div>
        </section>
      </div>
      <div class="section-title"><h2>Request-linked audit events</h2><span>{{ events().length }} events · append only</span></div>
      <div class="surface">
        <table class="data-table audit-table">
          <thead><tr><th>Time / request</th><th>Actor</th><th>Action</th><th>Resource</th><th>Before</th><th>After / parameters</th></tr></thead>
          <tbody>
            <tr *ngFor="let event of events()">
              <td>{{ event.created_at | date:'medium':'UTC' }}<br><span class="code muted">{{ event.request_id }}</span></td>
              <td>{{ event.actor }}<br><span class="muted">{{ event.role }}</span></td>
              <td><strong>{{ event.action }}</strong></td>
              <td>{{ event.resource_type }} #{{ event.resource_id }}</td>
              <td><code>{{ event.before_summary | json }}</code></td>
              <td><code>{{ event.after_summary | json }}</code><br><span class="muted">{{ event.parameters | json }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .review-layout { display: grid; grid-template-columns: minmax(260px, .7fr) minmax(0, 1.8fr); gap: 18px; align-items: start; }
    .queue { overflow: hidden; } .queue header { display: flex; justify-content: space-between; align-items: baseline; padding: 15px; border-bottom: 1px solid var(--line); }
    .queue h2 { margin: 0; font-size: 15px; } .queue header span { color: var(--muted); font-size: 11px; }
    .queue > button { width: 100%; min-height: 66px; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 13px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .queue > button:hover, .queue > button.active { background: #e8eeea; } .queue > button.active { box-shadow: inset 3px 0 #286858; }
    .queue button span, .queue button small { display: block; } .queue button small { margin-top: 4px; color: var(--muted); font-size: 10px; }
    .review-form { display: grid; gap: 8px; margin-top: 10px; padding: 16px; background: #e8eeea; border: 1px solid var(--line); }
    .review-form div { display: flex; justify-content: flex-end; gap: 10px; }
    .resolved { margin-top: 10px; padding: 14px; border: 1px solid var(--line); background: #f8f8f3; }
    .resolved strong { display: block; text-transform: capitalize; } .resolved span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
    .audit-table code { display: block; max-width: 360px; white-space: normal; overflow-wrap: anywhere; color: #34413e; font-size: 10px; }
    @media (max-width: 940px) { .review-layout { grid-template-columns: 1fr; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPage implements OnInit {
  readonly budget = useBudgetAssessment();
  private readonly audit = inject(AuditApi);
  private readonly builder = new FormBuilder().nonNullable;
  readonly events = signal<AuditEvent[]>([]);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly pending = computed(() => this.budget.assessments().filter(item => item.assessment_status === 'submitted'));
  readonly form = this.builder.group({ note: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(1000)]] });

  ngOnInit(): void { this.refresh(); }

  review(decision: 'accept' | 'reject'): void {
    const selected = this.budget.selected();
    if (!selected || this.form.invalid) return;
    this.saving.set(true); this.error.set('');
    this.budget.review(selected.id, selected.plan_version, decision, this.form.controls.note.value)
      .pipe(finalize(() => this.saving.set(false))).subscribe({
        next: () => { this.form.reset(); this.loadAudit(); },
        error: error => this.error.set(apiErrorMessage(error)),
      });
  }

  private refresh(): void {
    this.budget.load();
    this.loadAudit();
  }

  private loadAudit(): void {
    this.audit.list().subscribe({
      next: response => this.events.set(response.data),
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }
}
