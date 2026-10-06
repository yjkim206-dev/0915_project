-- Correct profile names for accounts that were created before the signup
-- payload started writing user_metadata.name consistently.
update public.profiles p
set name = trim(u.raw_user_meta_data ->> 'name'),
    email = coalesce(u.email, ''),
    updated_at = now()
from auth.users u
where p.id = u.id
  and nullif(trim(u.raw_user_meta_data ->> 'name'), '') is not null;

update public.admins a
set name = p.name,
    email = p.email,
    updated_at = now()
from public.profiles p
where a.id = p.id;
