import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoWalletComponent } from './crypto-wallet.component';
import { CryptoAdminComponent } from './crypto-admin.component';
import { CryptoApiService } from './crypto-api.service';
import { AuthService } from '../../core/services/auth.service';
import { AdminPinService } from '../../core/services/admin-pin.service';

describe('Wallet after crypto deposits are removed', () => {
  let fixture: ComponentFixture<CryptoWalletComponent> | ComponentFixture<CryptoAdminComponent>;
  let api: any;
  const settings = () => ({ enabled: true, receiving_address: '0x' + 'a'.repeat(40), asset: 'USDT', network: 'BEP-20', currency: 'USD',
    withdrawals_enabled: true, conversion_enabled: true, usd_kes_rate: 130, usd_kes_rate_micros: 130000000 });
  const deposit = { id: 'a'.repeat(24), user_id: 7, receiving_address: '0x' + 'a'.repeat(40), token_amount: '10',
    status: 'awaiting_transfer', usd_amount: 0, review_note: '', created_at: '2026-04-24T14:01:05Z' };
  beforeEach(async () => {
    vi.useFakeTimers();
    api = { wallet: vi.fn(() => of({ usd_balance: 12.34, kes_balance: 555, settings: settings(),
      deposits: [deposit], withdrawals: [], conversions: [] })),
      settings: vi.fn(() => of(settings())), deposits: vi.fn(() => of({ deposits: [deposit] })),
      withdrawals: vi.fn(() => of({ withdrawals: [] })),
      save: vi.fn((value: any) => of(value)) };
    await TestBed.configureTestingModule({ imports: [CryptoWalletComponent, CryptoAdminComponent], providers: [
      { provide: CryptoApiService, useValue: api },
      { provide: AuthService, useValue: { updateBalance: vi.fn() } },
      { provide: AdminPinService, useValue: { changed$: new Subject() } }
    ] }).compileComponents();
  });
  afterEach(() => { fixture?.destroy(); vi.useRealTimers(); });

  it('keeps the USD balance, withdrawal and conversion available with no deposit entry point', () => {
    fixture = TestBed.createComponent(CryptoWalletComponent);
    fixture.detectChanges();
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.usd-balance')?.textContent).toContain('12.34');
    expect(Array.from(root.querySelectorAll('nav button')).map(button => button.textContent?.trim())).toEqual(['Withdraw', 'Convert', 'History']);
    expect(root.textContent).toContain('Withdraw USDT');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).not.toContain('Get deposit address');
  });

  it('retains previous deposit history without a way to resume sending or submit a transfer', () => {
    const walletFixture = TestBed.createComponent(CryptoWalletComponent);
    fixture = walletFixture;
    walletFixture.componentInstance.startTab = 'history';
    fixture.detectChanges();
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('10 USDT');
    expect(root.textContent).toContain('Not submitted');
    expect(root.querySelector('input')).toBeNull();
    expect(root.textContent).not.toContain('Show address');
    expect(root.textContent).not.toContain("I've sent the payment");
  });

  it('removes deposit setup from admin and cannot restore deposits while saving other wallet settings', () => {
    const adminFixture = TestBed.createComponent(CryptoAdminComponent);
    fixture = adminFixture;
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).not.toContain('Enable USDT deposits');
    expect(root.textContent).not.toContain('Trust Wallet receiving address');
    expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(root.textContent).toContain('Previous crypto deposits');
    adminFixture.componentInstance.save();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, receiving_address: '',
      withdrawals_enabled: true, conversion_enabled: true }));
  });
});
