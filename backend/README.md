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
VITE_API_URL=https://your-project-ref.supabase.co/functions/v1/api
VITE_SUPABASE_ANON_KEY=your-publishable-key
```

## Development and deployment

Run `npm.cmd run dev:backend` to serve the `api` Edge Function locally. Local
Edge Function serving requires Docker. Deploy the database migrations and API
function with `npm.cmd --prefix backend run deploy`.

The function provisions the administrator configured by the three `ADMIN_*`
secrets when that account signs in, and stores the account in Supabase Auth,
`public.users`, `public.profiles`, and `public.admins`.
