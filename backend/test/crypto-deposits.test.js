const test = require('node:test');
const assert = require('node:assert/strict');
const { createCryptoRoutes, createCryptoService, usdCents } = require('../crypto-deposits');
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

function retiredRoutes() {
  const state = { setting: { enabled: true, receiving_address: address, withdrawals_enabled: true,
    conversion_enabled: true, usd_kes_rate_micros: 130000000 }, user: { balance: 555, usd_balance_cents: 1011 },
    deposits: [{ _id: depositId, user_id: 7, status: 'pending', token_amount: '10', receiving_address: address,
      transaction_hash: hash, usd_cents: 0 }], writes: 0 };
  const history = rows => ({ sort() { return this; }, limit() { return this; }, lean: async () => structuredClone(rows) });
  const noWrite = async () => { state.writes++; throw new Error('Retired deposit must not write'); };
  const models = {
    User: { findOne: () => ({ select: () => ({ lean: async () => state.user }) }), findOneAndUpdate: noWrite },
    CryptoSetting: {
      findById: () => ({ lean: async () => state.setting }),
      findByIdAndUpdate: async (id, update) => { assert.equal(id, 'trust_wallet'); Object.assign(state.setting, update.$set); }
    },
    CryptoDeposit: { create: noWrite, findOneAndUpdate: noWrite, createIndexes: noWrite,
      find: filter => { assert.deepEqual(filter, { user_id: 7 }); return history(state.deposits); } },
    CryptoWithdrawal: { find: () => history([]) }, CryptoConversion: { find: () => history([]) }
  };
  const routes = createCryptoRoutes({ models, authenticateToken(req, res, next) {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 7 }; next();
  }, scope: scoped });
  const call = (router, path, method, body = {}, authenticated = true) => new Promise((resolve, reject) => {
    let status = 200;
    router.handle({ url: path, method, body, user: { id: 7 }, headers: authenticated ? { authorization: 'test-token' } : {} }, {
      set() {}, status(code) { status = code; return this; },
      json(result) { resolve({ status, body: result }); return this; }
    }, cause => reject(cause || new Error('Route not found')));
  });
  return { state, routes, call };
}

test('retired player deposit routes reject old clients without creating records, transferring hashes or touching balances', async () => {
  const f = retiredRoutes();
  const before = structuredClone(f.state);
  assert.equal((await f.call(f.routes.player, '/deposits', 'POST', {}, false)).status, 401);
  for (const [path, method, body] of [
    ['/deposits', 'POST', { token_amount: '10' }],
    [`/deposits/${depositId}/transfer`, 'PUT', { transaction_hash: hash }]
  ]) {
    const response = await f.call(f.routes.player, path, method, body);
    assert.equal(response.status, 410);
    assert.match(response.body.error, /M-Pesa/);
  }
  assert.deepEqual(f.state, before);
});

test('legacy enabled settings cannot reopen deposits or expose a new receiving address, and wallet settings still save', async () => {
  const f = retiredRoutes();
  const loaded = await f.call(f.routes.admin, '/settings', 'GET');
  assert.equal(loaded.body.enabled, false);
  assert.equal(loaded.body.receiving_address, '');
  assert.equal(loaded.body.withdrawals_enabled, true);
  assert.equal((await f.call(f.routes.admin, '/settings', 'PUT', { enabled: true, receiving_address: address })).status, 410);
  assert.equal(f.state.setting.enabled, true); // The rejected request changed no data.
  const saved = await f.call(f.routes.admin, '/settings', 'PUT', {
    withdrawals_enabled: true, conversion_enabled: true, usd_kes_rate: '131.25', receiving_address: 'replace-address'
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.enabled, false);
  assert.equal(saved.body.usd_kes_rate_micros, 131250000);
  assert.equal(f.state.setting.receiving_address, address);
  assert.equal(f.state.setting.withdrawals_enabled, true);
  assert.equal(f.state.setting.conversion_enabled, true);
  assert.equal(f.state.writes, 0);
});

test('wallet reads retain previous deposits and both currency balances after deposits are removed', async () => {
  const f = retiredRoutes();
  const before = structuredClone(f.state);
  const response = await f.call(f.routes.player, '/wallet', 'GET');
  assert.equal(response.status, 200);
  assert.equal(response.body.usd_balance, 10.11);
  assert.equal(response.body.kes_balance, 555);
  assert.equal(response.body.settings.enabled, false);
  assert.equal(response.body.deposits[0].transaction_hash, hash);
  assert.equal(response.body.deposits[0].status, 'pending');
  assert.deepEqual(f.state, before);
});
