-- Exclude temporary login/recovery tokens from credential backups, but retain
-- password hashes and linked identities required for account restoration.
create or replace function public.backup_snapshot_pages()
returns table(table_name text,page bigint,rows jsonb)
language plpgsql stable security definer set search_path=public as $$
declare t record; v_row text;
begin
  for t in select schemaname,tablename from pg_tables
    where (schemaname='public' and (tablename not like 'backup\_%' escape '\' or tablename='backup_settings'))
      or (schemaname='auth' and tablename in ('users','identities','mfa_factors'))
      or (schemaname='supabase_migrations' and tablename='schema_migrations')
      or (schemaname='storage' and tablename='buckets')
    order by schemaname,tablename
  loop
    v_row:='to_jsonb(t)';
    if t.schemaname='auth' and t.tablename='users' then
      v_row:=v_row||' - array[''confirmation_token'',''recovery_token'',''email_change_token_new'',''email_change_token_current'',''reauthentication_token'',''phone_change_token'']::text[]';
    end if;
    return query execute format(
      'select %L::text,page,jsonb_agg(row_data) from (select (row_number() over ()-1)/100 as page,%s as row_data from %I.%I t %s) s group by page order by page',
      t.schemaname||'.'||t.tablename,v_row,t.schemaname,t.tablename,
      case when t.schemaname='storage' then 'where id <> ''service-backups''' else '' end);
  end loop;
end;
$$;
revoke all on function public.backup_snapshot_pages() from public,anon,authenticated;
grant execute on function public.backup_snapshot_pages() to service_role;
