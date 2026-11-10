-- ============================================================================
-- WEC-864 (components & recipes) — the import itself. DEV first (2026-11-10).
--
--   select costing_seed.import_groups(date '2026-10-12', date '2026-11-10');
--   select public.cost_rebuild_all();
--
-- 🟢 Ioustinos (10/11): «add the prices (previous and current) as purchases so
-- that the date thing applies … create one general supplier per category».
-- So every price we hold becomes a dated purchase line:
--   p_prev : the Excel prices the seed used (cost_items.standard_cost_per_unit),
--            every priced item, food + packaging — one invoice per category supplier.
--   p_cur  : the live «New Index Υλικών» prices of the Groups sheet, every item
--            it prices (food only) — one invoice per category supplier.
-- Lines are «1 × 1000 base units» so unit_cost = price exactly.
--
-- Composite recipes become a new published version effective p_prev with the
-- sheet's lines (child component, COOKED grams) and output_weight = the tab's
-- cooked total — the sheet's own formula is Σ cooked g × cost/100 g cooked,
-- reproduced for 232/232 tabs. v1 (fixed) stays as history.
-- Simple components whose cooked yield changed in the sheet get a new version
-- effective p_cur (same raw line, new yield).
--
-- Idempotent: invoices keyed by (supplier, invoice_number), lines by
-- (invoice, item), versions by the 'groups-import' marker in notes.
-- No row removal anywhere (the MCP refuses it inside function bodies).
-- ============================================================================
create or replace function costing_seed.import_groups(p_prev date, p_cur date)
returns jsonb language plpgsql as $$
declare
  r record; v_comp uuid; v_ver uuid; v_no int; v_i int; ln jsonb; v_child uuid;
  n_sup int := 0; n_inv int := 0; n_prev int := 0; n_cur int := 0; n_rec int := 0; n_lines int := 0; n_yield int := 0;
  v_missing text[] := '{}';
