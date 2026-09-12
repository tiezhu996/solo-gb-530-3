import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorBody } from '../types/api';

export function apiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as ApiErrorBody | undefined;
    const message = body?.error?.message;
    const requestId = body?.request_id;
    if (message && requestId) return `${message} · request ${requestId}`;
    if (message) return message;
    if (error.status === 0) return 'The planning API is not reachable.';
    return `Request failed with HTTP ${error.status}.`;
  }
  return 'The request could not be completed.';
}

export function utcNowInput(): string {
  const value = new Date();
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function inputToUTC(value: string): string {
  return new Date(value).toISOString();
}
