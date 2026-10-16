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
    assert.equal(calls.failed.length, verified.status === 'pending' || verified.success === false ? 0 : 1);
  }
});

test('the authenticated settled ledger format is accepted, while pending or outbound ledger entries are not credited', async () => {
  const ledger = { transaction_reference: 'provider-1', external_reference: deposit.external_reference,
    transaction_type: 'inbound_payment', amount: '100.00', provider_reference: 'RECEIPT-1' };
  const settled = setup(ledger);
  assert.equal((await settled.send()).code, 200);
  assert.equal(settled.calls.completed.length, 1);
  for (const entry of [{ ...ledger, status: 'pending' }, { ...ledger, status: 'PENDING', success: false },
    { ...ledger, status: 'processing', ResultCode: 0 }, { ...ledger, transaction_type: 'outbound_payment' }]) {
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

test('a successful payment recovers an old timeout failure', async () => {
  const { send, calls } = setup(payment, { ...deposit, status: 'failed' });
  assert.equal((await send()).code, 200);
  assert.equal(calls.completed.length, 1);
});

function settlementFixture({ status = 'pending', existingLedger = null, failLedger = false } = {}) {
  let state = { deposit: { ...deposit, user_id: 7, status }, balance: existingLedger?.status === 'completed' ? 100 : 0,
    ledger: existingLedger, credits: 0 };
  let queue = Promise.resolve();
  const events = [];
  const complete = serverFunction('completePendingMpesaDeposit', 'async function failPendingMpesaDeposit', {
    Deposit: {
      startSession: async () => ({
        withTransaction: work => {
          const next = queue.then(async () => {
            const before = structuredClone(state);
            try { return await work(); } catch (error) { state = before; throw error; }
          });
          queue = next.catch(() => {});
          return next;
        },
        endSession: async () => {}
      }),
      findOne: async () => ({ ...state.deposit }),
      findOneAndUpdate: async (_filter, update) => {
        if (state.deposit.status === 'completed') return null;
        state.deposit = { ...state.deposit, ...update.$set };
        return { ...state.deposit };
      }
    },
    User: { findOneAndUpdate: async (_filter, update) => {
      state.balance += update.$inc.balance;
      state.credits++;
      return { balance: state.balance };
    } },
    Transaction: {
      findOne: async () => state.ledger?.status === 'completed' ? state.ledger : null,
      findOneAndUpdate: async (_filter, update) => {
        if (failLedger) throw new Error('Ledger unavailable');
        if (state.ledger?.status !== 'failed') return null;
        state.ledger = { ...state.ledger, ...update.$set };
        return state.ledger;
      },
      create: async ([ledger]) => {
        if (failLedger) throw new Error('Ledger unavailable');
        state.ledger = { id: 1, ...ledger };
        return [state.ledger];
      }
    },
    emitRealtimeMutation: event => events.push(event), console: { error() {} }
  });
  return { complete, events, read: () => state };
}

test('racing callback and player status requests credit a deposit only once', async () => {
  const f = settlementFixture();
  await Promise.all([f.complete(deposit.external_reference, 100, 'RECEIPT-1', payment),
    f.complete(deposit.mpesa_checkout_request_id, 100, 'RECEIPT-1', payment)]);
  assert.equal(f.read().credits, 1);
  assert.equal(f.read().deposit.status, 'completed');
  assert.equal(f.events.length, 1);
});

test('recovery corrects the old failed ledger entry and credits the wallet once', async () => {
  const f = settlementFixture({ status: 'failed', existingLedger: { id: 4, status: 'failed', reference: deposit.external_reference } });
  await f.complete(deposit.external_reference, 100, 'RECEIPT-1', payment);
  assert.equal(f.read().deposit.status, 'completed');
  assert.equal(f.read().deposit.failure_reason, null);
  assert.equal(f.read().balance, 100);
  assert.equal(f.read().ledger.id, 4);
  assert.equal(f.read().ledger.status, 'completed');
  await f.complete(deposit.external_reference, 100, 'RECEIPT-1', payment);
  assert.equal(f.read().balance, 100);
});

test('a ledger error rolls back the deposit and wallet together so verification can retry', async () => {
  const f = settlementFixture({ failLedger: true });
  assert.equal(await f.complete(deposit.external_reference, 100, 'RECEIPT-1', payment), null);
  assert.equal(f.read().deposit.status, 'pending');
  assert.equal(f.read().balance, 0);
  assert.equal(f.events.length, 0);
});

test('repairing a stale failed status does not credit an already recorded receipt twice', async () => {
  const f = settlementFixture({ status: 'failed', existingLedger: { status: 'completed', mpesa_receipt_number: 'RECEIPT-1' } });
  await f.complete(deposit.external_reference, 100, 'RECEIPT-1', payment);
  assert.equal(f.read().deposit.status, 'completed');
  assert.equal(f.read().balance, 100);
  assert.equal(f.read().credits, 0);
});

test('background reconciliation never converts an old pending payment into a timeout failure', async () => {
  const updates = [];
  const pending = { ...deposit, created_at: new Date(Date.now() - 120000) };
  const reconcile = serverFunction('reconcilePendingMpesaDeposits', '// PayHero & M-Pesa STK Push', {
    Deposit: {
      find: () => ({ sort: () => ({ limit: async () => [pending] }) }),
      updateOne: async (_filter, update) => updates.push(update)
    },
    reconcileMpesaDeposit: async () => { throw new Error('Provider temporarily unavailable'); },
    console
  });
  await reconcile();
  assert.equal(pending.status, 'pending');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].$set.status, undefined);
  assert.ok(updates[0].$set.provider_checked_at);
});
