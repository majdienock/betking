# BetPesa — betpesa.site

This is the original application with BetPesa branding and independent deployment settings.

The original login, registration, deposits, PayHero callback, status checks,
withdrawals, game engine and page flows are retained. The three administrator
identities are R, D and K, as requested. The existing superadmin is unchanged.

## Deployment

- Frontend: Vercel, using the existing project and domain configuration.
- Backend: Render, using the existing service and domain configuration.
- Backend build command: npm run build:backend
- Backend start command: npm start
- Frontend API setting: BACKEND_ORIGIN selects this site's own backend, exactly as in the original application.
- PayHero callback: https://www.fevaafrica.com/api/callbacks/betpesa

Keep this site's MongoDB URI, JWT secret and approved payment credentials in
Render's environment variables. The private backend/.env file contains the
existing configuration and is excluded from Git. Keep the database name in the
existing MongoDB URI so accounts and transaction history are retained.

Provider endpoint and integration-key values are read from the private
MPESA_API_URL and MPESA_CONNECT_KEY environment variables instead of publishing
credentials in source code. The configured integration is the approved original setup.

No DNS edits, automatic backend-address rewrites, or
replacement authentication flow are part of this restoration.

### Callback host

The callback host reverse-proxies `POST /api/callbacks/betpesa` to
`https://api.betpesa.site/api/mpesa/callback`, preserving the JSON body, query
parameters, authorization header and the API's response status. Keep this rule
ahead of any frontend catch-all. The callback path must not serve the frontend
HTML. Use the canonical `www.fevaafrica.com` hostname to avoid the apex-to-www redirect.

The Vercel CDN rule has been published and verified with non-payment callback
requests. Set Render's `PAYHERO_CALLBACK_URL` to the URL above, preserving any
existing token query parameter and `PAYHERO_CALLBACK_TOKEN`. The local `.env` and
example configuration use the verified URL; Render environment settings are
separate. The frontend domain, API origin, PayHero credentials, payment references,
callback handler and status polling stay unchanged. No real payment was initiated
by the callback forwarding checks.

## Crypto deposits

In Admin → deposit/withdrawal settings, configure the Trust Wallet USDT address
on BNB Smart Chain (BEP-20) and enable crypto deposits. Crypto deposits are
disabled until configured. Players can access the crypto card from the deposit
screen on the dashboard or Aviator, create a request, copy its address or scan its QR code, send
USDT using BEP-20 and submit the transaction hash.

Admins must manually verify the successful on-chain USDT transfer, destination,
amount, network and confirmations, then enter its confirmed USD value and approve
the request. No blockchain polling or automatic crediting is enabled. Rejected
requests retain their hash so the same transfer cannot be reused. Each request
keeps the receiving address it was issued with, including after an address change.

The USD wallet uses integer cents. Admins can enable USDT BEP-20 withdrawals
(1 USD wallet unit pays 1 USDT) and configure a USD/KES conversion rate in Payment
settings. Withdrawals reserve USD immediately; admins send the payout manually
and record its hash, or reject and refund. Conversion works in both directions,
rounds down to the destination cent, and uses the displayed admin-set rate.
Requests use unique keys to prevent repeated debits after a retry. Conversion
history and withdrawal history appear in the crypto wallet.

Approval, conversion and withdrawals commit in MongoDB transactions, so MongoDB must support
transactions (replica set or sharded cluster, including Atlas). A standalone
MongoDB instance will fail approval without crediting funds.

## Checks

Run npm run check, npm --prefix backend test,
npm --prefix frontend test -- --watch=false, and npm --prefix frontend run build.
