import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { useAuth } from '../hooks/use-auth';
import { apiErrorMessage } from '../utils/api-error';

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <main class="login-shell">
      <section class="identity">
        <span class="monogram">AL</span>
        <p class="overline">OFFLINE ALARA PLANNING</p>
        <h1>ALARA<br>LEDGER</h1>
        <div class="threshold"><span></span><i></i><b></b></div>
        <dl>
          <div><dt>Input</dt><dd>Confirmed records</dd></div>
          <div><dt>Output</dt><dd>Planning evidence</dd></div>
          <div><dt>Authority</dt><dd>Human review</dd></div>
        </dl>
      </section>
      <section class="login-panel">
        <form [formGroup]="form" (ngSubmit)="submit()">
          <span class="eyebrow">Controlled planning access</span>
          <h2>Dose budget console</h2>
          <p class="boundary">No calculation authorizes work or supplies medical advice.</p>
          <p class="error-banner" *ngIf="error()">{{ error() }}</p>
          <mat-form-field appearance="outline"><mat-label>Username</mat-label><input matInput formControlName="username" autocomplete="username"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Password</mat-label><input matInput type="password" formControlName="password" autocomplete="current-password"></mat-form-field>
          <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || loading()">{{ loading() ? 'Signing in' : 'Sign in' }}</button>
          <div class="accounts"><button type="button" (click)="account('planner')">Planner</button><button type="button" (click)="account('rpo')">RPO reviewer</button><button type="button" (click)="account('admin')">Admin</button></div>
        </form>
      </section>
    </main>
  `,
  styles: [`
    .login-shell { min-height: 100vh; display: grid; grid-template-columns: minmax(340px, 1.08fr) minmax(360px, .92fr); background: #222d2a; }
    .identity { display: flex; flex-direction: column; justify-content: center; padding: clamp(44px, 8vw, 116px); color: #f2f0e8; overflow: hidden; }
    .monogram { display: grid; place-items: center; width: 56px; height: 56px; color: #222d2a; background: #d79a22; font-family: Georgia, serif; font-size: 18px; font-weight: 800; }
    .overline { margin: 38px 0 10px; color: #bcc8c1; font-size: 10px; font-weight: 800; }
    h1 { margin: 0; font-family: Georgia, serif; font-size: 58px; line-height: .92; font-weight: 500; }
    .threshold { position: relative; width: min(520px, 92%); height: 48px; margin: 38px 0 12px; border-top: 2px solid #6d7873; }
    .threshold span, .threshold i, .threshold b { position: absolute; top: -6px; width: 10px; height: 10px; background: #d79a22; border-radius: 50%; }
    .threshold span { left: 8%; } .threshold i { left: 58%; background: #8fc0ad; } .threshold b { right: 3%; background: #cf6c60; }
    dl { display: flex; gap: 32px; } dt { color: #aebbb4; font-size: 9px; text-transform: uppercase; } dd { margin: 4px 0 0; font-size: 11px; }
    .login-panel { display: grid; place-items: center; padding: 32px; background: #f2f1ea; }
    form { width: min(410px, 100%); display: grid; } h2 { margin: 0 0 10px; font-family: Georgia, serif; font-size: 28px; font-weight: 500; }
    .boundary { margin: 0 0 22px; color: #6a5a21; font-size: 12px; } mat-form-field { width: 100%; }
    button[type=submit] { min-height: 46px; } .accounts { display: flex; justify-content: center; gap: 18px; margin-top: 18px; }
    .accounts button { border: 0; background: transparent; color: #4e5d57; font-size: 11px; text-decoration: underline; cursor: pointer; min-height: 38px; }
    @media (max-width: 760px) { .login-shell { grid-template-columns: 1fr; } .identity { min-height: 285px; padding: 34px 28px; } h1 { font-size: 42px; } .threshold { height: 20px; margin-top: 24px; } dl { margin: 0; } .login-panel { min-height: 55vh; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = useAuth();
  private readonly builder = new FormBuilder().nonNullable;
  readonly loading = signal(false);
  readonly error = signal('');
  readonly form = this.builder.group({ username: ['planner', Validators.required], password: ['Planner#530', [Validators.required, Validators.minLength(8)]] });

  constructor(private readonly router: Router) {}

  account(name: 'planner' | 'rpo' | 'admin'): void {
    const passwords = { planner: 'Planner#530', rpo: 'RPO#Review530', admin: 'Admin#530' };
    this.form.setValue({ username: name, password: passwords[name] });
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true); this.error.set('');
    const value = this.form.getRawValue();
    this.auth.login(value.username, value.password).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: () => void this.router.navigateByUrl('/workers'),
      error: error => this.error.set(apiErrorMessage(error)),
    });
  }
}
