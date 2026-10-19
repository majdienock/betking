const express = require('express');
const { createWalletActions, rateMicros, withdrawalView, conversionView } = require('./crypto-wallet-actions');

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ID = /^[0-9a-f]{24}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });

function tokenAmount(value) {
  const amount = String(value ?? '').trim();
  if (!/^\d{1,7}(?:\.\d{1,18})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1000000) {
    throw fail(400, 'Enter a USDT amount greater than zero and no more than 1,000,000 (up to 18 decimals).');
  }
  return amount;
}
function usdCents(value) {
  const amount = String(value ?? '').trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount)) throw fail(400, 'Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > 100000000) throw fail(400, 'Amount must be between 0.01 and 1,000,000.');
  return cents;
}
const serialize = deposit => ({
  id: String(deposit._id), user_id: deposit.user_id, asset: deposit.asset, network: deposit.network,
  receiving_address: deposit.receiving_address, token_amount: deposit.token_amount,
  transaction_hash: deposit.transaction_hash, status: deposit.status,
  usd_amount: deposit.usd_cents / 100, review_note: deposit.review_note,
  created_at: deposit.created_at, reviewed_at: deposit.reviewed_at
});

function createCryptoService({ User, CryptoSetting, CryptoDeposit, mongoose, scope = () => ({}) }) {
  const getSettings = async () => {
    const setting = await CryptoSetting.findById('trust_wallet').lean();
    return { enabled: Boolean(setting?.enabled), receiving_address: setting?.receiving_address || '', asset: 'USDT', network: 'BEP-20', currency: 'USD',
      withdrawals_enabled: Boolean(setting?.withdrawals_enabled), conversion_enabled: Boolean(setting?.conversion_enabled),
      usd_kes_rate_micros: setting?.usd_kes_rate_micros || 0, usd_kes_rate: (setting?.usd_kes_rate_micros || 0) / 1000000 };
  };
  async function review(req) {
    if (!ID.test(req.params.id)) throw fail(400, 'Invalid deposit ID.');
    const { action, usd_amount, note } = req.body;
    if (!['approve', 'reject'].includes(action)) throw fail(400, 'Choose approve or reject.');
    const cents = action === 'approve' ? usdCents(usd_amount) : 0;
    const reviewNote = String(note || '').trim();
    if (reviewNote.length > 500) throw fail(400, 'Review note is too long.');
    if (action === 'reject' && !reviewNote) throw fail(400, 'Enter a reason for rejecting this deposit.');
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const deposit = await CryptoDeposit.findOneAndUpdate(
          { _id: req.params.id, ...scope(req, 'user_id'), status: 'pending' },
          { $set: { status: action === 'approve' ? 'completed' : 'failed', usd_cents: cents,
            reviewed_by: req.user.id, review_note: reviewNote, reviewed_at: new Date() } },
          { new: true, session }
        );
        if (!deposit) throw fail(409, 'Deposit is unavailable or has already been reviewed.');
        const user = action === 'approve'
          ? await User.findOneAndUpdate({ id: deposit.user_id, is_suspended: { $ne: true } },
            { $inc: { usd_balance_cents: cents } }, { new: true, session })
          : await User.findOne({ id: deposit.user_id }).session(session);
        if (!user) throw fail(409, 'Player account is unavailable or suspended.');
        result = { deposit: serialize(deposit), userId: deposit.user_id, usd_balance: (user.usd_balance_cents || 0) / 100 };
      });
    } finally { await session.endSession(); }
    return result;
  }
  return { getSettings, review };
}

