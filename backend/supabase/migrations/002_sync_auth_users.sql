-- Keep the application user table in sync with Supabase Auth users.
-- New accounts remain regular users until explicitly promoted to admin.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'member'), '@', 1)),
    coalesce(new.email, ''),
    'user'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Backfill Auth users created before this migration.
insert into public.profiles (id, name, email, role)
select
  id,
  coalesce(raw_user_meta_data ->> 'name', split_part(coalesce(email, 'member'), '@', 1)),
  coalesce(email, ''),
  'user'
from auth.users
on conflict (id) do update set email = excluded.email;
