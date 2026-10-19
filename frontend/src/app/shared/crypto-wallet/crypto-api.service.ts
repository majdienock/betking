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
  settings: CryptoSettings;
  deposits: CryptoDeposit[];
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
}
