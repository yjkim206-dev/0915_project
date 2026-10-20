create extension if not exists pgcrypto with schema extensions;

create table public.backup_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  frequency text not null default 'daily' check (frequency in ('daily','weekly','monthly','quarterly','yearly')),
  time_kst time not null default '03:00',
  weekday integer not null default 1 check (weekday between 0 and 6),
  retention_years integer not null default 3 check (retention_years between 1 and 10),
  next_run_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.backup_settings(id) values(true);
create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','completed','failed','deleting','deleted')),
  trigger_type text not null check (trigger_type in ('manual','scheduled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  lease_until timestamptz,
  lease_token uuid,
  prefix text not null,
  total_items integer not null default 0,
  completed_items integer not null default 0,
  bytes bigint not null default 0,
  error text,
  manifest jsonb
);
create unique index backup_one_active on public.backup_runs((true)) where status='running';
create table public.backup_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.backup_runs(id) on delete cascade,
  kind text not null check (kind in ('database','storage')),
  destination text not null,
  source_bucket text,
  source_path text,
  source_version text,
  payload bytea,
  sha256 text,
  bytes bigint not null default 0,
  completed boolean not null default false
);
create index backup_pending_items on public.backup_items(run_id,id) where not completed;
alter table public.backup_settings enable row level security;
alter table public.backup_runs enable row level security;
alter table public.backup_items enable row level security;
revoke all on public.backup_settings,public.backup_runs,public.backup_items from anon,authenticated;
grant all on public.backup_settings,public.backup_runs,public.backup_items to service_role;

