import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { CryptoApiService, CryptoDeposit, CryptoSettings, CryptoWithdrawal } from './crypto-api.service';
import { AdminPinService } from '../../core/services/admin-pin.service';

@Component({
  selector: 'app-crypto-admin', standalone: true, imports: [CommonModule, FormsModule],
  template: `
    <section class="crypto-card">
      <span class="eyebrow">USD · USDT · BEP-20</span><h3>Wallet withdrawals and conversion</h3>
      <ng-container *ngIf="settingsLoaded()">
        <label><input type="checkbox" [(ngModel)]="settings.withdrawals_enabled" [disabled]="saving()"> Enable USDT withdrawals</label>
        <label><input type="checkbox" [(ngModel)]="settings.conversion_enabled" [disabled]="saving()"> Enable USD/KES conversion</label>
        <label>1 USD = KES<input type="number" min="0.000001" max="1000000" step="0.000001" [(ngModel)]="settings.usd_kes_rate" [disabled]="saving()"></label>
        <button type="button" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save wallet settings' }}</button>
      </ng-container>
      <div class="history-heading"><h4>Previous crypto deposits</h4><button class="secondary" type="button" (click)="loadDeposits()">Refresh history</button></div>
      <p *ngIf="!deposits().length">No previous crypto deposits.</p>
      <article *ngFor="let deposit of deposits()" class="deposit-row">
        <div><strong>Player #{{ deposit.user_id }} · {{ deposit.token_amount }} USDT</strong><span class="status">{{ deposit.status }}</span></div>
        <small>{{ deposit.created_at | date:'medium' }}</small>
        <code>{{ deposit.receiving_address }}</code>
        <a *ngIf="deposit.transaction_hash" [href]="'https://bscscan.com/tx/' + deposit.transaction_hash" target="_blank" rel="noopener noreferrer">Verify transaction on BscScan</a>
        <p *ngIf="deposit.status === 'completed'">Credited {{ deposit.usd_amount | currency:'USD' }}</p>
        <p *ngIf="deposit.review_note">{{ deposit.review_note }}</p>
        <ng-container *ngIf="deposit.status === 'pending'">
          <label>Confirmed value (USD)<input type="text" inputmode="decimal" [(ngModel)]="amounts[deposit.id]" placeholder="e.g. 10.00" [disabled]="reviewing() !== ''"></label>
          <label>Review note (required for rejection)<textarea [(ngModel)]="notes[deposit.id]" maxlength="500" [disabled]="reviewing() !== ''"></textarea></label>
          <button type="button" (click)="review(deposit, 'approve')" [disabled]="reviewing() !== ''">Verify & credit USD</button>
          <button type="button" class="reject" (click)="review(deposit, 'reject')" [disabled]="reviewing() !== ''">Reject</button>
        </ng-container>
      </article>
      <div class="history-heading"><h4>USDT withdrawals</h4><button type="button" class="secondary" (click)="loadWithdrawals()">Refresh</button></div>
      <article *ngFor="let withdrawal of withdrawals()" class="deposit-row">
        <strong>Player #{{ withdrawal.user_id }} · {{ withdrawal.token_amount }} USDT</strong>
        <span class="status">{{ withdrawal.status }}</span><small>{{ withdrawal.created_at | date:'short' }}</small>
        <code>{{ withdrawal.receiving_address }}</code>
        <a *ngIf="withdrawal.transaction_hash" [href]="'https://bscscan.com/tx/' + withdrawal.transaction_hash" target="_blank" rel="noopener noreferrer">View payout</a>
        <p *ngIf="withdrawal.review_note">{{ withdrawal.review_note }}</p>
        <ng-container *ngIf="withdrawal.status === 'pending'">
          <label>Payout transaction hash<input type="text" [(ngModel)]="payoutHashes[withdrawal.id]" placeholder="0x…" [disabled]="reviewing() !== ''"></label>
          <label>Review note<textarea [(ngModel)]="notes[withdrawal.id]" maxlength="500" [disabled]="reviewing() !== ''"></textarea></label>
          <button type="button" (click)="reviewWithdrawal(withdrawal, 'complete')" [disabled]="reviewing() !== ''">Confirm sent payout</button>
          <button type="button" class="reject" (click)="reviewWithdrawal(withdrawal, 'reject')" [disabled]="reviewing() !== ''">Reject & refund</button>
        </ng-container>
      </article>
      <p *ngIf="message()" class="message" role="status">{{ message() }}</p>
    </section>
  `,
  styleUrl: './crypto-wallet.css'
})
export class CryptoAdminComponent {
  private api = inject(CryptoApiService);
  private destroyRef = inject(DestroyRef);
  private pin = inject(AdminPinService);
  settings: CryptoSettings = { enabled: false, receiving_address: '', asset: 'USDT', network: 'BEP-20', currency: 'USD',
    withdrawals_enabled: false, conversion_enabled: false, usd_kes_rate: 0, usd_kes_rate_micros: 0 };
  settingsLoaded = signal(false);
  saving = signal(false);
  reviewing = signal('');
  deposits = signal<CryptoDeposit[]>([]);
  withdrawals = signal<CryptoWithdrawal[]>([]);
  payoutHashes: Record<string, string> = {};
  message = signal('');
  amounts: Record<string, string> = {};
  notes: Record<string, string> = {};
  constructor() {
    this.loadSettings();
    this.loadDeposits();
    this.loadWithdrawals();
    timer(10000, 10000).pipe(takeUntilDestroyed()).subscribe(() => { this.loadDeposits(); this.loadWithdrawals(); });
    this.pin.changed$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.deposits.set([]); this.withdrawals.set([]); this.amounts = {}; this.notes = {}; this.payoutHashes = {};
      this.reviewing.set(''); this.loadDeposits(); this.loadWithdrawals();
    });
  }
  loadSettings() {
    this.api.settings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: settings => { this.settings = settings; this.settingsLoaded.set(true); },
      error: error => this.message.set(error?.error?.error || 'Unable to load crypto settings.')
    });
  }
  loadDeposits() {
    this.api.deposits().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => this.deposits.set(result.deposits),
      error: error => this.message.set(error?.error?.error || 'Unable to load crypto requests.')
    });
  }
  loadWithdrawals() {
    this.api.withdrawals().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => this.withdrawals.set(result.withdrawals),
      error: error => this.message.set(error?.error?.error || 'Unable to load withdrawals.')
    });
  }
  reviewWithdrawal(withdrawal: CryptoWithdrawal, action: string) {
    if (this.reviewing()) return;
    this.reviewing.set(withdrawal.id); this.message.set('');
    this.api.reviewWithdrawal(withdrawal.id, action, this.payoutHashes[withdrawal.id] || '', this.notes[withdrawal.id] || '')
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.reviewing.set(''); this.message.set(action === 'complete' ? 'Payout confirmed.' : 'Withdrawal refunded.'); this.loadWithdrawals(); },
        error: error => { this.reviewing.set(''); this.message.set(error?.error?.error || 'Unable to review withdrawal.'); }
      });
  }
  save() {
    if (this.saving()) return;
    this.saving.set(true); this.message.set('');
    this.api.save({ ...this.settings, enabled: false, receiving_address: '' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: settings => { this.settings = settings; this.saving.set(false); this.message.set('Wallet settings saved.'); },
      error: error => { this.saving.set(false); this.message.set(error?.error?.error || 'Unable to save settings.'); }
    });
  }
  review(deposit: CryptoDeposit, action: string) {
    if (this.reviewing()) return;
    this.reviewing.set(deposit.id); this.message.set('');
    this.api.review(deposit.id, action, this.amounts[deposit.id] || '', this.notes[deposit.id] || '').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.reviewing.set(''); this.message.set(action === 'approve' ? 'Deposit verified and USD wallet credited.' : 'Deposit rejected.'); this.loadDeposits(); },
      error: error => { this.reviewing.set(''); this.message.set(error?.error?.error || 'Unable to review deposit.'); }
    });
  }
}
