-- ============================================================================
-- WEC-859 — costing engine tests. Run against the DEV branch only.
--
-- The whole block ROLLS BACK: it ends by raising 'COSTING TESTS PASSED …'
-- (or the first failing assertion). Nothing it creates survives.
-- Depends on dev catalogue data: dish 117 / variant 117-1 (Γλυκόξινο
-- κοτόπουλο), lines «Σάλτσα γλυκόξινη» (fixed 60 g) and «Ρύζι basmati»
-- (per-variant 60 g).
-- ============================================================================
do $$
declare
  s_sup uuid; s_oil uuid; s_tom uuid; s_salt uuid; s_bowl uuid;
  inv1 uuid; inv2 uuid; inv3 uuid; inv4 uuid;
  c_pom uuid; c_sauce uuid; v1 uuid; v2 uuid; vs uuid;
  ing_sauce uuid := 'c8a718f5-44dd-4ce5-b9e5-e28db085bf2d';
  ing_rice  uuid := 'e5ea40fa-94d2-4403-8694-e01fc3f4e53b';
  v_got numeric; v_exp numeric; h public.cost_history; j jsonb; n int := 0;
begin
  create temp table _t (name text, got numeric, expected numeric) on commit drop;

  insert into cost_suppliers (name) values ('TEST supplier ' || gen_random_uuid()) returning id into s_sup;
  insert into cost_items (name, base_unit, default_base_qty_per_pack) values ('TEST oil', 'ml', 1000) returning id into s_oil;
  insert into cost_items (name, base_unit, standard_cost_per_unit) values ('TEST tomato', 'g', 0.002) returning id into s_tom;
  insert into cost_items (name, base_unit) values ('TEST salt', 'g') returning id into s_salt;
  insert into cost_items (name, kind, base_unit, default_base_qty_per_pack, default_vat_rate)
    values ('TEST bowl', 'packaging', 'pcs', 50, 0.24) returning id into s_bowl;

  -- 1. purchases: oil €8/L on 03-01, €10/L on 03-10
  insert into cost_purchase_invoices (supplier_id, invoice_date) values (s_sup, '2026-03-01') returning id into inv1;
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, base_qty_per_pack, net_price_per_pack)
    values (inv1, s_oil, 5, 1000, 8);
  insert into cost_purchase_invoices (supplier_id, invoice_date) values (s_sup, '2026-03-10') returning id into inv2;
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, base_qty_per_pack, net_price_per_pack)
    values (inv2, s_oil, 5, 1000, 10);
  insert into _t values ('oil @03-05 (ledger)', (public.cost_at('item', s_oil::text, '2026-03-05')).unit_cost, 0.008);
  insert into _t values ('oil @03-12 (ledger)', (public.cost_at('item', s_oil::text, '2026-03-12')).unit_cost, 0.010);
  insert into _t values ('oil @02-15 unpriced', (public.cost_at('item', s_oil::text, '2026-02-15')).unit_cost, 0);

  -- 2. backdated purchase 03-05 €9 entered last → applies 03-05..03-09 only
  insert into cost_purchase_invoices (supplier_id, invoice_date) values (s_sup, '2026-03-05') returning id into inv3;
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, base_qty_per_pack, net_price_per_pack)
    values (inv3, s_oil, 1, 1000, 9);
  insert into _t values ('oil @03-07 after backdated', (public.cost_at('item', s_oil::text, '2026-03-07')).unit_cost, 0.009);
  insert into _t values ('oil @03-12 unchanged', (public.cost_at('item', s_oil::text, '2026-03-12')).unit_cost, 0.010);

  -- 3. excluded outlier 03-11 €50 → ignored
  insert into cost_purchase_invoices (supplier_id, invoice_date) values (s_sup, '2026-03-11') returning id into inv4;
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, base_qty_per_pack, net_price_per_pack, exclude_from_costing)
    values (inv4, s_oil, 1, 1000, 50, true);
  insert into _t values ('oil @03-12 excluded ignored', (public.cost_at('item', s_oil::text, '2026-03-12')).unit_cost, 0.010);

  -- 4/5. standard fallback + unpriced flags
  h := public.cost_at('item', s_tom::text, '2026-03-12');
  insert into _t values ('tomato standard cost', h.unit_cost, 0.002);
  insert into _t values ('tomato flagged estimated', case when (h.flags->>'estimated')::boolean then 1 else 0 end, 1);
  h := public.cost_at('item', s_salt::text, '2026-03-12');
  insert into _t values ('salt flagged unpriced', case when (h.flags->>'unpriced')::boolean then 1 else 0 end, 1);

  -- 6. pomodoro v1 (eff 03-01): 300 g tomato + 100 ml oil → 350 g cooked
  insert into cost_components (name) values ('TEST pomodoro') returning id into c_pom;
  insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, output_weight_g)
    values (c_pom, 1, '2026-03-01', 'output_weight', 350) returning id into v1;
  insert into cost_component_version_lines (version_id, cost_item_id, qty) values (v1, s_tom, 300), (v1, s_oil, 100);
  update cost_component_versions set status = 'published' where id = v1;
  insert into _t values ('pomodoro v1 @03-07', (public.cost_at('component', c_pom::text, '2026-03-07')).unit_cost,
                         round((300*0.002 + 100*0.009)/350.0, 8));
  insert into _t values ('pomodoro v1 @03-12 (oil 10)', (public.cost_at('component', c_pom::text, '2026-03-12')).unit_cost,
                         round((300*0.002 + 100*0.010)/350.0, 8));

  -- 7. pomodoro v2 (eff 03-08): oil 110 ml → history before 03-08 untouched
  insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, output_weight_g)
    values (c_pom, 2, '2026-03-08', 'output_weight', 350) returning id into v2;
  insert into cost_component_version_lines (version_id, cost_item_id, qty) values (v2, s_tom, 300), (v2, s_oil, 110);
  update cost_component_versions set status = 'published' where id = v2;
  insert into _t values ('pomodoro @03-07 still v1', (public.cost_at('component', c_pom::text, '2026-03-07')).unit_cost,
                         round((300*0.002 + 100*0.009)/350.0, 8));
  insert into _t values ('pomodoro @03-09 v2', (public.cost_at('component', c_pom::text, '2026-03-09')).unit_cost,
                         round((300*0.002 + 110*0.009)/350.0, 8));
  insert into _t values ('pomodoro @03-12 v2 + oil 10', (public.cost_at('component', c_pom::text, '2026-03-12')).unit_cost,
                         round((300*0.002 + 110*0.010)/350.0, 8));

  -- published versions are immutable
  begin
    update cost_component_versions set yield_pct = 50, yield_mode = 'pct' where id = v1;
    insert into _t values ('published version immutable', 0, 1);
  exception when others then insert into _t values ('published version immutable', 1, 1);
  end;

  -- 9. chain: sauce = 200 g pomodoro + 2 g salt (unpriced), yield 100 %
  insert into cost_components (name) values ('TEST sauce') returning id into c_sauce;
  insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, yield_pct)
    values (c_sauce, 1, '2026-03-01', 'pct', 100) returning id into vs;
  insert into cost_component_version_lines (version_id, child_component_id, qty) values (vs, c_pom, 200);
  insert into cost_component_version_lines (version_id, cost_item_id, qty) values (vs, s_salt, 2);
  update cost_component_versions set status = 'published' where id = vs;
  insert into _t values ('sauce @03-12 (chain)', (public.cost_at('component', c_sauce::text, '2026-03-12')).unit_cost,
                         round(200 * ((300*0.002 + 110*0.010)/350.0) / 202.0, 8));
  -- a NEW oil purchase must ripple up to the sauce
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, base_qty_per_pack, net_price_per_pack)
    values (inv2, s_oil, 1, 1000, 12);   -- same day 03-10, created later → wins
  insert into _t values ('sauce @03-12 after new oil price', (public.cost_at('component', c_sauce::text, '2026-03-12')).unit_cost,
                         round(200 * ((300*0.002 + 110*0.012)/350.0) / 202.0, 8));

  -- 10. dish variant 117-1: link «Σάλτσα γλυκόξινη» (60 g) to TEST sauce, «Ρύζι basmati» (60 g) to pomodoro
  insert into cost_dish_line_links (dish_id, ingredient_id, component_id) values ('117', ing_sauce, c_sauce);
  insert into cost_dish_line_links (dish_id, ingredient_id, component_id) values ('117', ing_rice, c_pom);
  v_exp := 60 * (200 * ((300*0.002 + 110*0.012)/350.0) / 202.0) + 60 * ((300*0.002 + 110*0.012)/350.0);
  h := public.cost_at('variant', '117-1', '2026-03-12');
  insert into _t values ('variant 117-1 food @03-12', h.food_cost, round(v_exp, 6));
  -- before the pomodoro existed there is no version → its lines cost 0
  h := public.cost_at('variant', '117-1', '2026-02-01');
  insert into _t values ('variant 117-1 food @02-01', h.food_cost, 0);

  -- 11. packaging per dish: 1 bowl, €3.50 per 50 → 0.07
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, base_qty_per_pack, net_price_per_pack, vat_rate)
    values (inv2, s_bowl, 2, 50, 3.50, 0.24);
  insert into cost_dish_packaging (dish_id, cost_item_id, qty_per_portion) values ('117', s_bowl, 1);
  h := public.cost_at('variant', '117-1', '2026-03-12');
  insert into _t values ('variant 117-1 packaging @03-12', h.packaging_cost, 0.07);
  insert into _t values ('variant 117-1 product = food + pack', h.unit_cost, round(v_exp + 0.07, 6));

  -- 12. gram change on the variant (rice 60 → 90 g) → ledger row TODAY, past untouched
  update dish_variant_ingredient_amounts set grams = 90 where variant_id = '117-1' and ingredient_id = ing_rice;
  h := public.cost_at('variant', '117-1', '2026-03-12');
  insert into _t values ('variant past unchanged after gram edit', h.food_cost, round(v_exp, 6));
  h := public.cost_at('variant', '117-1', (now() at time zone 'Europe/Athens')::date);
  insert into _t values ('variant today uses 90 g rice', h.food_cost,
     round(60 * (200 * ((300*0.002 + 110*0.012)/350.0) / 202.0) + 90 * ((300*0.002 + 110*0.012)/350.0), 6));

  -- 13. ledger == pure recompute for every entity touched
  for j in
    select jsonb_build_object('t', entity_type, 'id', entity_id, 'd', effective_from, 'v', unit_cost) from cost_history
    where superseded_at is null and entity_id in (s_oil::text, s_tom::text, c_pom::text, c_sauce::text, '117-1')
  loop
    v_got := (j->>'v')::numeric;
    v_exp := case j->>'t'
      when 'item' then (public.cost_item_cost_at((j->>'id')::uuid, (j->>'d')::date)->>'unit_cost')::numeric
      when 'component' then (public.cost_component_cost_at((j->>'id')::uuid, (j->>'d')::date)->>'cost_per_g')::numeric
      else (public.cost_variant_cost_at(j->>'id', (j->>'d')::date)->>'product_cost')::numeric end;
    insert into _t values ('ledger==recompute ' || (j->>'t') || ' ' || (j->>'d'), v_got, round(v_exp, 8));
  end loop;

  -- report
  select count(*) into n from _t where round(coalesce(got, -1), 6) is distinct from round(expected, 6);
  if n > 0 then
    raise exception 'COSTING TESTS FAILED (% of %): %', n, (select count(*) from _t),
      (select string_agg(name || ' got=' || coalesce(got::text,'null') || ' expected=' || expected, ' | ')
         from _t where round(coalesce(got, -1), 6) is distinct from round(expected, 6));
  end if;
  raise exception 'COSTING TESTS PASSED: % assertions (rolled back)', (select count(*) from _t);
end $$;
