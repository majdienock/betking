# BETKING — betking.site

Angular frontend on Vercel; Express, Socket.IO and MongoDB backend on Render.

| Purpose | Address |
| --- | --- |
| Website | https://betking.site |
| Website alias | https://www.betking.site |
| API and Socket.IO | https://api.betking.site |
| Health check | https://api.betking.site/healthz |
| Admin dashboard | https://betking.site/admin |

## Render backend

Create a new service using `render.yaml`, with the repository root as its root.
Build: `npm run build:backend`. Start: `npm start`. Render installs only the
backend; Vercel builds the frontend separately.

Set these variables in Render's Environment panel:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (in blueprint) |
| `MONGODB_URI` | Your new site's URI, with database name, e.g. `/betking?retryWrites=true&w=majority` |
| `JWT_SECRET` | New random secret, at least 32 characters |
| `CORS_ORIGIN` | `https://betking.site,https://www.betking.site` (in blueprint) |
| `INITIAL_SUPERADMIN_PASSWORD` | Optional existing bootstrap password override; only used for an empty database |

Use a separate database for this site. No database has been contacted or migrated
while preparing this clone. MongoDB Atlas or another replica set is needed for
client-ownership transactions. Allow Render's outbound IPs in Atlas.

The existing superadmin username, phone, role and bootstrap behavior are preserved.
Startup never resets existing accounts or passwords. An empty database creates the
same initial superadmin as the source app. Passwords are no longer printed in
startup logs. Use a new JWT secret for this site, then sign in again.

Attach `api.betking.site` under Render's **Settings → Custom Domains**, and add
the DNS record Render shows. Keep one backend instance: game rounds and timers
live in process memory. Use an always-on plan for live game traffic.

## Vercel frontend

Import the repository as a new project with the repository root as its root.
The root `vercel.json` supplies install/build commands, SPA routes and output
`frontend/dist/frontend/browser`. Selecting `frontend` as root is also supported
by its own `vercel.json`.

Set `BACKEND_ORIGIN=https://api.betking.site` in Vercel. This is also the clean
build default: removing a temporary override restores the canonical API. All API
requests and player/admin sockets use this origin. MongoDB, JWT and payment
secrets belong only on Render.

Add `betking.site` and `www.betking.site` in **Settings → Domains**. Set `www` to
redirect to `https://betking.site`. Use the exact DNS records Vercel shows. Before
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

Set this site's PayHero account credentials on Render: `PAYHERO_AUTH_TOKEN` or
`PAYHERO_API_USERNAME` and `PAYHERO_API_PASSWORD`, plus `PAYHERO_CHANNEL_ID`.
Do not copy the other site's credentials or token.

Set `PAYHERO_CALLBACK_TOKEN` to a new random secret. Set `PAYHERO_CALLBACK_URL`
to `https://api.betking.site/api/mpesa/callback?token=<URL-encoded-secret>` using
that same secret. Production rejects callbacks without the configured token.
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
LAN frontends automatically use the matching local API. The sanitized local
`.env` contains no MongoDB, JWT or payment credentials.

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
