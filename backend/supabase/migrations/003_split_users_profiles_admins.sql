-- Separate account, profile, and administrator data.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '관리자',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Populate the separated account table from Supabase Auth.
insert into public.users (id, email, created_at, updated_at)
select id, coalesce(email, ''), created_at, now()
from auth.users
on conflict (id) do update set email = excluded.email, updated_at = now();

-- Keep existing profile rows, while ensuring every Auth user has a profile row.
insert into public.profiles (id, name, email, bio, profile_image, role)
select
  id,
  coalesce(raw_user_meta_data ->> 'name', split_part(coalesce(email, 'member'), '@', 1)),
  coalesce(email, ''),
  '',
  '',
  'user'
from auth.users
on conflict (id) do update set email = excluded.email;

-- Migrate existing administrator flags into the dedicated admins table.
insert into public.admins (id, email, name)
select p.id, p.email, p.name
from public.profiles p
where p.role = 'admin'
on conflict (id) do update set email = excluded.email, name = excluded.name, updated_at = now();

create or replace function public.sync_auth_account()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'member'), '@', 1)), coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_split_tables on auth.users;
create trigger on_auth_user_created_split_tables
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.sync_auth_account();

create or replace function public.sync_admin_account()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role = 'admin' then
    insert into public.admins (id, email, name)
    values (new.id, new.email, new.name)
    on conflict (id) do update set email = excluded.email, name = excluded.name, updated_at = now();
  else
    delete from public.admins where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_role_changed on public.profiles;
create trigger on_profile_role_changed
  after insert or update of role, email, name on public.profiles
  for each row execute procedure public.sync_admin_account();

alter table public.users enable row level security;
alter table public.admins enable row level security;
