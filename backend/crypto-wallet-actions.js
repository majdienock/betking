const fail = (status, message) => Object.assign(new Error(message), { status });
const ID = /^[0-9a-f]{24}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
function requestKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw fail(400, 'Invalid request key.');
  return value;
}
function rateMicros(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,7}(?:\.\d{1,6})?$/.test(text)) throw fail(400, 'Enter a USD/KES rate with up to six decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const rate = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  if (rate < 1 || rate > 1000000000000) throw fail(400, 'Enter a USD/KES rate greater than zero and no more than 1,000,000.');
  return rate;
}
function convertedCents(cents, rate, direction) {
  if (!['usd_to_kes', 'kes_to_usd'].includes(direction)) throw fail(400, 'Choose a conversion direction.');
  if (!Number.isSafeInteger(rate) || rate <= 0) throw fail(400, 'Conversion rate is unavailable.');
  const result = direction === 'usd_to_kes' ? BigInt(cents) * BigInt(rate) / 1000000n : BigInt(cents) * 1000000n / BigInt(rate);
  if (result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) throw fail(400, 'Conversion amount is too small or too large.');
  return Number(result);
}
const withdrawalView = row => ({
  id: String(row._id), user_id: row.user_id, receiving_address: row.receiving_address,
  usd_amount: row.usd_cents / 100, token_amount: row.token_amount, status: row.status,
  transaction_hash: row.transaction_hash, review_note: row.review_note, created_at: row.created_at
});
const conversionView = row => ({ id: String(row._id), direction: row.direction,
  source_amount: row.source_cents / 100, target_amount: row.target_cents / 100,
  rate: row.rate_micros / 1000000, created_at: row.created_at });

function createWalletActions({ models, mongoose, scope = () => ({}), money }) {
  const { User, CryptoSetting, CryptoWithdrawal, CryptoConversion } = models;
  let ready;
  const ensureIndexes = () => ready ||= Promise.all([CryptoWithdrawal.createIndexes(), CryptoConversion.createIndexes()])
    .catch(error => { ready = null; throw error; });
  async function transaction(callback) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await callback(session); });
      return result;
    } finally { await session.endSession(); }
  }
  async function withdraw(req) {
    const cents = money(req.body.usd_amount);
    const address = String(req.body.receiving_address || '').trim();
    const key = requestKey(req.body.request_key);
    if (!ADDRESS.test(address) || /^0x0{40}$/i.test(address)) throw fail(400, 'Enter a valid BEP-20 withdrawal address.');
    await ensureIndexes();
    return transaction(async session => {
      const existing = await CryptoWithdrawal.findOne({ user_id: req.user.id, request_key: key }).session(session);
      if (existing) {
        if (existing.usd_cents !== cents || existing.receiving_address.toLowerCase() !== address.toLowerCase()) throw fail(409, 'Request key was already used.');
        return { withdrawal: withdrawalView(existing) };
      }
      const settings = await CryptoSetting.findById('trust_wallet').session(session).lean();
      if (!settings?.withdrawals_enabled) throw fail(400, 'Crypto withdrawals are unavailable.');
      const user = await User.findOneAndUpdate({ id: req.user.id, is_suspended: { $ne: true }, usd_balance_cents: { $gte: cents } },
        { $inc: { usd_balance_cents: -cents } }, { new: true, session });
      if (!user) throw fail(400, 'Insufficient USD balance or account unavailable.');
      const [withdrawal] = await CryptoWithdrawal.create([{ user_id: req.user.id, request_key: key,
        receiving_address: address, usd_cents: cents, token_amount: (cents / 100).toFixed(2) }], { session });
      return { withdrawal: withdrawalView(withdrawal), usd_balance: user.usd_balance_cents / 100 };
    });
  }
  async function reviewWithdrawal(req) {
    if (!ID.test(req.params.id)) throw fail(400, 'Invalid withdrawal ID.');
    const { action } = req.body;
    const note = String(req.body.note || '').trim();
    const hash = String(req.body.transaction_hash || '').trim().toLowerCase();
    if (!['complete', 'reject'].includes(action)) throw fail(400, 'Choose complete or reject.');
    if (action === 'complete' && !HASH.test(hash)) throw fail(400, 'Enter the BEP-20 payout transaction hash.');
    if (note.length > 500 || (action === 'reject' && !note)) throw fail(400, 'Enter a review note (up to 500 characters).');
    await ensureIndexes();
    return transaction(async session => {
      const withdrawal = await CryptoWithdrawal.findOneAndUpdate({ _id: req.params.id, ...scope(req, 'user_id'), status: 'pending' },
        { $set: { status: action === 'complete' ? 'completed' : 'failed', review_note: note,
          reviewed_by: req.user.id, reviewed_at: new Date(), ...(action === 'complete' ? { transaction_hash: hash } : {}) } }, { new: true, session });
      if (!withdrawal) throw fail(409, 'Withdrawal is unavailable or already reviewed.');
      if (action === 'reject') {
        const user = await User.findOneAndUpdate({ id: withdrawal.user_id }, { $inc: { usd_balance_cents: withdrawal.usd_cents } }, { new: true, session });
        if (!user) throw fail(409, 'Player account unavailable.');
      }
      return { withdrawal: withdrawalView(withdrawal), userId: withdrawal.user_id };
    });
  }
  async function convert(req) {
    const cents = money(req.body.amount);
    const key = requestKey(req.body.request_key);
    const direction = req.body.direction;
    if (!['usd_to_kes', 'kes_to_usd'].includes(direction)) throw fail(400, 'Choose a conversion direction.');
    await ensureIndexes();
    return transaction(async session => {
      const existing = await CryptoConversion.findOne({ user_id: req.user.id, request_key: key }).session(session);
      if (existing) {
        if (existing.source_cents !== cents || existing.direction !== direction) throw fail(409, 'Request key was already used.');
        const user = await User.findOne({ id: req.user.id }).session(session);
        if (!user) throw fail(404, 'Player account unavailable.');
        return { conversion: conversionView(existing), balance: user.balance, usd_balance: (user.usd_balance_cents || 0) / 100 };
      }
      const settings = await CryptoSetting.findById('trust_wallet').session(session).lean();
      const rate = settings?.usd_kes_rate_micros;
      if (!settings?.conversion_enabled) throw fail(400, 'Conversion is unavailable.');
      if (req.body.expected_rate_micros !== rate) throw fail(409, 'Exchange rate changed. Refresh and try again.');
      const target = convertedCents(cents, rate, direction);
      const toKes = direction === 'usd_to_kes';
      const user = await User.findOneAndUpdate({ id: req.user.id, is_suspended: { $ne: true },
        [toKes ? 'usd_balance_cents' : 'balance']: { $gte: toKes ? cents : cents / 100 } },
      [{ $set: {
        usd_balance_cents: { $add: [{ $ifNull: ['$usd_balance_cents', 0] }, toKes ? -cents : target] },
        balance: { $round: [{ $add: ['$balance', toKes ? target / 100 : -cents / 100] }, 2] }
      } }], { new: true, session });
      if (!user) throw fail(400, 'Insufficient balance or account unavailable.');
      const [conversion] = await CryptoConversion.create([{ user_id: req.user.id, request_key: key, direction,
        source_cents: cents, target_cents: target, rate_micros: rate }], { session });
      return { conversion: conversionView(conversion), balance: user.balance, usd_balance: user.usd_balance_cents / 100 };
    });
  }
  return { withdraw, reviewWithdrawal, convert };
}
module.exports = { createWalletActions, rateMicros, convertedCents, withdrawalView, conversionView };
