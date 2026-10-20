-- User-facing payment history is returned by the Edge Function's allowlist.
-- Provider responses can contain payment/webhook identifiers and must not be
-- readable through the direct Data API, even when the order belongs to a user.
revoke select on public.payment_orders from public, anon, authenticated;
grant select (
  id,user_id,product_id,product_name,product_type,amount,credits,status,
  created_at,paid_at,canceled_at,cancel_reason,failure_code,failure_message,failed_at,
  subscription_mode,subscription_id,subscription_period_start,subscription_period_end
) on public.payment_orders to authenticated;
