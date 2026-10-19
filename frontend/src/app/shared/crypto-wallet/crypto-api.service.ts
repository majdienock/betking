import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { getBackendOrigin } from '../../core/config/backend-url';

export interface CryptoSettings {
  enabled: boolean;
  receiving_address: string;
  asset: string;
  network: string;
  currency: string;
  withdrawals_enabled: boolean;
  conversion_enabled: boolean;
  usd_kes_rate: number;
  usd_kes_rate_micros: number;
}
export interface CryptoDeposit {
  id: string;
  user_id: number;
  receiving_address: string;
  token_amount: string;
  transaction_hash?: string;
  status: 'awaiting_transfer' | 'pending' | 'completed' | 'failed';
  usd_amount: number;
  review_note: string;
  created_at: string;
}
export interface CryptoWallet {
  usd_balance: number;
  kes_balance: number;
  settings: CryptoSettings;
  deposits: CryptoDeposit[];
  withdrawals: CryptoWithdrawal[];
  conversions: CryptoConversion[];
}
export interface CryptoWithdrawal {
  id: string; user_id: number; receiving_address: string; usd_amount: number; token_amount: string;
  status: string; transaction_hash?: string; review_note: string; created_at: string;
}
export interface CryptoConversion {
  id: string; direction: string; source_amount: number; target_amount: number; rate: number; created_at: string;
}
@Injectable({ providedIn: 'root' })
export class CryptoApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private get base() { return `${getBackendOrigin()}/api`; }
  private get options() { return { headers: { Authorization: `Bearer ${this.auth.getToken()}` } }; }
  wallet() { return this.http.get<CryptoWallet>(`${this.base}/crypto/wallet`, this.options); }
  create(amount: string) { return this.http.post<{ deposit: CryptoDeposit }>(`${this.base}/crypto/deposits`, { token_amount: amount }, this.options); }
  submit(id: string, hash: string) { return this.http.put<{ deposit: CryptoDeposit }>(`${this.base}/crypto/deposits/${id}/transfer`, { transaction_hash: hash }, this.options); }
  settings() { return this.http.get<CryptoSettings>(`${this.base}/admin/crypto/settings`, this.options); }
  save(settings: CryptoSettings) { return this.http.put<CryptoSettings>(`${this.base}/admin/crypto/settings`, settings, this.options); }
  deposits() { return this.http.get<{ deposits: CryptoDeposit[] }>(`${this.base}/admin/crypto/deposits`, this.options); }
  review(id: string, action: string, amount: string, note: string) {
    return this.http.post(`${this.base}/admin/crypto/deposits/${id}/review`, { action, usd_amount: amount, note }, this.options);
  }
  withdraw(amount: string, address: string, key: string) {
    return this.http.post(`${this.base}/crypto/withdrawals`, { usd_amount: amount, receiving_address: address, request_key: key }, this.options);
  }
  convert(amount: string, direction: string, rate: number, key: string) {
    return this.http.post<{ balance: number; usd_balance: number }>(`${this.base}/crypto/conversions`, {
      amount, direction, expected_rate_micros: rate, request_key: key
    }, this.options);
  }
  withdrawals() { return this.http.get<{ withdrawals: CryptoWithdrawal[] }>(`${this.base}/admin/crypto/withdrawals`, this.options); }
  reviewWithdrawal(id: string, action: string, hash: string, note: string) {
    return this.http.post(`${this.base}/admin/crypto/withdrawals/${id}/review`, { action, transaction_hash: hash, note }, this.options);
  }
}
