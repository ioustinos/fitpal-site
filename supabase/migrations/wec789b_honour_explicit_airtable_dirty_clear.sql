-- WEC-789 follow-up. The reconcile fix clears airtable_dirty for an order that
-- can never be mirrored (e.g. a refunded card order, which fails
-- isMirrorEligible). That clear is itself an UPDATE, and this trigger saw
-- `old.airtable_synced_at is not null` and set the flag straight back to true.
-- Previously-synced orders therefore kept looping every 5 minutes anyway —
-- FP-260901-00004 and FP-260907-00007 were still cycling after the fix shipped.
--
-- An explicit transition true -> false is deliberate: honour it, return early.
-- Unchanged otherwise:
--   · a real push (clears dirty AND stamps synced_at) still returns early
--   · an ordinary admin edit on an already-synced order still re-queues it
--
-- Applied live 2026-09-18 via MCP; this file is the record (LINEAR PROTOCOL 5).
create or replace function public.flag_order_airtable_dirty()
returns trigger
language plpgsql
as $$
begin
  if old.airtable_dirty is true and new.airtable_dirty is false then
    return new;
  end if;

  if new.airtable_synced_at is distinct from old.airtable_synced_at then
    return new;
  end if;

  if old.airtable_synced_at is not null then
    new.airtable_dirty := true;
  end if;

  return new;
end
$$;