-- STABLE keeps all table reads on the calling statement's MVCC snapshot.
create function public.backup_snapshot_pages()
returns table(table_name text,page bigint,rows jsonb)
language plpgsql stable security definer set search_path=public as $$
declare t record;
begin
  for t in select schemaname,tablename from pg_tables
    where (schemaname='public' and (tablename not like 'backup\_%' escape '\' or tablename='backup_settings'))
      or (schemaname='auth' and tablename in ('users','identities','mfa_factors'))
      or (schemaname='supabase_migrations' and tablename='schema_migrations')
      or (schemaname='storage' and tablename='buckets')
    order by schemaname,tablename
  loop
    return query execute format(
      'select %L::text,page,jsonb_agg(row_data) from (select (row_number() over ()-1)/100 as page,to_jsonb(t) as row_data from %I.%I t %s) s group by page order by page',
      t.schemaname||'.'||t.tablename,t.schemaname,t.tablename,
      case when t.schemaname='storage' then 'where id <> ''service-backups''' else '' end);
  end loop;
end;
$$;

-- One database transaction captures all application tables and credential records.
-- Payloads are encrypted before they leave PostgreSQL; the key is never persisted here.
create function public.backup_start(p_key text,p_trigger text,p_next timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid; v_prefix text; v_table record; v_page record; v_cipher bytea;
  v_settings public.backup_settings; v_tables jsonb:='[]'; v_storage_count integer;
begin
  perform pg_advisory_xact_lock(240024);
  if length(p_key)<40 then raise exception 'Backup encryption key is unavailable'; end if;
  if p_trigger not in ('manual','scheduled') then raise exception 'Invalid trigger'; end if;
  select id into v_id from public.backup_runs where status='running';
  if v_id is not null then return v_id; end if;
  select * into v_settings from public.backup_settings where id for update;
  if p_trigger='scheduled' and (not v_settings.enabled or v_settings.next_run_at>now()) then return null; end if;
  v_id:=gen_random_uuid();
  v_prefix:=to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')||'/'||v_id;
  insert into public.backup_runs(id,trigger_type,expires_at,prefix)
    values(v_id,p_trigger,now()+make_interval(years=>v_settings.retention_years),v_prefix);
  insert into public.backup_items(run_id,kind,destination,payload,bytes,sha256)
    select v_id,'database',v_prefix||'/database/'||table_name||'/'||page||'.json.pgp',cipher,
      octet_length(cipher),encode(extensions.digest(cipher,'sha256'),'hex')
    from (select table_name,page,extensions.pgp_sym_encrypt(jsonb_build_object('table',table_name,'rows',rows)::text,p_key,'cipher-algo=aes256,compress-algo=1') as cipher
      from public.backup_snapshot_pages()) encrypted;
  if exists(select 1 from public.backup_items where run_id=v_id and bytes>45000000) then raise exception 'Backup page exceeds storage limit'; end if;
  select coalesce(jsonb_agg(distinct split_part(destination,'/database/',2)::text),'[]') into v_tables from public.backup_items where run_id=v_id;
  insert into public.backup_items(run_id,kind,destination,source_bucket,source_path,source_version,bytes)
    select v_id,'storage',v_prefix||'/files/'||bucket_id||'/'||name,bucket_id,name,version,
      coalesce((metadata->>'size')::bigint,0)
    from storage.objects where bucket_id<>'service-backups';
  get diagnostics v_storage_count=row_count;
  update public.backup_runs set total_items=(select count(*) from public.backup_items where run_id=v_id),
    manifest=jsonb_build_object('format','moa-service-backup-v1','snapshot_at',now(),'tables',v_tables,
      'storage_files',v_storage_count,'database_encryption','OpenPGP AES-256 (BACKUP_ENCRYPTION_KEY)',
      'excluded',jsonb_build_array('auth sessions and temporary tokens','hosting secrets','source code (GitHub)','backup bucket'))
    where id=v_id;
  -- The clock advances only after a snapshot was successfully captured.
  if p_next is not null then update public.backup_settings set next_run_at=p_next where id; end if;
  return v_id;
end;
$$;

create function public.backup_claim()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.backup_runs; v_token uuid:=gen_random_uuid(); v_items jsonb;
begin
  select * into v_run from public.backup_runs where status='running'
    and (lease_until is null or lease_until<now()) order by created_at limit 1 for update skip locked;
  if v_run.id is null then return null; end if;
  update public.backup_runs set lease_token=v_token,lease_until=now()+interval '3 minutes' where id=v_run.id;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into v_items from (
    select id,kind,destination,source_bucket,source_path,source_version,bytes,sha256,
      encode(payload,'base64') as payload from public.backup_items
      where run_id=v_run.id and not completed order by id limit 3
  ) s;
  return jsonb_build_object('run',to_jsonb(v_run),'token',v_token,'items',v_items);
end;
$$;

create function public.backup_storage_version(p_bucket text,p_path text)
returns text language sql security definer set search_path=public as $$
  select version from storage.objects where bucket_id=p_bucket and name=p_path;
$$;
create function public.backup_finish_item(p_run uuid,p_token uuid,p_item bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.backup_runs where id=p_run and status='running' and lease_token=p_token and lease_until>now()) then raise exception 'Lease expired'; end if;
  update public.backup_items set completed=true where id=p_item and run_id=p_run;
  update public.backup_runs set completed_items=(select count(*) from public.backup_items where run_id=p_run and completed),
    bytes=(select coalesce(sum(bytes),0) from public.backup_items where run_id=p_run and completed) where id=p_run;
end;
$$;
revoke all on function public.backup_start(text,text,timestamptz),public.backup_claim(),public.backup_storage_version(text,text),public.backup_finish_item(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.backup_start(text,text,timestamptz),public.backup_claim(),public.backup_storage_version(text,text),public.backup_finish_item(uuid,uuid,bigint) to service_role;
revoke all on function public.backup_snapshot_pages() from public,anon,authenticated;
grant execute on function public.backup_snapshot_pages() to service_role;

create function public.backup_usage() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('storage_bytes',coalesce(sum((metadata->>'size')::bigint),0),'storage_objects',count(*))
  from storage.objects where bucket_id='service-backups';
$$;
revoke all on function public.backup_usage() from public,anon,authenticated;
grant execute on function public.backup_usage() to service_role;

create function public.invoke_service_backups()
returns void language plpgsql security definer set search_path=public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='moa_subscription_cron_secret' limit 1;
  if coalesce(v_secret,'')='' then return; end if;
  perform net.http_post(url:='https://ymprvqsfpwvoutwozwvn.supabase.co/functions/v1/api/internal/backups/tick',
    headers:=jsonb_build_object('Content-Type','application/json','x-subscription-cron-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=120000);
end;
$$;
revoke all on function public.invoke_service_backups() from public,anon,authenticated;
select cron.schedule('moa-service-backups','* * * * *','select public.invoke_service_backups();');
