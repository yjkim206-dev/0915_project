# Supabase Edge Function backend

Production backend code lives in `supabase/functions/api/index.ts` and runs on
Supabase Edge Functions (Deno). Database schema changes are versioned in
`supabase/migrations/`. Express and SQLite are no longer used.

## Required local secrets

Create the project-root `.env` from `.env.example`. Keep this file untracked.

```env
SUPABASE_PROJECT_REF=your-project-ref
SUPABASE_ACCESS_TOKEN=your-cli-access-token
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_NAME=Administrator
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use-a-strong-password
```

The browser receives only the public values in `frontend/.env.local`:

```env
VITE_API_URL=https://ymprvqsfpwvoutwozwvn.supabase.co/functions/v1/api
VITE_SUPABASE_URL=https://ymprvqsfpwvoutwozwvn.supabase.co
VITE_SITE_URL=https://0915-project-ruby.vercel.app
VITE_SUPABASE_ANON_KEY=your-publishable-key
```

## Development and deployment

Run `npm.cmd --prefix backend test` from the project root for offline API router
regression checks (Node.js 22.13 or newer). These checks mock Supabase and verify
authentication failures and asynchronous errors retain JSON and CORS responses.

`node backend/test/payment-integration.mjs --allow-remote-fixtures` also checks
payment history, credit adjustments, permissions, concurrent retries, refund
reservations, and RLS against the deployed API. It requires the project `.env`,
creates isolated temporary Auth accounts, and deletes those accounts and their
payment/ledger rows afterward. It never calls Toss or charges a payment.

After deploying the frontend, run `npx.cmd --yes --package=playwright -c "node backend/test/payment-browser.mjs --allow-remote-fixtures"`
for headless Edge checks of the profile, receipts, administrator grant/recovery
forms, and mobile overflow. This check also creates/deletes isolated accounts.
It signs in through the real user/admin forms, verifies rejected administrator
access for ordinary users, exercises simulated checkout cancel/failure redirects,
and checks payment status filters, logout guards, and unexpected local requests.

The profile shows recent payments, receipts, and credit changes; full payment
history is available at `/profile/payments`. In `/admin`, choose
**결제·크레딧 관리** or a member's **결제·크레딧** button. Administrators can
filter payment history by member/status, inspect receipts, and grant/recover
credits with a required reason. Adjustment requests use UUID idempotency keys,
wallet row locks, and an audit ledger containing the actor and before/after
balances. Only the service role can call the adjustment/refund database functions.

Public deployment addresses are centralized in `frontend/src/deploymentConfig.js`.
Stale local or unrelated project URLs fall back to the current deployed project.

Run `npm.cmd run dev:backend` to serve the `api` Edge Function locally. Local
Edge Function serving requires Docker. Deploy the database migrations and API
function with `npm.cmd --prefix backend run deploy`.

The function provisions the administrator configured by the three `ADMIN_*`
secrets when that account signs in, and stores the account in Supabase Auth,
`public.users`, `public.profiles`, and `public.admins`.
