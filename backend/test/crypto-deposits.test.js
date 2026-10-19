const test = require('node:test');
const assert = require('node:assert/strict');
const { createCryptoRoutes, createCryptoService, usdCents, tokenAmount } = require('../crypto-deposits');
const { protectPayload } = require('../admin-privacy');

const address = '0x' + '0712345678'.repeat(4);
const hash = '0x' + 'a'.repeat(64);
const depositId = 'a'.repeat(24);
const request = (body = {}, patch = {}) => ({ user: { id: 1 }, params: { id: depositId }, body, ...patch });
const scoped = req => req.blockedClientIds?.length ? { user_id: { $nin: req.blockedClientIds } } : {};

test('USD uses exact integer cents and rejects invalid, fractional-cent and oversized values', () => {
  assert.equal(usdCents('10.01'), 1001);
  assert.equal(usdCents('0.29'), 29);
  assert.equal(usdCents('1000000'), 100000000);
  for (const value of ['', null, false, -1, 0, '1e3', '1.001', 'Infinity', '1000000.01', '12abc']) {
    assert.throws(() => usdCents(value), { status: 400 });
  }
  assert.equal(tokenAmount('0.000000000000000001'), '0.000000000000000001');
  for (const value of [0, -1, '1e3', '1000001', '0.0000000000000000001']) assert.throws(() => tokenAmount(value), { status: 400 });
});

function fixture() {
  let state = {
    user: { id: 7, balance: 555, usd_balance_cents: 11, is_suspended: false },
    deposit: { _id: depositId, user_id: 7, status: 'pending', token_amount: '10', receiving_address: address, transaction_hash: hash, usd_cents: 0 }
  };
  let queue = Promise.resolve();
  let ended = 0;
  const mongoose = { startSession: async () => ({
    async withTransaction(callback) {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      const snapshot = structuredClone(state);
      try { return await callback(); }
      catch (error) { state = snapshot; throw error; }
      finally { release(); }
    },
    endSession: async () => { ended++; }
  }) };
  const CryptoDeposit = {
    async findOneAndUpdate(filter, update, options) {
      assert.ok(options.session, 'Deposit and balance must use the same transaction');
      if (filter._id !== state.deposit._id || state.deposit.status !== filter.status || filter.user_id?.$nin.includes(state.deposit.user_id)) return null;
      Object.assign(state.deposit, update.$set); return state.deposit;
    }
  };
  const User = {
    async findOneAndUpdate(filter, update, options) {
      assert.ok(options.session);
      assert.deepEqual(Object.keys(update.$inc), ['usd_balance_cents']);
      if (!state.user || state.user.is_suspended) return null;
      state.user.usd_balance_cents += update.$inc.usd_balance_cents;
      return state.user;
    },
    findOne() { return { session: async () => state.user }; }
  };
  const service = createCryptoService({ User, CryptoDeposit, CryptoSetting: {}, mongoose, scope: scoped });
  return { service, state: () => state, ended: () => ended };
}

