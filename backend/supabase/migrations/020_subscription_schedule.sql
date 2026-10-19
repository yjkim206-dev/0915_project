create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_subscription_renewals()
returns void language plpgsql security definer set search_path=public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='moa_subscription_cron_secret' limit 1;
  -- Provision the matching Edge secret only after deployment and fixture checks.
  if coalesce(v_secret,'')='' then return; end if;
  perform net.http_post(
    url:='https://ymprvqsfpwvoutwozwvn.supabase.co/functions/v1/api/internal/subscriptions/renew',
    headers:=jsonb_build_object('Content-Type','application/json','x-subscription-cron-secret',v_secret),
    body:='{}'::jsonb, timeout_milliseconds:=120000
  );
end;
$$;
revoke all on function public.invoke_subscription_renewals() from public,anon,authenticated;
select cron.schedule('moa-subscription-renewals','*/5 * * * *','select public.invoke_subscription_renewals();');
