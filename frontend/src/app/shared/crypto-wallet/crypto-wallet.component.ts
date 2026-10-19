import { Component, DestroyRef, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { CryptoApiService, CryptoDeposit, CryptoWallet } from './crypto-api.service';
import qrcode from 'qrcode-generator';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-crypto-wallet', standalone: true, imports: [CommonModule, FormsModule],
  template: `
    <section class="crypto-card" aria-label="Crypto deposit and USD wallet">
      <div class="crypto-heading"><div><span class="eyebrow">TRUST WALLET · BEP-20</span><h3>Crypto wallet</h3></div>
        <div class="usd-balance"><small>USD wallet</small><strong>{{ wallet() ? (wallet()!.usd_balance | currency:'USD') : '—' }}</strong></div>
      </div>
      <nav class="crypto-tabs" aria-label="Crypto wallet actions">
        <button type="button" [class.selected]="tab() === 'deposit'" (click)="tab.set('deposit')">Deposit</button>
        <button type="button" [class.selected]="tab() === 'withdraw'" (click)="tab.set('withdraw')">Withdraw</button>
        <button type="button" [class.selected]="tab() === 'convert'" (click)="tab.set('convert')">Convert</button>
      </nav>
      <p *ngIf="!wallet() && !message()">Loading crypto wallet…</p>
      <ng-container *ngIf="wallet() as data">
        <div *ngIf="tab() === 'deposit'">
        <div *ngIf="data.settings.enabled; else unavailable">
          <label>Amount to send (USDT)<input type="text" inputmode="decimal" [(ngModel)]="amount" placeholder="e.g. 10.00" [disabled]="busy()"></label>
          <button type="button" (click)="create()" [disabled]="busy()">{{ busy() ? 'Please wait…' : 'Get deposit address' }}</button>
        </div>
        <ng-template #unavailable><p>Deposits unavailable</p></ng-template>
        <div *ngIf="selected() as deposit" class="transfer-box">
          <h4>Send {{ deposit.token_amount }} USDT · BEP-20</h4>
          <code>{{ deposit.receiving_address }}</code>
          <button type="button" class="secondary" (click)="copyAddress(deposit.receiving_address)">Copy address</button>
          <figure class="crypto-qr">
            <img [src]="qrDataUrl()" alt="QR code for the receiving wallet address" />
            <figcaption>Scan in Trust Wallet · USDT (BEP-20)</figcaption>
          </figure>
          <label>Transaction hash<input type="text" [(ngModel)]="hash" placeholder="0x…" autocomplete="off" [disabled]="busy()"></label>
          <button type="button" (click)="submit(deposit)" [disabled]="busy() || !hash.trim()">I've sent the payment</button>
        </div>
        <div class="history-heading"><h4>Crypto history</h4><button type="button" class="secondary" (click)="refresh()">Refresh</button></div>
        <p *ngIf="!data.deposits.length" class="muted">No crypto deposits yet.</p>
        <article *ngFor="let deposit of data.deposits" class="deposit-row">
          <div><strong>{{ deposit.token_amount }} USDT</strong><span class="status">{{ statusLabel(deposit.status) }}</span></div>
          <small>{{ deposit.created_at | date:'short' }}</small>
          <strong *ngIf="deposit.status === 'completed'">Credited {{ deposit.usd_amount | currency:'USD' }}</strong>
          <a *ngIf="deposit.transaction_hash" [href]="'https://bscscan.com/tx/' + deposit.transaction_hash" target="_blank" rel="noopener noreferrer">View transaction</a>
          <p *ngIf="deposit.review_note">{{ deposit.review_note }}</p>
          <button *ngIf="deposit.status === 'awaiting_transfer'" type="button" class="secondary" (click)="resume(deposit)">Show address / submit hash</button>
        </article>
        </div>
        <div *ngIf="tab() === 'withdraw'">
          <ng-container *ngIf="data.settings.withdrawals_enabled; else noWithdrawals">
            <label>Amount (USD)<input type="text" inputmode="decimal" [(ngModel)]="withdrawAmount" [disabled]="busy()"></label>
            <label>USDT receiving address (BEP-20)<input type="text" [(ngModel)]="withdrawAddress" placeholder="0x…" autocomplete="off" [disabled]="busy()"></label>
            <p class="muted">1 USD = 1 USDT · Manual approval</p>
            <button type="button" (click)="withdraw()" [disabled]="busy()">Withdraw USDT</button>
          </ng-container>
          <ng-template #noWithdrawals><p>Withdrawals unavailable</p></ng-template>
          <div class="history-heading"><h4>Withdrawals</h4><button type="button" class="secondary" (click)="refresh()">Refresh</button></div>
          <article *ngFor="let withdrawal of data.withdrawals" class="deposit-row">
            <strong>{{ withdrawal.usd_amount | currency:'USD' }} · {{ withdrawal.token_amount }} USDT</strong>
            <span class="status">{{ withdrawal.status === 'failed' ? 'Refunded' : (withdrawal.status === 'completed' ? 'Paid' : 'Pending') }}</span>
            <small>{{ withdrawal.created_at | date:'short' }}</small><code>{{ withdrawal.receiving_address }}</code>
            <a *ngIf="withdrawal.transaction_hash" [href]="'https://bscscan.com/tx/' + withdrawal.transaction_hash" target="_blank" rel="noopener noreferrer">View transaction</a>
            <p *ngIf="withdrawal.review_note">{{ withdrawal.review_note }}</p>
          </article>
        </div>
        <div *ngIf="tab() === 'convert'">
          <p><strong>KES {{ data.kes_balance | number:'1.2-2' }}</strong> · {{ data.usd_balance | currency:'USD' }}</p>
          <ng-container *ngIf="data.settings.conversion_enabled && data.settings.usd_kes_rate_micros > 0; else noConversion">
            <p>1 USD = {{ data.settings.usd_kes_rate | number:'1.2-6' }} KES</p>
            <label>Convert<select [(ngModel)]="direction" [disabled]="busy()"><option value="usd_to_kes">USD → KES</option><option value="kes_to_usd">KES → USD</option></select></label>
            <label>Amount ({{ direction === 'usd_to_kes' ? 'USD' : 'KES' }})<input type="text" inputmode="decimal" [(ngModel)]="convertAmount" [disabled]="busy()"></label>
            <p>You receive {{ preview(data) | number:'1.2-2' }} {{ direction === 'usd_to_kes' ? 'KES' : 'USD' }}</p>
            <button type="button" (click)="convert(data)" [disabled]="busy() || preview(data) <= 0">Convert</button>
          </ng-container>
          <ng-template #noConversion><p>Conversion unavailable</p></ng-template>
          <h4>Conversions</h4>
          <article *ngFor="let conversion of data.conversions" class="deposit-row">
            <strong>{{ conversion.source_amount | number:'1.2-2' }} {{ conversion.direction === 'usd_to_kes' ? 'USD' : 'KES' }} → {{ conversion.target_amount | number:'1.2-2' }} {{ conversion.direction === 'usd_to_kes' ? 'KES' : 'USD' }}</strong>
            <small>{{ conversion.created_at | date:'short' }}</small>
          </article>
        </div>
      </ng-container>
      <p *ngIf="message()" role="status" class="message">{{ message() }}</p>
    </section>
  `,
  styleUrl: './crypto-wallet.css'
})
export class CryptoWalletComponent {
  private api = inject(CryptoApiService);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  tab = signal<'deposit' | 'withdraw' | 'convert'>('deposit');
  @Input() set startTab(value: 'deposit' | 'withdraw' | 'convert') { this.tab.set(value); }
  wallet = signal<CryptoWallet | null>(null);
  selected = signal<CryptoDeposit | null>(null);
  qrDataUrl = computed(() => {
    const deposit = this.selected();
    if (!deposit) return '';
    const qr = qrcode(0, 'M');
    qr.addData(deposit.receiving_address, 'Byte');
    qr.make();
    return qr.createDataURL(6, 24);
  });
  busy = signal(false);
  message = signal('');
  amount = '';
  hash = '';
  withdrawAmount = '';
  withdrawAddress = '';
  convertAmount = '';
  direction = 'usd_to_kes';
  private operationKeys = new Map<string, { signature: string; key: string }>();
  private operationKey(operation: string, signature: string) {
    const existing = this.operationKeys.get(operation);
    if (existing?.signature === signature) return existing.key;
    const key = crypto.randomUUID();
    this.operationKeys.set(operation, { signature, key });
    return key;
  }
  private loading = false;
  constructor() {
    timer(0, 10000).pipe(takeUntilDestroyed()).subscribe(() => this.refresh());
  }
  refresh() {
    if (this.loading) return;
    this.loading = true;
    this.api.wallet().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { this.wallet.set(data); this.loading = false; },
      error: error => { this.loading = false; this.message.set(error?.error?.error || 'Unable to load crypto wallet. Use Refresh to retry.'); }
    });
  }
  create() {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    this.api.create(this.amount).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => { this.selected.set(result.deposit); this.hash = ''; this.busy.set(false); this.refresh(); },
      error: error => { this.busy.set(false); this.message.set(error?.error?.error || 'Unable to create deposit.'); }
    });
  }
  resume(deposit: CryptoDeposit) { this.selected.set(deposit); this.hash = ''; this.message.set(''); }
  submit(deposit: CryptoDeposit) {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    this.api.submit(deposit.id, this.hash).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy.set(false); this.selected.set(null); this.hash = ''; this.message.set('Awaiting confirmation.'); this.refresh(); },
      error: error => { this.busy.set(false); this.message.set(error?.error?.error || 'Unable to submit transfer.'); }
    });
  }
  withdraw() {
    if (this.busy()) return;
    const key = this.operationKey('withdraw', JSON.stringify([this.withdrawAmount, this.withdrawAddress]));
    this.busy.set(true); this.message.set('');
    this.api.withdraw(this.withdrawAmount, this.withdrawAddress, key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy.set(false); this.operationKeys.delete('withdraw'); this.withdrawAmount = ''; this.message.set('Withdrawal pending. Amount reserved.'); this.refresh(); },
      error: error => { this.busy.set(false); this.message.set(error?.error?.error || 'Withdrawal failed.'); }
    });
  }
  preview(data: CryptoWallet) {
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(this.convertAmount) || !data.settings.usd_kes_rate_micros) return 0;
    const [whole, fraction = ''] = this.convertAmount.split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    const rate = BigInt(data.settings.usd_kes_rate_micros);
    return Number(this.direction === 'usd_to_kes' ? cents * rate / 1000000n : cents * 1000000n / rate) / 100;
  }
  convert(data: CryptoWallet) {
    if (this.busy()) return;
    const rate = data.settings.usd_kes_rate_micros;
    const key = this.operationKey('convert', JSON.stringify([this.convertAmount, this.direction]));
    this.busy.set(true); this.message.set('');
    this.api.convert(this.convertAmount, this.direction, rate, key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => { this.busy.set(false); this.operationKeys.delete('convert'); this.auth.updateBalance(result.balance); this.convertAmount = ''; this.message.set('Converted.'); this.refresh(); },
      error: error => { this.busy.set(false); this.message.set(error?.error?.error || 'Conversion failed.'); this.refresh(); }
    });
  }
  async copyAddress(address: string) {
    try { await navigator.clipboard.writeText(address); this.message.set('Address copied.'); }
    catch { this.message.set('Select and copy the address above.'); }
  }
  statusLabel(status: string) {
    return ({ awaiting_transfer: 'Awaiting transfer', pending: 'Awaiting verification', completed: 'Credited', failed: 'Rejected' } as Record<string, string>)[status] || status;
  }
}
