-- WEC-478: Airtable mirror bookkeeping on orders.
-- airtable_dirty  = order needs (re)pushing to Airtable
-- airtable_synced_at = last successful push
--
-- Default FALSE so historical/pre-integration orders are NOT mass-flagged.
-- New eligible orders are flagged explicitly by submit-order / markPaid.
-- Already-mirrored orders (synced_at not null) get re-flagged on any content
-- change (incl. child/item edits) so admin edits re-mirror. The push's own
-- sync-stamp update is exempted to avoid a trigger loop.

alter table public.orders add column if not exists airtable_dirty boolean not null default false;
alter table public.orders add column if not exists airtable_synced_at timestamptz;

create index if not exists idx_orders_airtable_dirty on public.orders(airtable_dirty) where airtable_dirty;

-- BEFORE UPDATE on orders: re-flag previously-mirrored orders on content change.
create or replace function public.flag_order_airtable_dirty()
returns trigger language plpgsql as $$
begin
  -- The push stamps airtable_synced_at; that update must not re-flag.
  if new.airtable_synced_at is distinct from old.airtable_synced_at then
    return new;
  end if;
  -- Only re-flag orders we've already mirrored at least once.
  if old.airtable_synced_at is not null then
    new.airtable_dirty := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_flag_airtable_dirty on public.orders;
create trigger trg_orders_flag_airtable_dirty
  before update on public.orders
  for each row execute function public.flag_order_airtable_dirty();

-- child_orders / order_items changes bubble up to the parent order (only if
-- that order was already mirrored).
create or replace function public.flag_parent_order_airtable_dirty()
returns trigger language plpgsql as $$
declare v_order_id uuid;
begin
  if tg_table_name = 'child_orders' then
    v_order_id := coalesce(new.order_id, old.order_id);
    update public.orders set airtable_dirty = true
      where id = v_order_id and airtable_synced_at is not null;
  elsif tg_table_name = 'order_items' then
    update public.orders o set airtable_dirty = true
      from public.child_orders c
      where c.id = coalesce(new.child_order_id, old.child_order_id)
        and o.id = c.order_id and o.airtable_synced_at is not null;
  end if;
  return null;
end $$;

drop trigger if exists trg_child_orders_flag_airtable_dirty on public.child_orders;
create trigger trg_child_orders_flag_airtable_dirty
  after insert or update or delete on public.child_orders
  for each row execute function public.flag_parent_order_airtable_dirty();

drop trigger if exists trg_order_items_flag_airtable_dirty on public.order_items;
create trigger trg_order_items_flag_airtable_dirty
  after insert or update or delete on public.order_items
  for each row execute function public.flag_parent_order_airtable_dirty();