test('concurrent approval credits USD once, preserves KES and rejects a second review', async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled([
    f.service.review(request({ action: 'approve', usd_amount: '10.01' })),
    f.service.review(request({ action: 'approve', usd_amount: '10.01' }))
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(f.state().user.usd_balance_cents, 1012);
  assert.equal(f.state().user.balance, 555);
  assert.equal(f.state().deposit.status, 'completed');
  assert.equal(f.ended(), 2);
});

test('failed wallet credit rolls back the review, and scoped admins cannot approve another owner’s deposit', async () => {
  const f = fixture();
  f.state().user.is_suspended = true;
  await assert.rejects(f.service.review(request({ action: 'approve', usd_amount: '10' })), { status: 409 });
  assert.equal(f.state().deposit.status, 'pending');
  assert.equal(f.state().user.usd_balance_cents, 11);
  f.state().user.is_suspended = false;
  await assert.rejects(f.service.review(request({ action: 'approve', usd_amount: '10' }, { blockedClientIds: [7] })), { status: 409 });
  assert.equal(f.state().deposit.status, 'pending');
});

test('rejection requires a reason, retains hash and never credits USD', async () => {
  const f = fixture();
  await assert.rejects(f.service.review(request({ action: 'reject' })), { status: 400 });
  await f.service.review(request({ action: 'reject', note: 'Wrong receiving address' }));
  assert.equal(f.state().deposit.status, 'failed');
  assert.equal(f.state().deposit.transaction_hash, hash);
  assert.equal(f.state().user.usd_balance_cents, 11);
});

test('privacy masking preserves valid crypto identifiers while still masking player phones', () => {
  const result = protectPayload({ deposits: [{ user_id: 7, receiving_address: address, transaction_hash: hash, phone_number: '0712345678' }] },
    [{ id: 7, phone_number: '0712345678', owner_tag: 'R' }]);
  assert.equal(result.deposits[0].receiving_address, address);
  assert.equal(result.deposits[0].transaction_hash, hash);
  assert.equal(result.deposits[0].phone_number, '071*****78');
});

test('player API snapshots addresses, authenticates requests, validates hashes and prevents cross-player reuse', async () => {
  const deposits = new Map();
  let setting = { enabled: true, receiving_address: address };
  let indexesChecked = 0;
  const CryptoDeposit = {
    async create(data) {
      const record = { ...data, _id: String(deposits.size + 1).padStart(24, 'a'), status: 'awaiting_transfer', usd_cents: 0 };
      deposits.set(record._id, record); return record;
    },
    async createIndexes() { indexesChecked++; },
    async findOneAndUpdate(filter, update) {
      const record = deposits.get(filter._id);
      if (!record || record.user_id !== filter.user_id || record.status !== filter.status) return null;
      if ([...deposits.values()].some(row => row.transaction_hash === update.$set.transaction_hash)) throw Object.assign(new Error('Duplicate'), { code: 11000 });
      Object.assign(record, update.$set); return record;
    }
  };
  const { player } = createCryptoRoutes({
    models: { CryptoDeposit, CryptoSetting: { findById: () => ({ lean: async () => setting }) },
      User: { findOne: () => ({ select: () => ({ lean: async () => ({ id: 7 }) }) }) } },
    authenticateToken(req, res, next) {
      if (!req.headers.authorization) return res.status(401).json({ error: 'Authentication required' });
      req.user = { id: Number(req.headers.authorization) }; next();
    }, scope: scoped
  });
  // Dispatch through the real router without opening sockets in restricted environments.
  const call = (path, method, body, user = '7') => new Promise((resolve, reject) => {
    let status = 200;
    player.handle({ url: path, method, body, headers: user ? { authorization: user } : {} }, {
      set() {}, status(code) { status = code; return this; },
      json(result) { resolve({ status, json: async () => result }); return this; }
    }, error => reject(error || new Error('Route not found')));
  });
  assert.equal((await call('/deposits', 'POST', { token_amount: '10' }, '')).status, 401);
  let response = await call('/deposits', 'POST', { token_amount: '10' });
  assert.equal(response.status, 201);
  const first = (await response.json()).deposit;
  setting = { enabled: false, receiving_address: '0x' + 'b'.repeat(40) };
  assert.equal((await call('/deposits', 'POST', { token_amount: '10' })).status, 400);
  assert.equal(first.receiving_address, address);
  assert.equal((await call(`/deposits/${first.id}/transfer`, 'PUT', { transaction_hash: hash }, '8')).status, 409);
  assert.equal((await call(`/deposits/${first.id}/transfer`, 'PUT', { transaction_hash: 'bad' })).status, 400);
  assert.equal((await call(`/deposits/${first.id}/transfer`, 'PUT', { transaction_hash: hash })).status, 200);
  assert.equal(deposits.get(first.id).status, 'pending');
  assert.equal(deposits.get(first.id).usd_cents, 0);
  setting.enabled = true;
  response = await call('/deposits', 'POST', { token_amount: '10' }, '8');
  const second = (await response.json()).deposit;
  assert.equal((await call(`/deposits/${second.id}/transfer`, 'PUT', { transaction_hash: hash.toUpperCase().replace('0X', '0x') }, '8')).status, 409);
  assert.equal(deposits.get(second.id).status, 'awaiting_transfer');
  assert.equal(indexesChecked, 1);
});
