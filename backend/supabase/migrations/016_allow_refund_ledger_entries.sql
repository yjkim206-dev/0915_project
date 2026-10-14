alter table public.credit_transactions
  drop constraint if exists credit_transactions_order_id_key;

create unique index if not exists credit_transactions_single_credit_grant_per_order
  on public.credit_transactions(order_id)
  where amount > 0;
