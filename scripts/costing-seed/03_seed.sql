-- ============================================================================
-- WEC-860 (Excel seed) + WEC-865 (auto-links) — write run.
-- Idempotent: every row carries source_ref (items, components) or is keyed by
-- (dish, ingredient) / (dish, item); a re-run updates Excel standard costs and
-- adds nothing new. Never overwrites a link or packaging row an admin set.
--   select costing_seed.seed(date '2026-10-12');   -- versions effective date
--   select public.cost_rebuild_all();              -- then build the ledger
-- ============================================================================
create or replace function costing_seed.seed(p_effective date) returns jsonb
language plpgsql as $$
declare
  r record; v_comp uuid; v_ver uuid; v_item uuid;
  n_food int; n_pack int; n_simple int := 0; n_comp int := 0; n_links int; n_defaults int; n_dpack int;
begin
  perform set_config('costing.skip_triggers', 'on', true);

  -- 1. food cost items (first row wins on a duplicate name)
  insert into cost_items (name, kind, category, base_unit, default_pack_label, default_base_qty_per_pack,
                          standard_cost_per_unit, source_ref, notes)
  select distinct on (btrim(name)) btrim(name), 'food', category, 'g', 'κιλό', 1000,
         round(price_kg / 1000, 6), 'excel:SrcCosts:' || row, 'Excel «Src Costs» — τιμή κιλού ' || price_kg
  from costing_seed.src_costs where name is not null
  order by btrim(name), row
  on conflict (source_ref) where source_ref is not null do update
    set standard_cost_per_unit = excluded.standard_cost_per_unit;
  get diagnostics n_food = row_count;

  -- 2. packaging cost items
  insert into cost_items (name, kind, category, base_unit, default_pack_label, default_base_qty_per_pack,
                          default_vat_rate, standard_cost_per_unit, source_ref, notes)
  select distinct on (btrim(name)) btrim(name), 'packaging', 'Συσκευασία', 'pcs',
         case when pcs > 0 then trim_scale(pcs) || ' τμχ' else 'τεμάχιο' end, coalesce(nullif(pcs, 0), 1), 0.24,
         round(coalesce(price_pc, case when pcs > 0 then price_pack / pcs end), 6),
         'excel:SrcPackaging:' || row,
         concat_ws(' · ', note, case when coalesce(price_pc, case when pcs > 0 then price_pack / pcs end) is null
                                      then 'Excel: χωρίς τιμή τεμαχίου — χρειάζεται αγορά' end)
  from costing_seed.src_packaging where name is not null
  order by btrim(name), row
  on conflict (source_ref) where source_ref is not null do update
    set standard_cost_per_unit = excluded.standard_cost_per_unit;
  get diagnostics n_pack = row_count;

  -- 3. simple components: one line = 100 g of the raw item, yield % = cooked g per 100 g raw
  for r in
    select distinct on (btrim(i.name)) i.*, c.id as item_id
    from costing_seed.idx i
    join cost_items c on c.source_ref = (select 'excel:SrcCosts:' || min(s.row) from costing_seed.src_costs s
                                         where btrim(s.name) = btrim(i.raw))
    where not exists (select 1 from cost_components x where x.source_ref = 'excel:Index:' || i.row)
      and not exists (select 1 from cost_components x join costing_seed.idx i2 on x.source_ref = 'excel:Index:' || i2.row
                      where btrim(i2.name) = btrim(i.name))
    order by btrim(i.name), i.row
  loop
    insert into cost_components (name, category, source_ref, notes)
    values (btrim(r.name), 'Excel · απλό', 'excel:Index:' || r.row,
            'Excel «New Index Υλικών»: ' || r.raw || ', ' || trim_scale(r.cooked_g) || ' g μαγειρεμένο ανά 100 g ωμό')
    returning id into v_comp;
    insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, yield_pct, notes)
    values (v_comp, 1, p_effective, 'pct', r.cooked_g, 'Seed από Excel')
    returning id into v_ver;
    insert into cost_component_version_lines (version_id, cost_item_id, qty) values (v_ver, r.item_id, 100);
    update cost_component_versions set status = 'published', published_at = now() where id = v_ver;
    n_simple := n_simple + 1;
  end loop;

  -- 4. composite components: recipe not in the file → fixed cost per cooked g («estimated»)
  for r in
    select distinct on (btrim(g.name)) g.* from costing_seed.groups g
    where g.cost100_cooked is not null
      and not exists (select 1 from cost_components x where x.source_ref = 'excel:Group:' || g.row)
      and not exists (select 1 from cost_components x where x.name = btrim(g.name))
    order by btrim(g.name), g.row
  loop
    insert into cost_components (name, category, source_ref, notes)
    values (btrim(r.name), 'Excel · σύνθετο', 'excel:Group:' || r.row,
            'Excel «Group Υλικών»: σταθερό κόστος ανά g μέχρι να μπει η πραγματική συνταγή')
    returning id into v_comp;
    insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, fixed_cost_per_g, status, published_at, notes)
    values (v_comp, 1, p_effective, 'fixed', round(r.cost100_cooked / 100, 8), 'published', now(), 'Seed από Excel (εκτίμηση)');
    n_comp := n_comp + 1;
  end loop;

  -- 5. dish-line links (WEC-865 rules): «exact» everywhere a dish matched at all;
  --    «grams»/«name» only inside dishes where title AND grams agree.
  update costing_seed.line_match l set
    component_id = coalesce(
      (select x.id from cost_components x join costing_seed.idx i on x.source_ref = 'excel:Index:' || i.row
        where btrim(i.name) = btrim(l.excel_name) order by i.row limit 1),
      (select x.id from cost_components x join costing_seed.groups g on x.source_ref = 'excel:Group:' || g.row
        where btrim(g.name) = btrim(l.excel_name) order by g.row limit 1)),
    component_source = null
  where l.excel_name is not null;

  insert into cost_dish_line_links (dish_id, ingredient_id, component_id, source, confirmed, match_note)
  select l.dish_id, l.ingredient_id, l.component_id, 'auto_excel', false,
         'Excel ' || m.sheet || ':' || m.no || ' «' || l.excel_name || '» · πιάτο ' || m.status || ' · γραμμή ' || l.status
  from costing_seed.line_match l join costing_seed.dish_match m using (dish_id)
  where l.component_id is not null
    and (l.status = 'exact' or (m.status = 'matched' and l.status in ('grams', 'name')))
  on conflict (dish_id, ingredient_id) do nothing;
  get diagnostics n_links = row_count;

  -- 6. default per display ingredient: only when ≥ 2 auto links all agree
  insert into cost_ingredient_default_links (ingredient_id, component_id)
  select ingredient_id, min(component_id::text)::uuid
  from cost_dish_line_links where source = 'auto_excel'
  group by ingredient_id
  having count(*) >= 2 and count(distinct component_id) = 1
  on conflict (ingredient_id) do nothing;
  get diagnostics n_defaults = row_count;

  -- 7. packaging per dish from the matched Excel dish (qty = occurrences in the list)
  insert into cost_dish_packaging (dish_id, cost_item_id, qty_per_portion)
  select m.dish_id, ci.id, count(*)
  from costing_seed.dish_match m
  join costing_seed.dishes e on e.sheet = m.sheet and e.no = m.no
  join costing_seed.packsets p on p.id = e.packset
  cross join lateral unnest(string_to_array(p.packaging, ',')) x(name)
  join cost_items ci on ci.kind = 'packaging' and ci.name = btrim(x.name) and ci.source_ref like 'excel:SrcPackaging:%'
  where m.status in ('matched', 'title_only') and btrim(x.name) <> ''
    and not exists (select 1 from cost_dish_packaging z where z.dish_id = m.dish_id)
  group by m.dish_id, ci.id
  on conflict (dish_id, cost_item_id) do nothing;
  get diagnostics n_dpack = row_count;

  perform set_config('costing.skip_triggers', 'off', true);
  return jsonb_build_object('food_items_upserted', n_food, 'packaging_items_upserted', n_pack,
    'simple_components_new', n_simple, 'composite_components_new', n_comp,
    'links_new', n_links, 'default_links_new', n_defaults, 'dish_packaging_rows_new', n_dpack);
end $$;
