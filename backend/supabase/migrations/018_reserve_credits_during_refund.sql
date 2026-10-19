-- Prevent a simultaneous administrator recovery and provider refund from
-- spending the same credits. A reservation remains visible until reconciled.
alter table public.payment_orders add column if not exists refund_reserved boolean not null default false,
  add column if not exists refund_request_id uuid;

create or replace function public.reserve_credit_refund(p_order_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.payment_orders%rowtype; v_balance bigint; v_request_id uuid := gen_random_uuid();
begin
  select * into v_order from public.payment_orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.product_type <> 'credits' then raise exception 'INVALID_PRODUCT_TYPE'; end if;
  if v_order.status in ('refunded', 'cancelled') then return jsonb_build_object('alreadyProcessed', true); end if;
  if v_order.status <> 'paid' then raise exception 'ORDER_NOT_PAID'; end if;
  if v_order.refund_reserved then return jsonb_build_object('alreadyProcessed', false, 'reason', v_order.cancel_reason, 'requestId', v_order.refund_request_id); end if;
  select balance into v_balance from public.credit_wallets where user_id = v_order.user_id for update;
  if coalesce(v_balance, 0) < v_order.credits then raise exception 'INSUFFICIENT_CREDIT_BALANCE'; end if;
  update public.credit_wallets set balance = balance - v_order.credits, updated_at = now() where user_id = v_order.user_id;
  update public.payment_orders set refund_reserved = true, cancel_reason = p_reason, refund_request_id = v_request_id where id = p_order_id;
  return jsonb_build_object('alreadyProcessed', false, 'reason', p_reason, 'requestId', v_request_id);
end;
$$;

create or replace function public.release_credit_refund(p_order_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.payment_orders%rowtype;
begin
  select * into v_order from public.payment_orders where id = p_order_id for update;
  if v_order.status = 'paid' and v_order.refund_reserved then
    update public.credit_wallets set balance = balance + v_order.credits, updated_at = now() where user_id = v_order.user_id;
    update public.payment_orders set refund_reserved = false, cancel_reason = null, refund_request_id = null where id = p_order_id;
  end if;
end;
$$;

create or replace function public.refund_credit_order(p_order_id text, p_cancel_reason text, p_cancel_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.payment_orders%rowtype; v_balance bigint;
begin
  select * into v_order from public.payment_orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.product_type <> 'credits' then raise exception 'INVALID_PRODUCT_TYPE'; end if;
  if v_order.status in ('cancelled', 'refunded') then
    select balance into v_balance from public.credit_wallets where user_id = v_order.user_id;
    return jsonb_build_object('orderId', v_order.id, 'status', v_order.status, 'balance', coalesce(v_balance, 0), 'alreadyProcessed', true);
  end if;
  if v_order.status <> 'paid' then raise exception 'ORDER_NOT_PAID'; end if;
  select balance into v_balance from public.credit_wallets where user_id = v_order.user_id for update;
  if not v_order.refund_reserved then
    if coalesce(v_balance, 0) < v_order.credits then raise exception 'INSUFFICIENT_CREDIT_BALANCE'; end if;
    update public.credit_wallets set balance = balance - v_order.credits, updated_at = now() where user_id = v_order.user_id;
  end if;
  update public.payment_orders set status = 'refunded', refund_reserved = false, cancel_reason = p_cancel_reason,
    canceled_at = now(), toss_cancel_data = p_cancel_data where id = p_order_id;
  insert into public.credit_transactions(user_id, order_id, amount, description, kind)
    values (v_order.user_id, v_order.id, -v_order.credits, '포인트 결제 환불', 'refund');
  select balance into v_balance from public.credit_wallets where user_id = v_order.user_id;
  return jsonb_build_object('orderId', v_order.id, 'status', 'refunded', 'balance', v_balance, 'refundedCredits', v_order.credits, 'alreadyProcessed', false);
end;
$$;
revoke all on function public.reserve_credit_refund(text, text) from public, anon, authenticated;
revoke all on function public.release_credit_refund(text) from public, anon, authenticated;
revoke all on function public.refund_credit_order(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_credit_refund(text, text) to service_role;
grant execute on function public.release_credit_refund(text) to service_role;
grant execute on function public.refund_credit_order(text, text, jsonb) to service_role;
