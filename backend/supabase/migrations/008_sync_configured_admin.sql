-- Keep the dedicated administrator table aligned with profile roles.
insert into public.admins (id, email, name)
select id, email, name
from public.profiles
where role = 'admin'
on conflict (id) do update set email = excluded.email, name = excluded.name, updated_at = now();

delete from public.admins
where id not in (select id from public.profiles where role = 'admin');