begin
  perform set_config('costing.skip_triggers', 'on', true);

  -- 1. one general supplier per category
  insert into cost_suppliers (name, notes)
  select distinct 'Γενικός προμηθευτής · ' || coalesce(category, '—'),
         'Συγκεντρωτικός προμηθευτής κατηγορίας — τιμές από τα Excel / Google Sheets της κουζίνας (εισαγωγή 10/11/2026)'
  from cost_items
  on conflict do nothing;
  get diagnostics n_sup = row_count;

  -- 2. invoices (prev for every category, cur for food categories)
  insert into cost_purchase_invoices (supplier_id, invoice_date, invoice_number, notes, created_by)
  select s.id, d.dt, 'ΤΙΜΕΣ-' || to_char(d.dt, 'YYYY-MM-DD'), d.note, null
  from (select distinct coalesce(category, '—') cat, kind from cost_items) c
  join cost_suppliers s on s.name = 'Γενικός προμηθευτής · ' || c.cat
  cross join lateral (values
      (p_prev, 'Τιμές Excel κουζίνας όπως φορτώθηκαν στη σπορά (WEC-860)'),
      (p_cur,  'Τρέχουσες τιμές από το Google Sheet «Groups» → New Index Υλικών')) d(dt, note)
  where (d.dt = p_prev or c.kind = 'food')
    and not exists (select 1 from cost_purchase_invoices i
                    where i.supplier_id = s.id and i.invoice_number = 'ΤΙΜΕΣ-' || to_char(d.dt, 'YYYY-MM-DD'))
  group by s.id, d.dt, d.note;
  get diagnostics n_inv = row_count;

  -- 3. previous prices: every item with a standard cost
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, pack_label, base_qty_per_pack,
                                   net_price_per_pack, vat_rate, note)
  select inv.id, ci.id, 1,
         case ci.base_unit when 'g' then 'κιλό' when 'ml' then 'λίτρο' else '1000 τεμ.' end,
         1000, round(ci.standard_cost_per_unit * 1000, 4), ci.default_vat_rate, 'groups-import prev'
  from cost_items ci
  join cost_suppliers s on s.name = 'Γενικός προμηθευτής · ' || coalesce(ci.category, '—')
  join cost_purchase_invoices inv on inv.supplier_id = s.id and inv.invoice_number = 'ΤΙΜΕΣ-' || to_char(p_prev, 'YYYY-MM-DD')
  where ci.standard_cost_per_unit is not null
    and not exists (select 1 from cost_purchase_lines l where l.invoice_id = inv.id and l.cost_item_id = ci.id);
  get diagnostics n_prev = row_count;

  -- 4. current prices: sheet price per simple component → its raw cost item
  insert into cost_purchase_lines (invoice_id, cost_item_id, qty_packs, pack_label, base_qty_per_pack,
                                   net_price_per_pack, vat_rate, note)
  select distinct on (ci.id) inv.id, ci.id, 1,
         case ci.base_unit when 'g' then 'κιλό' when 'ml' then 'λίτρο' else '1000 τεμ.' end,
         1000, round(pl.cost100_raw * 10, 4), ci.default_vat_rate, 'groups-import cur'
  from costing_seed.price_list pl
  join cost_components c on c.name = pl.component and c.source_ref like 'excel:Index:%'
  join cost_component_versions v on v.id = public.cost_component_version_at(c.id, p_cur)
  join cost_component_version_lines l on l.version_id = v.id and l.cost_item_id is not null
  join cost_items ci on ci.id = l.cost_item_id
  join cost_suppliers s on s.name = 'Γενικός προμηθευτής · ' || coalesce(ci.category, '—')
  join cost_purchase_invoices inv on inv.supplier_id = s.id and inv.invoice_number = 'ΤΙΜΕΣ-' || to_char(p_cur, 'YYYY-MM-DD')
  where not exists (select 1 from cost_purchase_lines x where x.invoice_id = inv.id and x.cost_item_id = ci.id)
  order by ci.id, pl.component;
  get diagnostics n_cur = row_count;

  -- 5. simple components whose yield changed in the sheet → new version at p_cur
  for r in
    select c.id comp, v.id ver, v.yield_pct old_y, pl.cooked_g new_y
    from costing_seed.price_list pl
    join cost_components c on c.name = pl.component and c.source_ref like 'excel:Index:%'
    join cost_component_versions v on v.id = public.cost_component_version_at(c.id, p_cur)
    where v.yield_mode = 'pct' and pl.cooked_g is not null and pl.cooked_g > 0
      and abs(pl.cooked_g - v.yield_pct) > 0.01
      and not exists (select 1 from cost_component_versions x where x.component_id = c.id and x.notes like '%groups-import%')
  loop
    select coalesce(max(version_no), 0) + 1 into v_no from cost_component_versions where component_id = r.comp;
    insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, yield_pct, notes, created_by)
    values (r.comp, v_no, p_cur, 'pct', r.new_y,
            format('Απόδοση %s%% → %s%% (Google Sheet «Groups», New Index) — groups-import', r.old_y, r.new_y), null)
    returning id into v_ver;
    insert into cost_component_version_lines (version_id, cost_item_id, child_component_id, qty, sort_order, note)
    select v_ver, cost_item_id, child_component_id, qty, sort_order, note
    from cost_component_version_lines where version_id = r.ver;
    update cost_component_versions set status = 'published', published_at = now() where id = v_ver;
    n_yield := n_yield + 1;
  end loop;

  -- 6. composite recipes
  for r in
    select g.*, c.id comp from costing_seed.grp_recipes g
    join cost_components c on c.name = g.component and c.source_ref like 'excel:Group:%'
    where not exists (select 1 from cost_component_versions x where x.component_id = c.id and x.notes like '%groups-import%')
  loop
    select coalesce(max(version_no), 0) + 1 into v_no from cost_component_versions where component_id = r.comp;
    insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, output_weight_g, notes, created_by)
    values (r.comp, v_no, p_prev, 'output_weight', r.output_g,
            'Συνταγή από το Google Sheet «Groups» (τελ. αλλαγή 30/10/2026) — αντικαθιστά το σταθερό κόστος — groups-import', null)
    returning id into v_ver;
    v_i := 0;
    for ln in select * from jsonb_array_elements(r.lines) loop
      v_i := v_i + 1;
      select id into v_child from cost_components where name = ln->>0;
      if v_child is null then
        v_missing := v_missing || (r.component || ' → ' || (ln->>0));
        continue;
      end if;
      insert into cost_component_version_lines (version_id, child_component_id, qty, sort_order)
      values (v_ver, v_child, (ln->>1)::numeric, v_i);
      n_lines := n_lines + 1;
    end loop;
    update cost_component_versions set status = 'published', published_at = now() where id = v_ver;
    n_rec := n_rec + 1;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'unresolved recipe lines (nothing committed): %', v_missing;
  end if;

  perform set_config('costing.skip_triggers', 'off', true);
  return jsonb_build_object('suppliers', n_sup, 'invoices', n_inv, 'prev_lines', n_prev, 'cur_lines', n_cur,
                            'yield_versions', n_yield, 'recipes', n_rec, 'recipe_lines', n_lines);
end $$;

-- Cycle check after import (must return 0 rows):
--   select c.name from cost_components c
--   where exists (select 1 from public.cost_component_closure(c.id) x where x.component_id = c.id);
