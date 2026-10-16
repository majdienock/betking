const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPayHeroCallbackHandler } = require('../payhero-callback');

const deposit = { _id: 'dep-1', id: 1, external_reference: 'BETPESA-DEP-1', mpesa_checkout_request_id: 'checkout-1', amount: 100, status: 'pending' };
const payment = { external_reference: deposit.external_reference, status: 'success', amount: 100, provider_reference: 'RECEIPT-1' };

function setup(verified = payment, stored = { ...deposit }) {
  const calls = { queries: 0, completed: [], failed: [] };
  const handler = createPayHeroCallbackHandler({
    Deposit: { findOne: async () => stored },
    queryTransaction: async (found, options) => {
      assert.equal(found, stored);
      assert.equal(options.strictReference, true);
      calls.queries++;
      return verified;
    },
    completeDeposit: async (...args) => { calls.completed.push(args); return stored; },
    failDeposit: async (...args) => { calls.failed.push(args); return stored; }
  });
  async function send(body = { response: { ExternalReference: deposit.external_reference } }) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ body }, res);
    return res;
  }
  return { calls, send };
}

test('token-free callbacks credit only authenticated provider data, ignoring forged amounts and receipts', async () => {
  const { send, calls } = setup();
  assert.equal((await send({ response: { ExternalReference: deposit.external_reference, Status: 'Success', Amount: 999999, MpesaReceiptNumber: 'FORGED' } })).code, 200);
  assert.deepEqual(calls.completed, [[deposit.external_reference, 100, 'RECEIPT-1', payment]]);
  assert.equal(calls.queries, 1);
});

test('provider failures and pending payments cannot be turned into success by a callback', async () => {
  for (const verified of [{ ...payment, status: 'pending' }, { ...payment, status: 'failed' }, { ...payment, success: false }, { ...payment, ResultCode: 1 }]) {
    const { send, calls } = setup(verified);
    assert.equal((await send({ external_reference: deposit.external_reference, Status: 'Success' })).code, 200);
    assert.equal(calls.completed.length, 0);
    assert.equal(calls.failed.length, verified.status === 'pending' ? 0 : 1);
  }
});

test('the authenticated settled ledger format is accepted, while pending or outbound ledger entries are not credited', async () => {
  const ledger = { transaction_reference: 'provider-1', external_reference: deposit.external_reference,
    transaction_type: 'inbound_payment', amount: '100.00', provider_reference: 'RECEIPT-1' };
  const settled = setup(ledger);
  assert.equal((await settled.send()).code, 200);
  assert.equal(settled.calls.completed.length, 1);
  for (const entry of [{ ...ledger, status: 'pending' }, { ...ledger, transaction_type: 'outbound_payment' }]) {
    const pending = setup(entry);
    assert.equal((await pending.send()).code, 200);
    assert.equal(pending.calls.completed.length, 0);
  }
});

test('reference, amount and receipt mismatches leave the wallet untouched and request a retry', async () => {
  for (const verified of [null, { ...payment, external_reference: 'another-deposit' }, { ...payment, amount: 200 }, { ...payment, amount: '100invalid' }, { ...payment, provider_reference: '' }]) {
    const { send, calls } = setup(verified);
    assert.equal((await send()).code, 503);
    assert.equal(calls.completed.length, 0);
    assert.equal(calls.failed.length, 0);
  }
});

test('missing, unknown and already completed references never contact the provider or credit a wallet', async () => {
  const missing = setup();
  assert.equal((await missing.send({ response: { ExternalReference: { $ne: null } } })).code, 400);
  assert.equal(missing.calls.queries, 0);
  for (const stored of [null, { ...deposit, status: 'completed' }]) {
    const { send, calls } = setup(payment, stored);
    assert.equal((await send()).code, 200);
    assert.equal(calls.queries, 0);
    assert.equal(calls.completed.length, 0);
  }
});

test('simultaneous callback aliases reconcile the same deposit once', async () => {
  const { send, calls } = setup();
  const responses = await Promise.all([send(), send({ CheckoutRequestID: deposit.mpesa_checkout_request_id })]);
  assert.ok(responses.every(res => res.code === 200));
  assert.equal(calls.queries, 1);
  assert.equal(calls.completed.length, 1);
});

test('an unavailable provider returns a generic retry response without leaking credentials', async () => {
  const handler = createPayHeroCallbackHandler({
    Deposit: { findOne: async () => deposit },
    queryTransaction: async () => { throw new Error('secret provider credential'); }
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { external_reference: deposit.external_reference } }, res);
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

// Exercise the server helpers without starting its HTTP server or connecting MongoDB.
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
function serverFunction(name, endMarker, globals) {
  const start = source.indexOf('async function ' + name + '(');
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext('(' + source.slice(start, end).trim() + ')', globals);
}

test('public callbacks cannot use the legacy amount/phone heuristic to match another deposit', async () => {
  const { paymentReferences } = require('../payhero-callback');
  const otherPayment = { ...payment, external_reference: 'other-deposit', transaction_type: 'inbound_payment', description: 'payment 712345678', created_at: new Date().toISOString() };
  const query = serverFunction('queryPayHeroTransactionStatus', '// STK Status Check', {
    process: { env: { PAYHERO_API_USERNAME: 'user', PAYHERO_API_PASSWORD: 'password' } },
    PAYHERO_AUTH_TOKEN: undefined, PAYHERO_API_USERNAME: undefined, PAYHERO_API_PASSWORD: undefined,
    PAYHERO_BASE_URL: 'https://provider.example/api/v2', Buffer, paymentReferences,
    axios: { get: async () => ({ data: { response: [otherPayment] } }) },
    Deposit: { findOne: async () => null }
  });
  assert.equal(await query({ ...deposit, payer_phone: '+254712345678', created_at: new Date() }, { strictReference: true }), null);
  assert.equal(await query({ ...deposit, payer_phone: '+254712345678', created_at: new Date() }), otherPayment);
});

test('racing callback and player status requests credit a deposit only once', async () => {
  let stored = { ...deposit, user_id: 7 };
  let credits = 0;
  const complete = serverFunction('completePendingMpesaDeposit', 'async function failPendingMpesaDeposit', {
    Deposit: {
      findOne: async () => ({ ...stored }),
      findOneAndUpdate: async (_filter, update) => {
        if (stored.status === 'completed') return null;
        stored = { ...stored, ...update.$set };
        return { ...stored };
      },
      findById: async () => ({ ...stored })
    },
    User: { findOneAndUpdate: async () => { credits++; return { balance: 100 }; } },
    Transaction: { create: async () => ({ id: 1 }) },
    emitRealtimeMutation() {}, console
  });
  await Promise.all([complete(deposit.external_reference, 100, 'RECEIPT-1', payment), complete(deposit.mpesa_checkout_request_id, 100, 'RECEIPT-1', payment)]);
  assert.equal(credits, 1);
  assert.equal(stored.status, 'completed');
});
