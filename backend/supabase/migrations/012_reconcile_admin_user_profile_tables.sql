-- Keep Auth, application accounts, profiles and dedicated administrators
-- independently managed but joined by the same auth.users id.
insert into public.users (id, email, created_at, updated_at)
select id, coalesce(email, ''), created_at, now()
from auth.users
on conflict (id) do update set email = excluded.email, updated_at = now();

insert into public.profiles (id, name, email, bio, profile_image, role)
select
  id,
  coalesce(nullif(trim(raw_user_meta_data ->> 'name'), ''), split_part(coalesce(email, 'member'), '@', 1)),
  coalesce(email, ''), '', '', 'user'
from auth.users
on conflict (id) do update
set email = excluded.email,
    name = coalesce(nullif(public.profiles.name, ''), excluded.name),
    updated_at = now();

-- An administrator row is authoritative for the administrator role and display name.
insert into public.profiles (id, name, email, role)
select
  a.id,
  coalesce(nullif(trim(a.name), ''), nullif(trim(u.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(a.email, u.email, 'admin'), '@', 1), '관리자'),
  coalesce(nullif(a.email, ''), u.email, ''),
  'admin'
from public.admins a
join auth.users u on u.id = a.id
on conflict (id) do update
set name = coalesce(nullif(trim(excluded.name), ''), public.profiles.name),
    email = excluded.email,
    role = 'admin',
    updated_at = now();

-- Every profile role marked admin receives a dedicated administrator row.
insert into public.admins (id, email, name, created_at, updated_at)
select id, email, coalesce(nullif(trim(name), ''), split_part(coalesce(email, 'admin'), '@', 1)), created_at, now()
from public.profiles
where role = 'admin'
on conflict (id) do update set email = excluded.email, name = excluded.name, updated_at = now();

-- Make display names and roles visible in Supabase Authentication > Users metadata.
update auth.users au
set raw_user_meta_data = coalesce(au.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('name', p.name, 'role', p.role)
from public.profiles p
where p.id = au.id;
