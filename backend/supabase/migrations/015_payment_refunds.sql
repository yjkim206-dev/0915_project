alter table public.payment_orders
  drop constraint if exists payment_orders_status_check;
alter table public.payment_orders
  add constraint payment_orders_status_check check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded'));
alter table public.payment_orders
  add column if not exists cancel_reason text,
  add column if not exists canceled_at timestamptz,
  add column if not exists toss_cancel_data jsonb;

alter table public.credit_transactions
  drop constraint if exists credit_transactions_amount_check;
alter table public.credit_transactions
  add constraint credit_transactions_amount_check check (amount <> 0);

create or replace function public.refund_credit_order(
  p_order_id text,
  p_cancel_reason text,
  p_cancel_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.payment_orders%rowtype;
  v_balance bigint;
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
  if coalesce(v_balance, 0) < v_order.credits then raise exception 'INSUFFICIENT_CREDIT_BALANCE'; end if;
  update public.payment_orders
    set status = 'refunded', cancel_reason = p_cancel_reason, canceled_at = now(), toss_cancel_data = p_cancel_data
    where id = p_order_id;
  update public.credit_wallets set balance = balance - v_order.credits, updated_at = now() where user_id = v_order.user_id;
  insert into public.credit_transactions(user_id, order_id, amount, description)
    values (v_order.user_id, v_order.id, -v_order.credits, '포인트 결제 환불');
  select balance into v_balance from public.credit_wallets where user_id = v_order.user_id;
  return jsonb_build_object('orderId', v_order.id, 'status', 'refunded', 'balance', v_balance, 'refundedCredits', v_order.credits, 'alreadyProcessed', false);
end;
$$;

revoke all on function public.refund_credit_order(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.refund_credit_order(text, text, jsonb) to service_role;
