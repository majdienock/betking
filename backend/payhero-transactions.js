const { paymentReferences } = require('./payhero-callback');

function createPayHeroTransactionFetcher({ httpClient, env = process.env }) {
  return async deposit => {
    // This is the reference returned by POST /payments, not the M-Pesa receipt
    // or an arbitrary transaction from the account's paginated wallet ledger.
    const reference = deposit.provider_reference;
    if (typeof reference !== 'string' || !reference.trim()) return null;
    let authorization;
    if (env.PAYHERO_AUTH_TOKEN?.trim()) {
      const token = env.PAYHERO_AUTH_TOKEN.trim();
      authorization = /^(Basic|Bearer) /i.test(token) ? token : `Basic ${token}`;
    } else if (env.PAYHERO_API_USERNAME?.trim() && env.PAYHERO_API_PASSWORD?.trim()) {
      authorization = `Basic ${Buffer.from(`${env.PAYHERO_API_USERNAME.trim()}:${env.PAYHERO_API_PASSWORD.trim()}`).toString('base64')}`;
    }
    if (!authorization) return null;
    try {
      const result = await httpClient.get(`${(env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke/api/v2').replace(/\/+$/, '')}/transaction-status`, {
        params: { reference },
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        timeout: 5000
      });
      const payment = result.data?.response || result.data;
      if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return null;
      const expected = [reference, deposit.external_reference, deposit.mpesa_checkout_request_id].filter(Boolean);
      if (!paymentReferences(payment).some(ref => expected.includes(ref))) return null;
      return payment;
    } catch (error) {
      // Network/authentication errors are not a failed customer payment.
      return null;
    }
  };
}

module.exports = { createPayHeroTransactionFetcher };
