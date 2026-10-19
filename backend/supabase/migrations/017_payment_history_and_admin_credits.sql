-- Keep the purchased name even when the shop catalog changes later.
alter table public.payment_orders
  add column if not exists product_name text,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists failed_at timestamptz;

update public.payment_orders o set product_name = p.name
from public.shop_products p where p.id = o.product_id and o.product_name is null;

-- Manual adjustments share the wallet ledger, without a purchase order.
alter table public.credit_transactions
  alter column order_id drop not null,
  add column if not exists kind text not null default 'purchase',
  add column if not exists actor_id uuid references auth.users(id) on delete set null,
  add column if not exists balance_before bigint,
  add column if not exists balance_after bigint,
  add column if not exists request_id uuid unique;
update public.credit_transactions set kind = 'refund' where amount < 0 and kind = 'purchase';
alter table public.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('purchase', 'refund', 'admin_grant', 'admin_revoke'));
create index if not exists credit_transactions_actor_created_idx
  on public.credit_transactions(actor_id, created_at desc) where actor_id is not null;

create or replace function public.admin_adjust_credits(
  p_actor_id uuid, p_user_id uuid, p_amount bigint, p_reason text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_before bigint;
  v_after bigint;
  v_previous public.credit_transactions%rowtype;
  v_id bigint;
begin
  if not exists (select 1 from public.admins where id = p_actor_id)
     and not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_amount is null or p_amount = 0 or p_amount < -10000000 or p_amount > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 or length(trim(p_reason)) > 500 then raise exception 'INVALID_REASON'; end if;
  if p_request_id is null then raise exception 'INVALID_REQUEST_ID'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;

  -- Serialize retries before checking the unique request id, including retries
  -- that accidentally target another wallet. Wallet locking also serializes
  -- distinct adjustments with purchases/refunds that update this wallet.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_previous from public.credit_transactions where request_id = p_request_id;
  if found then
    if v_previous.user_id <> p_user_id or v_previous.actor_id <> p_actor_id
       or v_previous.amount <> p_amount or v_previous.description <> trim(p_reason) then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('transactionId', v_previous.id, 'balance', v_previous.balance_after, 'alreadyProcessed', true);
  end if;
  insert into public.credit_wallets(user_id, balance) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance into v_before from public.credit_wallets where user_id = p_user_id for update;
  v_after := v_before + p_amount;
  if v_after < 0 then raise exception 'INSUFFICIENT_CREDIT_BALANCE'; end if;
  update public.credit_wallets set balance = v_after, updated_at = now() where user_id = p_user_id;
  insert into public.credit_transactions(user_id, order_id, amount, description, kind, actor_id, balance_before, balance_after, request_id)
    values (p_user_id, null, p_amount, trim(p_reason), case when p_amount > 0 then 'admin_grant' else 'admin_revoke' end,
      p_actor_id, v_before, v_after, p_request_id) returning id into v_id;
  return jsonb_build_object('transactionId', v_id, 'balance', v_after, 'alreadyProcessed', false);
end;
$$;
revoke all on function public.admin_adjust_credits(uuid, uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_adjust_credits(uuid, uuid, bigint, text, uuid) to service_role;

comment on function public.admin_adjust_credits(uuid, uuid, bigint, text, uuid)
is 'Administrator-only atomic credit adjustment with audit trail and idempotent request id';
