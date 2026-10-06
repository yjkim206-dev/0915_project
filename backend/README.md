# Backend deployment

운영 백엔드는 `supabase/` 아래의 Edge Function과 Postgres migration을 사용합니다.

```bash
cd backend
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
supabase functions deploy api
```

배포 후 Vercel의 `VITE_API_URL`을 `https://<PROJECT_REF>.supabase.co/functions/v1/api`로 설정하세요.

기존 `server.js`와 `database.js`는 로컬 Express/SQLite 개발용 호환 코드이며, Supabase 배포에는 사용하지 않습니다.
