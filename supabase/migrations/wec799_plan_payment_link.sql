-- WEC-799: admin payment links for subscriptions (wallet_plans).
-- 1) link_sent_at: when an admin last sent a Viva payment link for the plan.
--    Gives a freshly-sent link its own clock, regardless of how old the plan is.
--    Nullable, no default, NO backfill (wallet_plans has the airtable_dirty trigger).
alter table public.wallet_plans add column if not exists link_sent_at timestamptz;
comment on column public.wallet_plans.link_sent_at is
  'WEC-799: last time an admin sent a Viva payment link for this plan. Staleness for reconcile = coalesce(link_sent_at, created_at).';

-- 2) Reconcile re-verify set:
--    * include 'pending_link_sent' (otherwise a link-sent plan drops out of the
--      safety net entirely and relies on the webhook alone);
--    * staleness from coalesce(link_sent_at, created_at);
--    * NEWEST first within a 30-day window — the old order (oldest first, limit 10)
--      let abandoned card checkouts starve the batch so recent plans (exactly where a
--      fresh link lands) were never re-verified.
create or replace function public.viva_stale_pending_wallet_plans(p_limit integer default 50)
returns table(id uuid, viva_order_code text, amount_cents integer, created_at timestamp with time zone)
language sql security definer set search_path to 'public'
as $function$
  select wp.id, wp.viva_order_code, wp.amount_to_pay_cents, coalesce(wp.link_sent_at, wp.created_at)
  from public.wallet_plans wp
  where wp.payment_status in ('pending', 'pending_link_sent')
    and wp.payment_method in ('card','link')
    and wp.viva_order_code is not null
    and coalesce(wp.link_sent_at, wp.created_at) < now() - interval '3 minutes'
    and coalesce(wp.link_sent_at, wp.created_at) > now() - interval '30 days'
  order by coalesce(wp.link_sent_at, wp.created_at) desc
  limit p_limit
$function$;
