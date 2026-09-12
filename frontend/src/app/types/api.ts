export type UserRole = 'planner' | 'rpo_reviewer' | 'admin';

export interface UserView { id: number; username: string; role: UserRole; }
export interface LoginResponse { token: string; expires_at: string; user: UserView; }
export interface ApiEnvelope<T> { data: T; request_id: string; }
export interface PageMeta { page: number; page_size: number; total: number; total_pages: number; }
export interface PageEnvelope<T> extends ApiEnvelope<T[]> { meta: PageMeta; }

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
  request_id?: string;
}

export interface AuditEvent {
  id: number;
  actor: string;
  role: UserRole;
  action: string;
  resource_type: string;
  resource_id: string;
  request_id: string;
  parameters: Record<string, unknown>;
  before_summary: Record<string, unknown>;
  after_summary: Record<string, unknown>;
  created_at: string;
}
