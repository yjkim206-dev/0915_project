-- Explicitly map the signup display name to Auth metadata and every
-- application account table while retaining legacy `name` columns.
alter table public.users add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists display_name text not null default '';
alter table public.admins add column if not exists display_name text not null default '';

update public.profiles
set display_name = coalesce(nullif(trim(display_name), ''), nullif(trim(name), ''), split_part(coalesce(email, 'member'), '@', 1)),
    updated_at = now();

update public.users u
set display_name = p.display_name,
    updated_at = now()
from public.profiles p
where p.id = u.id;

update public.admins a
set display_name = coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.name), ''), a.name),
    name = coalesce(nullif(trim(p.name), ''), p.display_name, a.name),
    updated_at = now()
from public.profiles p
where p.id = a.id;

update auth.users au
set raw_user_meta_data = coalesce(au.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('name', p.name, 'display_name', p.display_name, 'role', p.role)
from public.profiles p
where p.id = au.id;

create or replace function public.sync_auth_account()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  resolved_name text;
begin
  resolved_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'member'), '@', 1));
  insert into public.users (id, email, display_name)
  values (new.id, coalesce(new.email, ''), resolved_name)
  on conflict (id) do update set email = excluded.email, display_name = excluded.display_name, updated_at = now();
  insert into public.profiles (id, name, display_name, email)
  values (new.id, resolved_name, resolved_name, coalesce(new.email, ''))
  on conflict (id) do update
  set email = excluded.email,
      name = case when new.raw_user_meta_data ? 'name' or new.raw_user_meta_data ? 'display_name' then excluded.name else public.profiles.name end,
      display_name = case when new.raw_user_meta_data ? 'name' or new.raw_user_meta_data ? 'display_name' then excluded.display_name else public.profiles.display_name end,
      updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_admin_account()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role = 'admin' then
    insert into public.admins (id, email, name, display_name)
    values (new.id, new.email, new.name, coalesce(nullif(trim(new.display_name), ''), new.name))
    on conflict (id) do update set email = excluded.email, name = excluded.name, display_name = excluded.display_name, updated_at = now();
  else
    delete from public.admins where id = new.id;
  end if;
  return new;
end;
$$;
