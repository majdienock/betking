const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayHeroTransactionFetcher } = require('../payhero-transactions');

const deposit = { provider_reference: 'payhero-request-1', external_reference: 'BETPESA-DEP-1', amount: 1 };
const paid = { reference: deposit.provider_reference, external_reference: deposit.external_reference,
  status: 'SUCCESS', success: true, amount: 1, provider_reference: 'MPESA-RECEIPT-1' };
const env = { PAYHERO_API_USERNAME: 'api-user', PAYHERO_API_PASSWORD: 'api-password' };

test('uses the specific payment reference instead of the paginated account ledger', async () => {
  const fetch = createPayHeroTransactionFetcher({ env, httpClient: { get: async (url, options) => {
    assert.equal(url, 'https://backend.payhero.co.ke/api/v2/transaction-status');
    assert.deepEqual(options.params, { reference: deposit.provider_reference });
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('api-user:api-password').toString('base64'));
    return { data: paid };
  } } });
  assert.deepEqual(await fetch(deposit), paid);
});

test('supports wrapped status responses and a configured authentication token', async () => {
  const fetch = createPayHeroTransactionFetcher({ env: { PAYHERO_AUTH_TOKEN: 'Basic saved-token' },
    httpClient: { get: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Basic saved-token');
      return { data: { response: paid } };
    } } });
  assert.deepEqual(await fetch(deposit), paid);
});

test('rejects unrelated payments even when their amount and phone could match', async () => {
  const fetch = createPayHeroTransactionFetcher({ env, httpClient: { get: async () => ({ data: {
    ...paid, reference: 'other-request', external_reference: 'other-deposit', amount: 1
  } }) } });
  assert.equal(await fetch(deposit), null);
});

test('provider timeouts, authentication errors and unrecognized responses remain unverified', async () => {
  for (const response of [null, [], { error: 'Not found' }]) {
    const fetch = createPayHeroTransactionFetcher({ env, httpClient: { get: async () => ({ data: response }) } });
    assert.equal(await fetch(deposit), null);
  }
  const fetch = createPayHeroTransactionFetcher({ env, httpClient: { get: async () => { throw new Error('Network error'); } } });
  assert.equal(await fetch(deposit), null);
});

test('missing credentials or provider references never query an unrelated transaction', async () => {
  const httpClient = { get: async () => { assert.fail('Unexpected provider request'); } };
  assert.equal(await createPayHeroTransactionFetcher({ httpClient, env: {} })(deposit), null);
  assert.equal(await createPayHeroTransactionFetcher({ httpClient, env })({ amount: 1 }), null);
});
