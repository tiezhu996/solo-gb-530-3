import { inject } from '@angular/core';
import { AuthStore } from '../stores/auth.store';

export function useAuth(): AuthStore {
  return inject(AuthStore);
}
