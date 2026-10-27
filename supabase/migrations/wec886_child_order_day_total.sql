-- WEC-886: stored per-day cost on child/day orders.
-- day_total = Σ order_items.total_price for the child order (cents).
-- Maintained automatically by a trigger on order_items; backfilled once here.

alter table public.child_orders
  add column if not exists day_total integer not null default 0;

create or replace function public.recalc_child_order_day_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'DELETE') then
    update public.child_orders
      set day_total = coalesce((select sum(total_price) from public.order_items where child_order_id = OLD.child_order_id), 0)
      where id = OLD.child_order_id;
    return OLD;
  end if;
  update public.child_orders
    set day_total = coalesce((select sum(total_price) from public.order_items where child_order_id = NEW.child_order_id), 0)
    where id = NEW.child_order_id;
  if (TG_OP = 'UPDATE' and NEW.child_order_id is distinct from OLD.child_order_id) then
    update public.child_orders
      set day_total = coalesce((select sum(total_price) from public.order_items where child_order_id = OLD.child_order_id), 0)
      where id = OLD.child_order_id;
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_order_items_day_total on public.order_items;
create trigger trg_order_items_day_total
  after insert or update or delete on public.order_items
  for each row execute function public.recalc_child_order_day_total();

-- one-time backfill of existing rows
update public.child_orders co
  set day_total = coalesce((select sum(oi.total_price) from public.order_items oi where oi.child_order_id = co.id), 0);
