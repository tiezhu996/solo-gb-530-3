export type ProfileStatus = 'active' | 'suspended' | 'archived';
export type PermitStatus = 'draft' | 'assessed' | 'pending_rpo_review' | 'planning_accepted' | 'rejected' | 'archived';

export interface WorkerProfile {
  id: number;
  worker_code: string;
  display_name: string;
  authorization_level: string;
  annual_limit_msv: number;
  administrative_limit_msv: number;
  profile_status: ProfileStatus;
  period_start: string;
  period_dose_msv: number;
  remaining_admin_msv: number;
  remaining_legal_msv: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface WorkerInput {
  worker_code: string;
  display_name: string;
  authorization_level: string;
  annual_limit_msv: number;
  administrative_limit_msv: number;
  profile_status: ProfileStatus;
  period_start: string;
}

export interface WorkPermitPlan {
  id: number;
  plan_code: string;
  worker_id: number;
  worker_code: string;
  worker_name: string;
  work_area: string;
  task_category: string;
  estimated_rate_msvh: number;
  planned_minutes: number;
  projected_dose_msv: number;
  controls: string[];
  permit_status: PermitStatus;
  version: number;
  reviewer_id?: number;
  review_note: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface PlanInput {
  plan_code: string;
  worker_id: number;
  work_area: string;
  task_category: string;
  estimated_rate_msvh: number;
  planned_minutes: number;
  controls: string[];
}
