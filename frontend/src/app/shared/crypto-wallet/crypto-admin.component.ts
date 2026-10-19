import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { CryptoApiService, CryptoDeposit, CryptoSettings } from './crypto-api.service';
import { AdminPinService } from '../../core/services/admin-pin.service';

@Component({
  selector: 'app-crypto-admin', standalone: true, imports: [CommonModule, FormsModule],
  template: `
    <section class="crypto-card">
      <span class="eyebrow">TRUST WALLET · USDT · BEP-20</span><h3>Crypto deposits & USD wallet</h3>
      <p>Copy your USDT receiving address from Trust Wallet on BNB Smart Chain. Players receive separate USD wallet credits after your verification.</p>
      <ng-container *ngIf="settingsLoaded()">
        <label>Trust Wallet receiving address<input type="text" [(ngModel)]="settings.receiving_address" placeholder="0x…" autocomplete="off" [disabled]="saving()"></label>
        <label><input type="checkbox" [(ngModel)]="settings.enabled" [disabled]="saving()"> Enable USDT deposits on BEP-20</label>
        <button type="button" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save crypto settings' }}</button>
      </ng-container>
      <div class="history-heading"><h4>Crypto deposit requests</h4><button class="secondary" type="button" (click)="loadDeposits()">Refresh requests</button></div>
      <p class="muted">Check the successful token transfer, USDT asset, BEP-20 network, receiving address, amount and confirmations in Trust Wallet or BscScan. Enter its confirmed USD value to approve. Each transaction can be credited once.</p>
      <p *ngIf="!deposits().length">No crypto requests found.</p>
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
      <p *ngIf="message()" class="message" role="status">{{ message() }}</p>
    </section>
  `,
  styleUrl: './crypto-wallet.css'
})
export class CryptoAdminComponent {
  private api = inject(CryptoApiService);
  private destroyRef = inject(DestroyRef);
  private pin = inject(AdminPinService);
  settings: CryptoSettings = { enabled: false, receiving_address: '', asset: 'USDT', network: 'BEP-20', currency: 'USD' };
  settingsLoaded = signal(false);
  saving = signal(false);
  reviewing = signal('');
  deposits = signal<CryptoDeposit[]>([]);
  message = signal('');
  amounts: Record<string, string> = {};
  notes: Record<string, string> = {};
  constructor() {
    this.loadSettings();
    timer(0, 10000).pipe(takeUntilDestroyed()).subscribe(() => this.loadDeposits());
    this.pin.changed$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.deposits.set([]); this.amounts = {}; this.notes = {}; this.loadDeposits();
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
  save() {
    if (this.saving()) return;
    this.saving.set(true); this.message.set('');
    this.api.save(this.settings).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: settings => { this.settings = settings; this.saving.set(false); this.message.set('Trust Wallet settings saved.'); },
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
