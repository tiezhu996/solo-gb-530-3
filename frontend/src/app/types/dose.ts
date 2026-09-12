export type DoseBand = 'within_admin' | 'above_admin' | 'near_legal' | 'above_legal' | 'invalid';
export type QualityFlag = 'pending' | 'verified' | 'rejected';
export type EntryType = 'confirmed' | 'reversal' | 'replacement';
export type AssessmentStatus = 'calculated' | 'submitted' | 'accepted' | 'rejected';

export interface ExposureEntry {
  id: number;
  worker_id: number;
  worker_code: string;
  worker_name: string;
  source_ref: string;
  occurred_at: string;
  dose_msv: number;
  entry_type: EntryType;
  quality_flag: QualityFlag;
  verified_by?: number;
  verified_at?: string;
  correction_of_id?: number;
  note: string;
  created_at: string;
}

export interface ExposureInput {
  worker_id: number;
  source_ref: string;
  occurred_at: string;
  dose_msv: number;
  note: string;
}

export interface DoseEvidence {
  period_start: string;
  period_end: string;
  verified_entry_count: number;
  excluded_entry_count: number;
  corrected_chain_count: number;
  formula: string;
  projection_formula: string;
  administrative_limit_msv: number;
  annual_legal_limit_msv: number;
  near_legal_ratio: number;
  threshold_version: string;
  requires_manual_review: boolean;
  escalation_reason: string;
  boundary_statement: string;
}

export interface DoseBudgetAssessment {
  id: number;
  worker_id: number;
  worker_code: string;
  worker_name: string;
  plan_id: number;
  plan_code: string;
  assessment_status: AssessmentStatus;
  input_snapshot: Record<string, unknown>;
  period_dose_msv: number;
  projected_dose_msv: number;
  remaining_admin_msv: number;
  remaining_legal_msv: number;
  risk_band: DoseBand;
  evidence: DoseEvidence;
  threshold_version: string;
  plan_version: number;
  worker_version: number;
  created_at: string;
  reviewed_by?: number;
  reviewed_at?: string;
  review_note: string;
}

export interface ScenarioComparison {
  worker_id: number;
  period_dose_msv: number;
  scenarios: DoseBudgetAssessment[];
  highest_risk_band: DoseBand;
  boundary_statement: string;
}
