-- The browser uses authenticated Edge Functions, not the service-owned view.
-- RLS on base tables does not protect a security-definer view from direct reads.
alter view public.post_list set (security_invoker = true);
revoke all on public.post_list from public, anon, authenticated;
grant select on public.post_list to service_role;
comment on view public.post_list is 'Edge Function only; visibility checked by the API and base-table RLS is respected.';
