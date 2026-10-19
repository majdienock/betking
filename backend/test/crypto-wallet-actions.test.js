const test = require('node:test');
const assert = require('node:assert/strict');
const { createWalletActions, convertedCents, rateMicros } = require('../crypto-wallet-actions');
const { usdCents } = require('../crypto-deposits');

const key = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const address = '0x' + 'a'.repeat(40);
const hash = '0x' + 'b'.repeat(64);
const req = body => ({ user: { id: 7 }, body, params: {} });
const query = value => ({ session() { return this; }, lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
function matches(row, filter) {
  return row && Object.entries(filter).every(([field, value]) => {
    if (value && typeof value === 'object') {
      if ('$gte' in value) return row[field] >= value.$gte;
      if ('$ne' in value) return row[field] !== value.$ne;
      if ('$nin' in value) return !value.$nin.includes(row[field]);
    }
    return row[field] === value;
  });
}
function evaluate(value, user) {
  if (typeof value === 'string' && value.startsWith('$')) return user[value.slice(1)];
  if (!value || typeof value !== 'object') return value;
  if (value.$ifNull) return evaluate(value.$ifNull[0], user) ?? value.$ifNull[1];
  if (value.$add) return value.$add.reduce((sum, item) => sum + evaluate(item, user), 0);
  if (value.$round) return Math.round(evaluate(value.$round[0], user) * 100) / 100;
  throw new Error('Unsupported update expression');
}
function fixture() {
  let state = { user: { id: 7, usd_balance_cents: 2000, balance: 1300, is_suspended: false },
    settings: { withdrawals_enabled: true, conversion_enabled: true, usd_kes_rate_micros: 130000000 },
    withdrawals: [], conversions: [], failCreate: false };
  let queue = Promise.resolve();
  const mongoose = { async startSession() { return {
    async withTransaction(callback) {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      const snapshot = structuredClone(state);
      try { return await callback(); } catch (error) { state = snapshot; throw error; } finally { release(); }
    }, async endSession() {}
  }; } };
  function ledger(name) {
    return {
      async createIndexes() {},
      findOne(filter) { return query(state[name].find(row => matches(row, filter))); },
      async create(rows, { session }) {
        assert.ok(session);
        if (state.failCreate) throw new Error('Ledger unavailable');
        const row = { ...rows[0], _id: String(state[name].length + 1).padStart(24, 'a'), status: 'pending' };
        state[name].push(row); return [row];
      },
      async findOneAndUpdate(filter, update, { session }) {
        assert.ok(session);
        const row = state[name].find(row => matches(row, filter));
        if (!row) return null;
        if (update.$set.transaction_hash && state[name].some(other => other.transaction_hash === update.$set.transaction_hash)) {
          throw Object.assign(new Error('Duplicate payout hash'), { code: 11000 });
        }
        Object.assign(row, update.$set); return row;
      }
    };
  }
  const User = {
    findOne() { return query(state.user); },
    async findOneAndUpdate(filter, update, { session }) {
      assert.ok(session);
      if (!matches(state.user, filter)) return null;
      if (Array.isArray(update)) {
        const next = Object.fromEntries(Object.entries(update[0].$set).map(([field, value]) => [field, evaluate(value, state.user)]));
        Object.assign(state.user, next);
      } else for (const [field, value] of Object.entries(update.$inc)) state.user[field] = (state.user[field] || 0) + value;
      return state.user;
    }
  };
  const actions = createWalletActions({ models: { User, CryptoSetting: { findById: () => query(state.settings) },
    CryptoWithdrawal: ledger('withdrawals'), CryptoConversion: ledger('conversions') }, mongoose, money: usdCents,
    scope: request => request.blockedClientIds ? { user_id: { $nin: request.blockedClientIds } } : {} });
  return { actions, state: () => state };
}

test('conversion uses exact decimal rates and rounds down to destination cents', () => {
  assert.equal(rateMicros('129.123456'), 129123456);
  assert.equal(convertedCents(1001, rateMicros('130'), 'usd_to_kes'), 130130);
  assert.equal(convertedCents(1300, rateMicros('130'), 'kes_to_usd'), 10);
  assert.equal(convertedCents(100, rateMicros('1.009999'), 'usd_to_kes'), 100);
  for (const value of ['0', '-1', '1e3', '1.0000001', '1000000.1']) assert.throws(() => rateMicros(value));
  assert.throws(() => convertedCents(1, rateMicros('130'), 'kes_to_usd'));
});
test('withdrawal reserves USD once across concurrent retries and cannot overdraw', async () => {
  const f = fixture();
  const request = req({ usd_amount: '15', receiving_address: address, request_key: key });
  await Promise.all([f.actions.withdraw(request), f.actions.withdraw(request)]);
  assert.equal(f.state().user.usd_balance_cents, 500);
  assert.equal(f.state().user.balance, 1300);
  assert.equal(f.state().withdrawals.length, 1);
  await assert.rejects(f.actions.withdraw(req({ ...request.body, usd_amount: '6', request_key: key.replaceAll('a', 'b') })), { status: 400 });
});
test('rejecting a withdrawal refunds exactly once; completion retains the reservation', async () => {
  const f = fixture();
  await f.actions.withdraw(req({ usd_amount: '5', receiving_address: address, request_key: key }));
  const review = { ...req({ action: 'reject', note: 'Address correction requested' }), params: { id: f.state().withdrawals[0]._id } };
  await f.actions.reviewWithdrawal(review);
  assert.equal(f.state().user.usd_balance_cents, 2000);
  await assert.rejects(f.actions.reviewWithdrawal(review), { status: 409 });
  await f.actions.withdraw(req({ usd_amount: '5', receiving_address: address, request_key: key.replaceAll('a', 'c') }));
  const complete = { ...req({ action: 'complete', transaction_hash: hash }), params: { id: f.state().withdrawals[1]._id } };
  await f.actions.reviewWithdrawal(complete);
  assert.equal(f.state().user.usd_balance_cents, 1500);
  assert.equal(f.state().withdrawals[1].transaction_hash, hash);
  await assert.rejects(f.actions.reviewWithdrawal({ ...complete, body: { action: 'reject', note: 'Repeat' } }), { status: 409 });
});
test('conversion updates both balances once, blocks stale rates and rolls back ledger failures', async () => {
  const f = fixture();
  const conversion = req({ amount: '10', direction: 'usd_to_kes', expected_rate_micros: 130000000, request_key: key });
  await Promise.all([f.actions.convert(conversion), f.actions.convert(conversion)]);
  assert.equal(f.state().user.usd_balance_cents, 1000);
  assert.equal(f.state().user.balance, 2600);
  assert.equal(f.state().conversions.length, 1);
  const reverse = req({ ...conversion.body, amount: '130', direction: 'kes_to_usd', request_key: key.replaceAll('a', 'b') });
  await f.actions.convert(reverse);
  assert.equal(f.state().user.usd_balance_cents, 1100);
  assert.equal(f.state().user.balance, 2470);
  await assert.rejects(f.actions.convert(req({ ...reverse.body, expected_rate_micros: 1, request_key: key.replaceAll('a', 'c') })), { status: 409 });
  f.state().failCreate = true;
  await assert.rejects(f.actions.convert(req({ ...reverse.body, request_key: key.replaceAll('a', 'd') })));
  assert.equal(f.state().user.usd_balance_cents, 1100);
  assert.equal(f.state().user.balance, 2470);
});
test('disabled operations and private admin scopes cannot debit or review funds', async () => {
  const f = fixture();
  const body = { usd_amount: '5', receiving_address: address, request_key: key };
  f.state().settings.withdrawals_enabled = false;
  await assert.rejects(f.actions.withdraw(req(body)), { status: 400 });
  f.state().settings.withdrawals_enabled = true;
  await f.actions.withdraw(req(body));
  await assert.rejects(f.actions.reviewWithdrawal({ ...req({ action: 'reject', note: 'Test' }),
    params: { id: f.state().withdrawals[0]._id }, blockedClientIds: [7] }), { status: 409 });
  assert.equal(f.state().user.usd_balance_cents, 1500);
  f.state().settings.conversion_enabled = false;
  await assert.rejects(f.actions.convert(req({ amount: '1', direction: 'usd_to_kes', request_key: key, expected_rate_micros: 130000000 })), { status: 400 });
});
