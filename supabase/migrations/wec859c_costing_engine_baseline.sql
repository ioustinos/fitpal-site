-- ============================================================================
-- WEC-859 — follow-up to wec859_costing_engine.sql (applied to DEV 2026-10-11).
--
-- Found by supabase/tests/costing_engine_test.sql: an item/component with no
-- ledger row before its first change had no baseline («unpriced» before the
-- first purchase was missing; a brand-new item with only a standard cost had
-- no row at all). Fix:
--   • cost_rebuild_entity starts from 1900-01-01 when no live row exists
--     before the change date;
--   • inserting a cost item or a component enqueues its baseline.
-- ============================================================================
create or replace function public.cost_rebuild_entity(p_type text, p_id text, p_from date, p_cause text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  d date; r jsonb; v_cost numeric; v_food numeric; v_pack numeric; v_flags jsonb;
  prev record; v_n int := 0; v_from date := p_from;
begin
  if not exists (select 1 from cost_history where entity_type = p_type and entity_id = p_id
                 and superseded_at is null and effective_from < p_from) then
    v_from := date '1900-01-01';
  end if;
  update cost_history set superseded_at = now()
   where entity_type = p_type and entity_id = p_id and effective_from >= v_from and superseded_at is null;
  for d in
    select x from (select v_from as x union select public.cost_change_dates(p_type, p_id, v_from)) s order by x
  loop
    r := public.cost_compute(p_type, p_id, d);
    if r is null then continue; end if;
    if p_type = 'item' then
      v_cost := (r->>'unit_cost')::numeric; v_food := null; v_pack := null;
      v_flags := jsonb_strip_nulls(jsonb_build_object(
        'estimated', case when r->>'source' = 'standard' then true end,
        'unpriced',  case when r->>'source' = 'unpriced' then true end));
    elsif p_type = 'component' then
      v_cost := (r->>'cost_per_g')::numeric; v_food := null; v_pack := null; v_flags := coalesce(r->'flags', '{}');
    else
      v_cost := (r->>'product_cost')::numeric; v_food := (r->>'food_cost')::numeric;
      v_pack := (r->>'packaging_cost')::numeric; v_flags := coalesce(r->'flags', '{}');
    end if;
    select unit_cost, food_cost, packaging_cost, flags into prev
    from cost_history where entity_type = p_type and entity_id = p_id and effective_from < d
      and superseded_at is null
    order by effective_from desc limit 1;
    if found and round(prev.unit_cost, 8) = round(v_cost, 8)
       and prev.food_cost is not distinct from round(v_food, 6)
       and prev.packaging_cost is not distinct from round(v_pack, 6)
       and prev.flags = v_flags then
      continue;
    end if;
    insert into cost_history (entity_type, entity_id, effective_from, unit_cost, food_cost, packaging_cost, flags, breakdown, cause)
    values (p_type, p_id, d, round(v_cost, 8), round(v_food, 6), round(v_pack, 6), v_flags, r, p_cause);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.trg_cost_item_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  if TG_OP = 'INSERT'
     or NEW.standard_cost_per_unit is distinct from OLD.standard_cost_per_unit
     or NEW.grams_per_unit is distinct from OLD.grams_per_unit
     or NEW.base_unit is distinct from OLD.base_unit then
    perform public.cost_enqueue('item', NEW.id::text, date '1900-01-01', 'item:' || NEW.id);
  end if;
  return null;
end $$;
create or replace trigger cost_items_changed after insert or update on public.cost_items
  for each row execute function public.trg_cost_item_changed();

create or replace function public.trg_cost_component_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('costing.skip_triggers', true), '') = 'on' then return null; end if;
  perform public.cost_enqueue('component', NEW.id::text, date '1900-01-01', 'component:' || NEW.id);
  return null;
end $$;
create or replace trigger cost_components_created after insert on public.cost_components
  for each row execute function public.trg_cost_component_created();
create or replace trigger cost_zq_cost_components after insert on public.cost_components
  for each statement execute function public.trg_cost_process_queue();

revoke execute on function public.cost_rebuild_entity(text,text,date,text) from public, anon, authenticated;
revoke execute on function public.trg_cost_item_changed() from public, anon, authenticated;
revoke execute on function public.trg_cost_component_created() from public, anon, authenticated;
