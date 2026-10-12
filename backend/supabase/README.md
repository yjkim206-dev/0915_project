# Supabase resources

- `functions/api/index.ts`: complete HTTP API Edge Function
- `migrations/`: PostgreSQL schema and data migrations
- `config.toml`: function configuration
- `deploy.ps1`: links the configured project, applies migrations, updates
  administrator secrets, and deploys `api`

From the repository root, run:

```powershell
npm.cmd --prefix backend run deploy
```

The deployed API URL is:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/api
```
