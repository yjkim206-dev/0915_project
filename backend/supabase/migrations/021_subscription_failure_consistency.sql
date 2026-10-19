-- Preserve pending orders created by the previous automatic-only frontend.
update public.payment_orders set subscription_mode='automatic' where product_type='subscription' and subscription_mode is null;
create or replace function public.default_subscription_order_mode()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.product_type='subscription' and new.subscription_mode is null then new.subscription_mode:='automatic'; end if;
  return new;
end;
$$;
create trigger default_subscription_order_mode before insert on public.payment_orders
  for each row execute function public.default_subscription_order_mode();
revoke all on function public.default_subscription_order_mode() from public,anon,authenticated;

create or replace function public.record_subscription_failure(p_order_id text,p_code text,p_message text)
returns void language plpgsql security definer set search_path=public as $$
declare v_order public.payment_orders%rowtype;
begin
  select * into v_order from public.payment_orders where id=p_order_id;
  if not found or v_order.product_type<>'subscription' then raise exception 'ORDER_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_order.user_id::text||':subscription',0));
  select * into v_order from public.payment_orders where id=p_order_id for update;
  if v_order.status<>'pending' then return; end if;
  delete from public.subscription_payment_attempts where order_id=p_order_id;
  update public.payment_orders set status='failed',failure_code=left(p_code,100),failure_message=left(p_message,500),failed_at=now() where id=p_order_id;
  if v_order.subscription_id is not null then
    update public.subscriptions set status='past_due',last_error=left(p_message,500),updated_at=now()
      where id=v_order.subscription_id and status='active';
  end if;
  insert into public.subscription_events(user_id,subscription_id,order_id,event_type,description)
    values(v_order.user_id,v_order.subscription_id,p_order_id,'payment_failed',left(p_message,500));
end;
$$;
revoke all on function public.record_subscription_failure(text,text,text) from public,anon,authenticated;
grant execute on function public.record_subscription_failure(text,text,text) to service_role;
