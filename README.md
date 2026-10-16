# BETPESA — betpesa.site

Angular frontend on Vercel; Express, Socket.IO and MongoDB backend on Render.

| Purpose | Address |
| --- | --- |
| Website | https://betpesa.site |
| Website alias | https://www.betpesa.site |
| API and Socket.IO | https://api.betpesa.site |
| Health check | https://api.betpesa.site/healthz |
| Admin dashboard | https://betpesa.site/admin |

## Render backend

For the existing backend, update its environment and redeploy the same service.
For a fresh deployment, use `render.yaml`, with the repository root as its root.
Build: `npm run build:backend`. Start: `npm start`. Render installs only the
backend; Vercel builds the frontend separately.

Set these variables in Render's Environment panel:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (in blueprint) |
| `MONGODB_URI` | Keep the existing connection string and database name to retain current accounts |
| `JWT_SECRET` | Keep the existing private secret |
| `CORS_ORIGIN` | `https://betpesa.site,https://www.betpesa.site` (in blueprint) |
| `INITIAL_SUPERADMIN_PASSWORD` | Optional existing bootstrap password override; only used for an empty database |

This branding change does not migrate or rename the existing database. MongoDB
Atlas or another replica set is needed for client-ownership transactions. Allow
Render's outbound IPs in Atlas.

The existing superadmin username, phone, role and bootstrap behavior are preserved.
Startup never resets existing accounts or passwords. An empty database creates the
same initial superadmin as the source app. Passwords are no longer printed in
startup logs.

The existing backend is `https://betking-kajs.onrender.com`. Keep using this
address until the custom API domain is attached and its DNS resolves.

Attach `api.betpesa.site` under Render's **Settings → Custom Domains**, and add
the DNS record Render shows. Keep one backend instance: game rounds and timers
live in process memory. Use an always-on plan for live game traffic.

## Vercel frontend

Import the repository as a new project with the repository root as its root.
The root `vercel.json` supplies install/build commands, SPA routes and output
`frontend/dist/frontend/browser`. Selecting `frontend` as root is also supported
by its own `vercel.json`.

For the current deployment, set
`BACKEND_ORIGIN=https://betking-kajs.onrender.com` in Vercel. Once the custom API
domain resolves, switch it to `https://api.betpesa.site`. This is also the clean
build default: removing a temporary override restores the canonical API. All API
requests and player/admin sockets use this origin. MongoDB, JWT and payment
secrets belong only on Render.

Add `betpesa.site` and `www.betpesa.site` in **Settings → Domains**. Set `www` to
redirect to `https://betpesa.site`. Use the exact DNS records Vercel shows. Before
the API domain resolves, a temporary `BACKEND_ORIGIN` may point to this new
service's Render URL; redeploy Vercel after changing it. Add any project's exact
Vercel origin to Render's `CORS_ORIGIN` if it needs access. Other Vercel projects
are not allowed by default.

Domain instructions: [Vercel](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
and [Render](https://render.com/docs/custom-domains).

## Admins R, D and K

The three private PIN/client-ownership identities are **R**, **D**, and **K**.
Superadmin login and permissions remain the same. Initials do not create new
login accounts; the existing app's shared-login/private-PIN behavior is preserved.

Run this privately with the same MongoDB environment as the new Render service:

```bash
npm --prefix backend run setup-pin-owner
```

Sign in as superadmin, open **Administrators → Private PIN setup**, and set a
different four-digit PIN for each of R, D and K. No default PINs or owner key are
installed. See [admin PIN access](docs/admin-pin-access.md).

## Payments

Keep the approved existing PayHero account credentials on Render: `PAYHERO_AUTH_TOKEN` or
`PAYHERO_API_USERNAME` and `PAYHERO_API_PASSWORD`, plus `PAYHERO_CHANNEL_ID`.
The private environment file contains the authorized shared payment setup.

Set `PAYHERO_CALLBACK_URL` to `https://api.betpesa.site/api/mpesa/callback`.
No callback token is required. The backend verifies the payment's reference,
final status, amount and receipt directly with PayHero before crediting a wallet.
If verification is unavailable, the callback returns 503 so it can be retried.
PayHero requests continue to use the provider's own API address.

External M-Pesa synchronization runs only when both `MPESA_API_URL` and
`MPESA_CONNECT_KEY` are explicitly configured. No external site endpoint or
shared key is assumed.

## Local development and checks

Use Node 20.19+, 22.12+ or 24+.

```bash
npm --prefix backend ci
npm --prefix frontend ci
# Copy backend/.env.example to backend/.env and enter local values if needed.
npm run dev:backend
npm run dev:frontend
```

Local frontend: `http://localhost:4200`; API: `http://localhost:3000`. Local and
LAN frontends automatically use the matching local API. The private backend
`.env` contains deployment credentials and must stay out of source control.

```bash
npm run check
npm --prefix backend test
npm --prefix frontend test -- --watch=false
npm --prefix frontend run build
```

Ignore rules exclude `.env`, dependencies, Angular caches, build output and local
scratch files from source control or Vercel uploads. After deployment, confirm
`/healthz` reports `ok`, then check login, R/D/K PIN access, wallet updates,
payment callbacks, and player/admin sockets through the deployed frontend.
