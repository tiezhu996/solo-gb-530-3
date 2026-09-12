import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from '../stores/auth.store';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStore);
  const token = auth.token();
  const secured = token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
  return next(secured).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.endsWith('/auth/login')) auth.logout();
      return throwError(() => error);
    }),
  );
};
