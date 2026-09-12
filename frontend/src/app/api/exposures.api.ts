import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope, PageEnvelope } from '../types/api';
import { ExposureEntry, ExposureInput } from '../types/dose';

export interface CorrectionResult {
  original: ExposureEntry;
  reversal: ExposureEntry;
  replacement: ExposureEntry;
  net_dose_msv: number;
}

@Injectable({ providedIn: 'root' })
export class ExposuresApi {
  private readonly http = inject(HttpClient);
  private readonly root = '/api/v1/exposures';

  list() { return this.http.get<PageEnvelope<ExposureEntry>>(this.root, { params: { page_size: 150 } }); }
  create(input: ExposureInput) { return this.http.post<ApiEnvelope<ExposureEntry>>(this.root, input); }
  verify(id: number, qualityFlag: 'verified' | 'rejected', note: string) {
    return this.http.post<ApiEnvelope<ExposureEntry>>(`${this.root}/${id}/verify`, { quality_flag: qualityFlag, note });
  }
  correct(id: number, sourceRef: string, replacementDoseMSV: number, occurredAt: string, note: string) {
    return this.http.post<ApiEnvelope<CorrectionResult>>(`${this.root}/${id}/correct`, {
      source_ref: sourceRef, replacement_dose_msv: replacementDoseMSV, occurred_at: occurredAt, note,
    });
  }
}
