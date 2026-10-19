import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { CryptoApiService, CryptoDeposit, CryptoWallet } from './crypto-api.service';
import qrcode from 'qrcode-generator';

@Component({
  selector: 'app-crypto-wallet', standalone: true, imports: [CommonModule, FormsModule],
  template: `
    <section class="crypto-card" aria-label="Crypto deposit and USD wallet">
      <div class="crypto-heading"><div><span class="eyebrow">TRUST WALLET · BEP-20</span><h3>Crypto deposit</h3></div>
        <div class="usd-balance"><small>USD wallet</small><strong>{{ wallet() ? (wallet()!.usd_balance | currency:'USD') : '—' }}</strong></div>
      </div>
      <p>Send USDT on BNB Smart Chain (BEP-20). Confirmed deposits are credited to your separate USD wallet.</p>
      <p class="muted">Your KES playing balance stays separate. USD funds currently have no betting, conversion or withdrawal option.</p>
      <p *ngIf="!wallet() && !message()">Loading crypto wallet…</p>
      <ng-container *ngIf="wallet() as data">
        <div *ngIf="data.settings.enabled; else unavailable">
          <label>Amount to send (USDT)<input type="text" inputmode="decimal" [(ngModel)]="amount" placeholder="e.g. 10.00" [disabled]="busy()"></label>
          <button type="button" (click)="create()" [disabled]="busy()">{{ busy() ? 'Please wait…' : 'Get deposit address' }}</button>
        </div>
        <ng-template #unavailable><p>Crypto deposits are currently unavailable. Existing requests are listed below.</p></ng-template>
        <div *ngIf="selected() as deposit" class="transfer-box">
          <h4>Send {{ deposit.token_amount }} USDT · BEP-20</h4>
          <p>In Trust Wallet, choose USDT on BNB Smart Chain, then send to:</p>
          <code>{{ deposit.receiving_address }}</code>
          <button type="button" class="secondary" (click)="copyAddress(deposit.receiving_address)">Copy address</button>
          <figure class="crypto-qr">
            <img [src]="qrDataUrl()" alt="QR code for the receiving wallet address" />
            <figcaption>Scan in Trust Wallet · USDT (BEP-20)</figcaption>
          </figure>
          <p class="network-note">Use BEP-20 only. Sending another asset or network may result in lost funds. Keep BNB available for the network fee.</p>
          <label>Transaction hash<input type="text" [(ngModel)]="hash" placeholder="0x…" autocomplete="off" [disabled]="busy()"></label>
          <button type="button" (click)="submit(deposit)" [disabled]="busy() || !hash.trim()">I've sent the payment</button>
          <p class="muted">Admin verifies the on-chain transfer and its USD value before crediting. Submitting a hash does not credit your balance.</p>
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
      </ng-container>
      <p *ngIf="message()" role="status" class="message">{{ message() }}</p>
    </section>
  `,
  styleUrl: './crypto-wallet.css'
})
export class CryptoWalletComponent {
  private api = inject(CryptoApiService);
  private destroyRef = inject(DestroyRef);
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
      next: () => { this.busy.set(false); this.selected.set(null); this.hash = ''; this.message.set('Transfer submitted. Awaiting admin verification and USD credit.'); this.refresh(); },
      error: error => { this.busy.set(false); this.message.set(error?.error?.error || 'Unable to submit transfer.'); }
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
