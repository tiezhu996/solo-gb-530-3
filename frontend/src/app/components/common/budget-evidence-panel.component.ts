import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoseBudgetAssessment } from '../../types/dose';
import { DoseBandBadgeComponent } from './dose-band-badge.component';

@Component({
  selector: 'app-budget-evidence-panel',
  standalone: true,
  imports: [CommonModule, DoseBandBadgeComponent],
  template: `
    <section class="evidence" aria-label="Dose budget evidence">
      <header>
        <div><span class="eyebrow">Immutable assessment #{{ assessment.id || 'comparison' }}</span><h2>{{ assessment.plan_code }}</h2></div>
        <app-dose-band-badge [band]="assessment.risk_band" />
      </header>
      <div class="dose-line" [style.--used]="legalPercent + '%'">
        <span class="fill"></span><span class="admin" [style.left.%]="adminPercent"></span>
      </div>
      <div class="scale">
        <span>0 mSv</span><span>Admin {{ assessment.evidence.administrative_limit_msv | number:'1.2-3' }}</span>
        <strong>Projected {{ assessment.projected_dose_msv | number:'1.3-3' }}</strong>
        <span>Legal {{ assessment.evidence.annual_legal_limit_msv | number:'1.2-3' }}</span>
      </div>
      <dl>
        <div><dt>Confirmed period dose</dt><dd>{{ assessment.period_dose_msv | number:'1.3-3' }} mSv</dd></div>
        <div><dt>Plan increment</dt><dd>{{ planIncrement | number:'1.3-3' }} mSv</dd></div>
        <div><dt>Admin margin</dt><dd>{{ assessment.remaining_admin_msv | number:'1.3-3' }} mSv</dd></div>
        <div><dt>Legal margin</dt><dd>{{ assessment.remaining_legal_msv | number:'1.3-3' }} mSv</dd></div>
      </dl>
      <div class="facts">
        <p><strong>Evidence set</strong> {{ assessment.evidence.verified_entry_count }} verified · {{ assessment.evidence.excluded_entry_count }} excluded · {{ assessment.evidence.corrected_chain_count }} correction links</p>
        <p><strong>Formula</strong> {{ assessment.evidence.projection_formula }}</p>
        <p><strong>Threshold</strong> {{ assessment.threshold_version }} · near legal at {{ assessment.evidence.near_legal_ratio | percent:'1.0-0' }}</p>
        <p class="escalation"><strong>Review signal</strong> {{ assessment.evidence.escalation_reason }}</p>
      </div>
      <footer>{{ assessment.evidence.boundary_statement }}</footer>
    </section>
  `,
  styles: [`
    .evidence { background: #fbfbf7; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
    h2 { margin: 0; font-family: Georgia, serif; font-size: 20px; font-weight: 500; }
    .dose-line { position: relative; height: 20px; margin: 24px 20px 8px; background: #dfe5df; overflow: hidden; }
    .fill { display: block; width: min(var(--used), 100%); height: 100%; background: #286858; }
    .admin { position: absolute; inset-block: 0; width: 2px; background: #c47d10; }
    .scale { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; align-items: start; gap: 8px; padding: 0 20px; font-size: 10px; color: var(--muted); }
    .scale strong { color: var(--ink); text-align: center; } .scale span:last-child { text-align: right; }
    dl { display: grid; grid-template-columns: repeat(4, 1fr); margin: 24px 0 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    dl div { padding: 14px 18px; border-right: 1px solid var(--line); } dl div:last-child { border-right: 0; }
    dt { color: var(--muted); font-size: 10px; text-transform: uppercase; } dd { margin: 5px 0 0; font-size: 17px; font-variant-numeric: tabular-nums; }
    .facts { display: grid; gap: 8px; padding: 18px 20px; font-size: 12px; } .facts p { margin: 0; line-height: 1.45; }
    .facts strong { display: inline-block; min-width: 88px; color: var(--muted); }
    .escalation { color: #76510b; }
    footer { padding: 11px 20px; background: #fff3c9; border-top: 1px solid #d8b75c; color: #493a13; font-size: 11px; }
    @media (max-width: 720px) { dl { grid-template-columns: 1fr 1fr; } dl div:nth-child(2) { border-right: 0; } .scale { grid-template-columns: 1fr 1fr; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetEvidencePanelComponent {
  @Input({ required: true }) assessment!: DoseBudgetAssessment;
  get legalPercent(): number {
    const limit = this.assessment.evidence.annual_legal_limit_msv || 1;
    return Math.max(0, Math.min(100, this.assessment.projected_dose_msv / limit * 100));
  }
  get adminPercent(): number {
    const legal = this.assessment.evidence.annual_legal_limit_msv || 1;
    return Math.max(0, Math.min(100, this.assessment.evidence.administrative_limit_msv / legal * 100));
  }
  get planIncrement(): number { return this.assessment.projected_dose_msv - this.assessment.period_dose_msv; }
}
