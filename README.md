# BetPesa — betpesa.site

This is the original application with BetPesa branding and independent deployment settings.

The original login, registration, deposits, PayHero callback, status checks,
withdrawals, game engine and page flows are retained. The three administrator
identities are R, D and K, as requested. The existing superadmin is unchanged.

## Deployment

- Frontend: Cloudflare Pages, serving `betpesa.site` and `www.betpesa.site`.
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

### Cloudflare Pages frontend

In Cloudflare, create a **Pages** project connected to this repository. Use these
Git build settings (paths are relative to the repository root):

| Setting | Value |
| --- | --- |
| Project name | `betpesa` |
| Production branch | `main` |
| Framework preset | None |
| Root directory | Leave blank (repository root) |
| Build command | `npm run build:pages` |
| Build output directory | `frontend/dist/frontend/browser` |
| Build environment variable | `BACKEND_ORIGIN=https://api.betpesa.site` |

The `.node-version` file selects Node 22.20.0. The Pages build installs only the
frontend dependencies and runs the existing Angular production build. The
committed API default already points to `https://api.betpesa.site`; setting
`BACKEND_ORIGIN` explicitly makes the dashboard configuration clear. This value
is compiled into the frontend at build time, so redeploy after changing it.
Keep the backend `.env`, database secrets and payment credentials on Render.

`wrangler.json` declares the Pages project and static output directory. If you
choose another Pages project name, update its `name` to match. The public
`_headers` file is copied into the build and prevents stale app-shell and service
worker caching. Leave out a top-level `404.html`: Pages then serves the Angular
app for direct visits to `/login`, `/dashboard`, `/play` and other client routes.
No Pages Function, Worker entry point or API proxy is required.

Before testing the temporary Pages address, append its exact HTTPS origin to
Render's existing `CORS_ORIGIN` list and deploy the backend settings. Do this for
each preview origin you need; do not replace the existing production origins.

After the Pages deployment is ready, add `betpesa.site` and `www.betpesa.site`
under **Custom domains** in that Pages project and follow Cloudflare's DNS
instructions. The apex domain requires Cloudflare nameservers. Preserve the
domain's other DNS records, especially `api.betpesa.site`, which must still point
to the Render backend. The Feva callback continues forwarding to that API domain.

For a local build or a Pages Direct Upload, run `npm run build:pages` from the
repository root and upload the contents of `frontend/dist/frontend/browser`.
For Git deployments, Cloudflare runs the same build command automatically.

References: [Pages builds](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[SPA routing](https://developers.cloudflare.com/pages/configuration/serving-pages/),
[custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

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

## USD wallet and previous crypto deposits

Crypto deposits have been removed. Players use M-Pesa through the admin-selected
PayHero or Nexus Pay gateway. The dashboard and Aviator deposit screens no longer
show crypto deposit controls, receiving addresses or QR codes. Older clients get
HTTP 410 when creating a crypto deposit or submitting a new transfer, even if the
stored legacy setting was enabled. Admins cannot enable deposits again.

Existing deposit records and USD/KES balances are preserved. Previous crypto
deposits remain visible under Withdrawal → USD wallet → History and in admin
Payment settings. Already submitted requests can still be reviewed with the
existing ownership restrictions and protections against duplicate crediting.
Unsubmitted historical requests cannot be resumed; contact support about any
earlier transfer. No balances or database records are deleted or migrated.

Admins can still enable USDT BEP-20 withdrawals and USD/KES conversion in Payment
settings. Withdrawals reserve USD until paid or rejected and refunded. Conversion
uses the displayed admin-set rate and rounds down to the destination cent. Both
flows retain their histories and unique request keys to prevent duplicate debits.
These operations and reviews require MongoDB transactions (Atlas or a replica set).

## Checks

Run npm run check, npm --prefix backend test,
npm --prefix frontend test -- --watch=false, and npm --prefix frontend run build.
