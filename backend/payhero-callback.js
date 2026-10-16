// A public callback is a notification to check PayHero, never proof of payment.
function paymentReferences(payment = {}) {
  return [payment.ExternalReference, payment.external_reference, payment.CheckoutRequestID,
    payment.checkout_request_id, payment.MerchantRequestID, payment.reference, payment.transaction_reference]
    .filter(value => typeof value === 'string' && value.length > 0 && value.length <= 256);
}

function createPayHeroDepositReconciler({ queryTransaction, completeDeposit, failDeposit }) {
  const inFlight = new Map();

  async function reconcile(deposit) {
    const payment = await queryTransaction(deposit, { strictReference: true });
    if (!payment) throw new Error('Payment verification unavailable');
    const expected = [deposit.external_reference, deposit.mpesa_checkout_request_id, deposit.provider_reference].filter(Boolean);
    if (!paymentReferences(payment).some(ref => expected.includes(ref))) {
      throw new Error('Payment reference mismatch');
    }

    const status = String(payment.status || payment.Status || '').toLowerCase();
    const resultCode = payment.ResultCode;
    const pending = ['pending', 'queued', 'processing', 'initiated', 'accepted', 'waiting'].includes(status);
    const failed = !pending && (['failed', 'failure', 'cancelled', 'canceled', 'rejected'].includes(status)
      || (resultCode !== undefined && resultCode !== null && String(resultCode) !== '0'));
    // PayHero's settled transaction ledger has transaction_type and a receipt,
    // but no status field. An explicitly pending status must still stay pending.
    const settledInbound = !status && resultCode == null && payment.transaction_type === 'inbound_payment';
    const succeeded = !failed && !pending && payment.success !== false && (['success', 'completed', 'complete'].includes(status)
      || resultCode === 0 || resultCode === '0' || settledInbound);
    const ref = deposit.external_reference || deposit.mpesa_checkout_request_id;

    if (failed) {
      const result = await failDeposit(ref, payment.status_reason || payment.ResultDesc || 'Payment failed', payment);
      if (!result) throw new Error('Payment update unavailable');
      return result;
    } else if (succeeded) {
      const amount = Number(payment.amount ?? payment.Amount);
      const receipt = payment.provider_reference || payment.mpesa_reference || payment.MpesaReceiptNumber || payment.receipt;
      if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== Math.round(Number(deposit.amount) * 100)
        || typeof receipt !== 'string' || !receipt.trim()) throw new Error('Payment details mismatch');
      const result = await completeDeposit(ref, amount, receipt, payment);
      if (!result) throw new Error('Payment update unavailable');
      return result;
    }
    return deposit;
  }

  return deposit => {
    if (deposit.status === 'completed') return Promise.resolve(deposit);
    const key = String(deposit._id || deposit.id || deposit.external_reference);
    let work = inFlight.get(key);
    if (!work) {
      work = reconcile(deposit).finally(() => inFlight.delete(key));
      inFlight.set(key, work);
    }
    return work;
  };
}

function createPayHeroCallbackHandler({ Deposit, reconcileDeposit, ...dependencies }) {
  const reconcile = reconcileDeposit || createPayHeroDepositReconciler(dependencies);
  return async (req, res) => {
    try {
      const payload = req.body || {};
      const references = [...new Set([...paymentReferences(payload), ...paymentReferences(payload.response || {})])];
      if (!references.length) return res.status(400).json({ status: false, message: 'Payment reference required' });
      const deposit = await Deposit.findOne({ $or: [
        { external_reference: { $in: references } },
        { mpesa_checkout_request_id: { $in: references } },
        { provider_reference: { $in: references } }
      ] });
      if (deposit && deposit.status !== 'completed') {
        await reconcile(deposit);
      }
      return res.status(200).json({ status: true, message: 'Callback processed' });
    } catch (error) {
      // A non-2xx response permits a provider retry. Never echo credentials or payloads.
      return res.status(503).json({ status: false, message: 'Payment verification unavailable; retry later' });
    }
  };
}

module.exports = { createPayHeroCallbackHandler, createPayHeroDepositReconciler, paymentReferences };
