import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-safety-boundary-banner',
  standalone: true,
  template: `
    <aside class="boundary" role="note">
      <span class="marker">PLANNING BOUNDARY</span>
      <div>
        <strong>{{ title }}</strong>
        <p>{{ detail }}</p>
      </div>
    </aside>
  `,
  styles: [`
    .boundary { display: grid; grid-template-columns: 148px minmax(0, 1fr); gap: 18px; align-items: center; margin-bottom: 24px; padding: 14px 16px; color: #493a13; background: #fff3c9; border: 1px solid #d8b75c; border-radius: 3px; }
    .marker { font-size: 10px; font-weight: 900; color: #76580a; }
    strong { display: block; font-size: 13px; }
    p { margin: 3px 0 0; font-size: 12px; line-height: 1.45; }
    @media (max-width: 640px) { .boundary { grid-template-columns: 1fr; gap: 5px; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SafetyBoundaryBannerComponent {
  @Input() title = 'Offline ALARA planning only';
  @Input() detail = 'No result on this screen authorizes work or replaces a qualified radiation protection or medical decision.';
}
