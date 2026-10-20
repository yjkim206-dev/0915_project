create table public.post_attachments (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id bigint references public.posts(id) on delete cascade,
  object_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes between 1 and 52428800),
  status text not null default 'pending' check(status in ('pending','ready')),
  created_at timestamptz not null default now(),
  position integer not null default 0
);
create index post_attachment_post on public.post_attachments(post_id,position);
create index post_attachment_owner on public.post_attachments(owner_id,created_at);
create table public.attachment_delete_queue (
  object_path text primary key,
  next_attempt_at timestamptz not null default now(),
  recheck_until timestamptz not null
);
alter table public.post_attachments enable row level security;
alter table public.attachment_delete_queue enable row level security;
revoke all on public.post_attachments,public.attachment_delete_queue from anon,authenticated;
grant all on public.post_attachments,public.attachment_delete_queue to service_role;
create function public.queue_attachment_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.attachment_delete_queue(object_path,recheck_until)
    values(old.object_path,greatest(now(),old.created_at+interval '130 minutes'))
    on conflict(object_path) do update set next_attempt_at=now();
  return old;
end;
$$;
create trigger post_attachment_delete after delete on public.post_attachments for each row execute function public.queue_attachment_delete();

create function public.reserve_post_attachment(p_actor uuid,p_id uuid,p_path text,p_name text,p_mime text,p_size bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,25));
  if (select count(*) from public.post_attachments where owner_id=p_actor and post_id is null)>=30 then raise exception 'Too many draft attachments'; end if;
  insert into public.post_attachments(id,owner_id,object_path,original_name,mime_type,size_bytes)
    values(p_id,p_actor,p_path,p_name,p_mime,p_size);
end;
$$;
create function public.save_post_attachments(p_actor uuid,p_post bigint,p_title text,p_content text,p_category text,p_ids uuid[] default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_post bigint:=p_post; v_owner uuid; v_id uuid; v_count integer; v_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,25));
  if p_post is not null then
    select author_id into v_owner from public.posts where id=p_post for update;
    if v_owner is distinct from p_actor then raise exception 'Post owner mismatch'; end if;
  end if;
  if length(trim(p_title))<1 or length(p_title)>300 or length(p_content)>100000 then raise exception 'Invalid post content'; end if;
  if p_ids is not null then
    if cardinality(p_ids)>10 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'Invalid attachment count'; end if;
    perform 1 from public.post_attachments where id=any(p_ids) order by id for update;
    select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.post_attachments
      where id=any(p_ids) and owner_id=p_actor and status='ready' and (post_id is null or post_id=p_post);
    if v_count<>cardinality(p_ids) or v_bytes>209715200 then raise exception 'Invalid attachments'; end if;
  else
    select count(*) into v_count from public.post_attachments where post_id=p_post;
  end if;
  if length(trim(p_content))=0 and coalesce(v_count,0)=0 then raise exception 'Content or attachment is required'; end if;
  if v_post is null then
    insert into public.posts(title,content,category,author_id) values(trim(p_title),trim(p_content),p_category,p_actor) returning id into v_post;
  else
    update public.posts set title=trim(p_title),content=trim(p_content),category=p_category where id=v_post;
  end if;
  if p_ids is not null then
    delete from public.post_attachments where post_id=v_post and not(id=any(p_ids));
    update public.post_attachments a set post_id=v_post,position=s.ordinality::integer
      from unnest(p_ids) with ordinality s(id,ordinality) where a.id=s.id;
  end if;
  return v_post;
end;
$$;
create function public.attachment_object_metadata(p_path text) returns jsonb language sql stable security definer set search_path=public as $$
  select metadata from storage.objects where bucket_id='post-attachments' and name=p_path;
$$;
revoke all on function public.queue_attachment_delete(),public.reserve_post_attachment(uuid,uuid,text,text,text,bigint),public.save_post_attachments(uuid,bigint,text,text,text,uuid[]),public.attachment_object_metadata(text) from public,anon,authenticated;
grant execute on function public.reserve_post_attachment(uuid,uuid,text,text,text,bigint),public.save_post_attachments(uuid,bigint,text,text,text,uuid[]),public.attachment_object_metadata(text) to service_role;

create function public.invoke_attachment_cleanup() returns void language plpgsql security definer set search_path=public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='moa_subscription_cron_secret' limit 1;
  if coalesce(v_secret,'')='' then return; end if;
  perform net.http_post(url:='https://ymprvqsfpwvoutwozwvn.supabase.co/functions/v1/api/internal/attachments/cleanup',headers:=jsonb_build_object('Content-Type','application/json','x-subscription-cron-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=120000);
end;
$$;
revoke all on function public.invoke_attachment_cleanup() from public,anon,authenticated;
select cron.schedule('moa-attachment-cleanup','*/5 * * * *','select public.invoke_attachment_cleanup();');
