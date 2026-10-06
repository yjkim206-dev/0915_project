-- Reconcile existing Auth accounts with the separated application tables.
-- Auth user id is the single ownership key for users, profiles, posts and comments.
insert into public.users (id, email, created_at, updated_at)
select id, coalesce(email, ''), created_at, now()
from auth.users
on conflict (id) do update
set email = excluded.email, updated_at = now();

insert into public.profiles (id, name, email, bio, profile_image, role)
select
  id,
  coalesce(nullif(trim(raw_user_meta_data ->> 'name'), ''), split_part(coalesce(email, 'member'), '@', 1)),
  coalesce(email, ''),
  '',
  '',
  'user'
from auth.users
on conflict (id) do update
set email = excluded.email, updated_at = now();

insert into public.admins (id, email, name)
select id, email, name from public.profiles where role = 'admin'
on conflict (id) do update
set email = excluded.email, name = excluded.name, updated_at = now();

-- Keep the display name and email entered during signup synchronized on future
-- Auth updates without changing an existing profile bio or image.
create or replace function public.sync_auth_account()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();

  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'member'), '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do update
  set email = excluded.email,
      name = case when new.raw_user_meta_data ? 'name'
                  and nullif(trim(new.raw_user_meta_data ->> 'name'), '') is not null
                  then excluded.name else public.profiles.name end,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_split_tables on auth.users;
create trigger on_auth_user_created_split_tables
after insert or update of email, raw_user_meta_data on auth.users
for each row execute procedure public.sync_auth_account();
