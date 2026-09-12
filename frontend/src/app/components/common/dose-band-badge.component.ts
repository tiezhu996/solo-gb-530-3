import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoseBand } from '../../types/dose';

@Component({
  selector: 'app-dose-band-badge',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="band" [ngClass]="band">{{ label }}</span>`,
  styles: [`
    .band { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 9px; border: 1px solid; border-radius: 3px; font-size: 11px; font-weight: 800; white-space: nowrap; }
    .within_admin { color: #185847; border-color: #8eb8a8; background: #e5f1eb; }
    .above_admin { color: #76510b; border-color: #d6b262; background: #fff1ca; }
    .near_legal { color: #823f11; border-color: #dd9b67; background: #fbe5d4; }
    .above_legal, .invalid { color: #8c2929; border-color: #d89591; background: #f8dfde; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoseBandBadgeComponent {
  @Input({ required: true }) band!: DoseBand;
  get label(): string {
    return {
      within_admin: 'Within admin',
      above_admin: 'Above admin',
      near_legal: 'Near legal',
      above_legal: 'Above legal',
      invalid: 'Invalid input',
    }[this.band];
  }
}
