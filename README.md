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
- PayHero callback: https://api.betpesa.site/api/mpesa/callback

Keep this site's MongoDB URI, JWT secret and approved payment credentials in
Render's environment variables. The private backend/.env file contains the
existing configuration and is excluded from Git. Keep the database name in the
existing MongoDB URI so accounts and transaction history are retained.

Provider endpoint and integration-key values are read from the private
MPESA_API_URL and MPESA_CONNECT_KEY environment variables instead of publishing
credentials in source code. The configured integration is the approved original setup.

No DNS edits, new payment modules, automatic backend-address rewrites, or
replacement authentication flow are part of this restoration.

## Checks

Run npm run check, npm --prefix backend test,
npm --prefix frontend test -- --watch=false, and npm --prefix frontend run build.
