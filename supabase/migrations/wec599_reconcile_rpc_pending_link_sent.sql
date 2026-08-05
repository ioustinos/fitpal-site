-- WEC-599: the reconcile safety-net must treat «pending_link_sent» as unpaid,
-- exactly like «pending». Without this, an order that had a link sent would
-- never be picked up by the poll and — if the webhook + return-URL both missed —
-- would never flip to paid. This is the trap called out on the ticket.
--
-- Separate migration from the enum ADD VALUE (Postgres won't let the new value
-- be used in the same transaction that added it).

create or replace function public.viva_stale_pending_orders(p_limit integer default 50)
  returns table(order_id uuid, viva_order_code text)
  language sql
  security definer
  set search_path to 'public'
as $function$
  select pl.order_id, pl.viva_order_code
  from public.payment_links pl
  join public.orders o on o.id = pl.order_id
  where o.payment_status in ('pending', 'pending_link_sent')   -- WEC-599
    and o.status <> 'draft'                                    -- WEC-419
    and o.payment_method in ('card', 'link')
    and o.created_at > now() - interval '90 days'              -- WEC-425
    and pl.viva_order_code is not null
    and (pl.last_verified_at is null or pl.last_verified_at < now() - interval '3 minutes')
  order by o.created_at asc
  limit greatest(1, least(p_limit, 200));
$function$;