function createCryptoRoutes({ models, mongoose, authenticateToken, scope, emit = () => {} }) {
  const { User, CryptoSetting, CryptoDeposit, CryptoWithdrawal, CryptoConversion } = models;
  const service = createCryptoService({ ...models, mongoose, scope });
  const actions = createWalletActions({ models, mongoose, scope, money: usdCents });
  let indexReady;
  function ensureUniqueIndex() {
    if (!indexReady) indexReady = CryptoDeposit.createIndexes().catch(error => { indexReady = null; throw error; });
    return indexReady;
  }
  const player = express.Router();
  const admin = express.Router();
  const route = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (!error.status && error.code !== 11000) console.error('Crypto deposit error:', error.message);
      res.status(error.code === 11000 ? 409 : error.status || 500).json({ error: error.code === 11000
        ? 'This transaction or request has already been submitted. Refresh and retry.' : error.status ? error.message : 'Unable to process wallet request. Please retry.' });
    }
  };
  player.use(authenticateToken);
  player.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  player.get('/wallet', route(async (req, res) => {
    const [user, settings, deposits, withdrawals, conversions] = await Promise.all([
      User.findOne({ id: req.user.id }).select('usd_balance_cents balance').lean(), service.getSettings(),
      CryptoDeposit.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).lean(),
      CryptoWithdrawal.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).lean(),
      CryptoConversion.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).lean()
    ]);
    if (!user) throw fail(404, 'Player account not found.');
    res.json({ usd_balance: (user.usd_balance_cents || 0) / 100, kes_balance: user.balance || 0, settings,
      deposits: deposits.map(serialize), withdrawals: withdrawals.map(withdrawalView), conversions: conversions.map(conversionView) });
  }));
  player.post('/withdrawals', route(async (req, res) => {
    const result = await actions.withdraw(req);
    res.json(result);
    emit({ action: 'crypto_withdrawal_pending', userId: req.user.id, withdrawals: true, dashboard: false });
  }));
  player.post('/conversions', route(async (req, res) => {
    const result = await actions.convert(req);
    res.json(result);
    emit({ action: 'currency_converted', userId: req.user.id, balance: result.balance });
  }));
  player.post('/deposits', route(async (req, res) => {
    const amount = tokenAmount(req.body.token_amount);
    const settings = await service.getSettings();
    if (!settings.enabled || !ADDRESS.test(settings.receiving_address)) throw fail(400, 'Crypto deposits are currently unavailable.');
    const user = await User.findOne({ id: req.user.id, is_suspended: { $ne: true } }).select('id').lean();
    if (!user) throw fail(403, 'Player account unavailable.');
    // Keep the exact receiving address with the request, even if admin changes it later.
    const deposit = await CryptoDeposit.create({ user_id: req.user.id, token_amount: amount, receiving_address: settings.receiving_address });
    res.status(201).json({ deposit: serialize(deposit) });
  }));
  player.put('/deposits/:id/transfer', route(async (req, res) => {
    if (!ID.test(req.params.id)) throw fail(400, 'Invalid deposit ID.');
    const hash = String(req.body.transaction_hash || '').trim();
    if (!HASH.test(hash)) throw fail(400, 'Enter a valid BEP-20 transaction hash (0x followed by 64 hexadecimal characters).');
    // Fail closed if the database cannot enforce cross-player hash uniqueness.
    await ensureUniqueIndex();
    const deposit = await CryptoDeposit.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id, status: 'awaiting_transfer' },
      { $set: { transaction_hash: hash.toLowerCase(), status: 'pending' } }, { new: true, runValidators: true });
    if (!deposit) throw fail(409, 'Deposit is unavailable or already submitted.');
    res.json({ deposit: serialize(deposit) });
    emit({ action: 'crypto_deposit_pending', userId: req.user.id, deposits: true, dashboard: false });
  }));
  admin.get('/settings', route(async (req, res) => res.json(await service.getSettings())));
  admin.put('/settings', route(async (req, res) => {
    const address = String(req.body.receiving_address || '').trim();
    if (typeof req.body.enabled !== 'boolean' || (address && !ADDRESS.test(address)) || (req.body.enabled && !address)) {
      throw fail(400, 'Set a valid BEP-20 receiving address (0x followed by 40 hexadecimal characters).');
    }
    if (/^0x0{40}$/i.test(address)) throw fail(400, 'The zero address cannot receive deposits.');
    const rate = req.body.usd_kes_rate ? rateMicros(req.body.usd_kes_rate) : 0;
    if (req.body.conversion_enabled && !rate) throw fail(400, 'Set the USD/KES exchange rate.');
    await CryptoSetting.findByIdAndUpdate('trust_wallet', { $set: { enabled: req.body.enabled,
      withdrawals_enabled: req.body.withdrawals_enabled === true, conversion_enabled: req.body.conversion_enabled === true,
      usd_kes_rate_micros: rate,
      receiving_address: address, updated_by: req.user.id, updated_at: new Date() } }, { upsert: true });
    res.json(await service.getSettings());
  }));
  admin.get('/deposits', route(async (req, res) => {
    const deposits = await CryptoDeposit.find(scope(req, 'user_id')).sort({ created_at: -1 }).limit(100).lean();
    res.json({ deposits: deposits.map(serialize) });
  }));
  admin.get('/withdrawals', route(async (req, res) => {
    const withdrawals = await CryptoWithdrawal.find(scope(req, 'user_id')).sort({ created_at: -1 }).limit(100).lean();
    res.json({ withdrawals: withdrawals.map(withdrawalView) });
  }));
  admin.post('/withdrawals/:id/review', route(async (req, res) => {
    const result = await actions.reviewWithdrawal(req);
    res.json(result);
    emit({ action: 'crypto_withdrawal_reviewed', userId: result.userId, withdrawals: true, dashboard: false });
  }));
  admin.post('/deposits/:id/review', route(async (req, res) => {
    const result = await service.review(req);
    res.json(result);
    // Never broadcast the USD balance through the existing KES balance events.
    emit({ action: 'crypto_deposit_reviewed', userId: result.userId, deposits: true, dashboard: false });
  }));
  return { player, admin };
}

module.exports = { createCryptoRoutes, createCryptoService, tokenAmount, usdCents };
