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

## Monthly subscriptions

The shop defaults to a **1개월 이용권** using the same `requestPayment(CARD)`
checkout as credits. This grants one calendar month after verified approval and
never automatically charges again. Users can explicitly choose **자동갱신 구독**,
which uses Toss `requestBillingAuth` to register a billing key and charge the first
month. The separate registration window is required by Toss for automatic billing.

The profile and administrator member/payment views show the billing mode, access
state, paid period, cancellation reservation, last payment and recent events.
Automatic subscriptions support end-of-period cancellation and cancellation
withdrawal. A full refund of the latest linked subscription payment ends access
immediately and stops renewal; older payments require separate review. Processor
approval/cancellation is verified before DB settlement. Ambiguous payment results
keep their durable idempotency record and can be checked with **결제 상태 확인**.

After migrations and the API are deployed, run
`node backend/supabase/configure-subscriptions.mjs` and redeploy the API to provision
the private scheduler secret. The cron job `moa-subscription-renewals` runs every
five minutes using pg_cron + pg_net and a Vault secret; it expires non-renewing
subscriptions and processes due automatic renewals in batches of two. Each
renewal uses a deterministic order id and a durable provider idempotency key.
Definite card rejection records a failed order, `past_due` state and event in one
transaction; it does not keep charging declined cards automatically. The user
can register again or purchase a normal one-month pass. Billing keys are not
readable by authenticated users through the Data API.

Checks:

- `npm.cmd --prefix backend test` (offline, provider mocks)
- `node backend/test/subscription-integration.mjs --allow-remote-fixtures`
  (real Supabase, isolated accounts, fixture approvals/refunds, no Toss calls)
- `npx.cmd --yes --package=playwright -c "node backend/test/subscription-browser.mjs --allow-remote-fixtures"`
  (opens real test-key checkout windows without submitting card data; activation
  and refund approvals are explicit fixtures, with real DB/user/admin UI checks)

Run `npm.cmd run dev:backend` to serve the `api` Edge Function locally. Local
Edge Function serving requires Docker. Deploy the database migrations and API
function with `npm.cmd --prefix backend run deploy`.

The function provisions the administrator configured by the three `ADMIN_*`
secrets when that account signs in, and stores the account in Supabase Auth,
`public.users`, `public.profiles`, and `public.admins`.
