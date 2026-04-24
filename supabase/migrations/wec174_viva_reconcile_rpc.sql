-- WEC-174 — RPC used by viva-reconcile.ts to find stale pending orders.
--
-- Picks card/link orders stuck in 'pending' for >3 min, up to 48h old,
-- where the payment_links row hasn't been re-verified in the last 3 min.
--
-- Applied: 2026-04-24

create or replace function public.viva_stale_pending_orders(p_limit int default 50)
returns table (order_id uuid, viva_order_code text)
language sql
security definer
set search_path = public
as $$
  select pl.order_id, pl.viva_order_code
  from public.payment_links pl
  join public.orders o on o.id = pl.order_id
  where o.payment_status = 'pending'
    and o.payment_method in ('card', 'link')
    and o.created_at > now() - interval '48 hours'
    and pl.viva_order_code is not null
    and (pl.last_verified_at is null or pl.last_verified_at < now() - interval '3 minutes')
  order by o.created_at asc
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.viva_stale_pending_orders(int) from public, anon, authenticated;
grant execute on function public.viva_stale_pending_orders(int) to service_role;

comment on function public.viva_stale_pending_orders(int) is
  'Reconcile helper: returns card/link orders pending >3 min, <48h old, with stale verify timestamps.';
