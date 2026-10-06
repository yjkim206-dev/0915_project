# Supabase Edge Function backend

이 폴더는 기존 Express/SQLite 백엔드를 Supabase Edge Function + Postgres로 옮긴 구성입니다.

## 배포

1. Supabase CLI로 프로젝트를 연결합니다.

```bash
cd backend
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
supabase functions deploy api
```

2. Edge Function secrets를 설정합니다.

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

`SUPABASE_URL`과 `SUPABASE_ANON_KEY`는 Supabase Edge Runtime에 기본 제공됩니다.

3. 첫 관리자 계정을 Supabase Auth에서 만든 뒤 SQL Editor에서 권한을 부여합니다.

```sql
update public.profiles set role = 'admin' where email = '관리자 이메일';
```

프론트 Vercel 환경변수 `VITE_API_URL`은 다음처럼 설정합니다.

`https://<PROJECT_REF>.supabase.co/functions/v1/api`
