-- ============================================================================
-- WEC-866 (dish costing) — every purchase-priced cost line carries the invoice
-- it is priced from (invoice_id), so the «purchase dd/mm» pill links to it.
-- 🟢 Ioustinos (11/11): «the purchase pill in the drawer to be a link to the purchase».
-- Values unchanged. Applied to DEV 2026-11-11.
-- ============================================================================
create or replace function public.cost_item_cost_at(p_item uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; v_std numeric;
begin
  select l.id, l.unit_cost, i.invoice_date, i.id as invoice_id into r
  from cost_purchase_lines l
  join cost_purchase_invoices i on i.id = l.invoice_id
  where l.cost_item_id = p_item and not l.exclude_from_costing and i.invoice_date <= p_date
  order by i.invoice_date desc, l.created_at desc, l.id desc
  limit 1;
  if found then
    return jsonb_build_object('unit_cost', r.unit_cost, 'source', 'purchase',
                              'price_date', r.invoice_date, 'purchase_line_id', r.id, 'invoice_id', r.invoice_id);
  end if;
  select standard_cost_per_unit into v_std from cost_items where id = p_item;
  if v_std is not null then
    return jsonb_build_object('unit_cost', v_std, 'source', 'standard');
  end if;
  return jsonb_build_object('unit_cost', 0, 'source', 'unpriced');
end $$;

create or replace function public.cost_component_cost_at(p_component uuid, p_date date, p_depth integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v record; ln record; c jsonb;
  v_total numeric := 0; v_raw_g numeric := 0; v_raw_pcs numeric := 0; v_out_g numeric;
  v_lines jsonb := '[]'::jsonb; v_est boolean := false; v_unp int := 0; v_now boolean := false;
  v_line_cost numeric; v_unit numeric;
begin
  if p_depth > 12 then
    return jsonb_build_object('cost_per_g', 0, 'flags', jsonb_build_object('cycle', true), 'lines', '[]'::jsonb);
  end if;
  select cv.*, cc.name as component_name, cc.base_unit as comp_unit, cc.grams_per_unit as comp_gpu into v
  from cost_component_versions cv join cost_components cc on cc.id = cv.component_id
  where cv.id = public.cost_component_version_at(p_component, p_date);
  if not found then
    return jsonb_build_object('cost_per_g', 0, 'flags', jsonb_build_object('no_version', true), 'lines', '[]'::jsonb,
      'unit', (select base_unit from cost_components where id = p_component),
      'grams_per_unit', (select grams_per_unit from cost_components where id = p_component));
  end if;
  if v.yield_mode = 'fixed' then
    return jsonb_build_object(
      'cost_per_g', v.fixed_cost_per_g, 'unit', v.comp_unit, 'grams_per_unit', v.comp_gpu,
      'version_id', v.id, 'version_no', v.version_no,
      'effective_from', v.effective_from, 'yield_mode', 'fixed',
      'flags', jsonb_build_object('estimated', true), 'lines', '[]'::jsonb);
  end if;
  for ln in
    select l.*, i.name as item_name, i.base_unit, i.grams_per_unit,
           cc.name as child_name, cc.base_unit as child_unit, cc.grams_per_unit as child_gpu
    from cost_component_version_lines l
    left join cost_items i on i.id = l.cost_item_id
    left join cost_components cc on cc.id = l.child_component_id
    where l.version_id = v.id
    order by l.sort_order, l.id
  loop
    if ln.cost_item_id is not null then
      c := public.cost_item_cost_at(ln.cost_item_id, p_date);
      v_unit := (c->>'unit_cost')::numeric;
      v_line_cost := ln.qty * v_unit;
      if c->>'source' = 'standard' then v_est := true; end if;
      if c->>'source' = 'unpriced' then v_unp := v_unp + 1; end if;
      if ln.base_unit = 'pcs' then v_raw_pcs := v_raw_pcs + ln.qty; end if;
      if ln.base_unit = 'g' then v_raw_g := v_raw_g + ln.qty;
      elsif ln.grams_per_unit is not null then v_raw_g := v_raw_g + ln.qty * ln.grams_per_unit;
      elsif ln.base_unit = 'ml' then v_raw_g := v_raw_g + ln.qty;
      else v_now := true;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'kind', 'item', 'id', ln.cost_item_id, 'name', ln.item_name, 'qty', ln.qty, 'unit', ln.base_unit,
        'unit_cost', v_unit, 'source', c->>'source', 'price_date', c->>'price_date', 'invoice_id', c->>'invoice_id',
        'line_cost', v_line_cost);
    else
      c := public.cost_component_cost_at(ln.child_component_id, p_date, p_depth + 1);
      v_unit := (c->>'cost_per_g')::numeric;
      v_line_cost := ln.qty * v_unit;
      if coalesce((c->'flags'->>'estimated')::boolean, false) then v_est := true; end if;
      v_unp := v_unp + coalesce((c->'flags'->>'unpriced')::int, 0)
                     + case when coalesce((c->'flags'->>'no_version')::boolean, false) then 1 else 0 end;
      if ln.child_unit = 'pcs' then
        v_raw_pcs := v_raw_pcs + ln.qty;
        if ln.child_gpu is not null then v_raw_g := v_raw_g + ln.qty * ln.child_gpu; else v_now := true; end if;
      else
        v_raw_g := v_raw_g + ln.qty;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'kind', 'component', 'id', ln.child_component_id, 'name', ln.child_name, 'qty', ln.qty,
        'unit', coalesce(ln.child_unit, 'g'), 'unit_cost', v_unit, 'line_cost', v_line_cost, 'flags', c->'flags');
    end if;
    v_total := v_total + v_line_cost;
  end loop;
  v_out_g := case
    when v.yield_mode = 'pct' and v.comp_unit = 'pcs' then v_raw_pcs * v.yield_pct / 100
    when v.yield_mode = 'pct' then v_raw_g * v.yield_pct / 100
    else v.output_weight_g end;
  return jsonb_build_object(
    'cost_per_g', case when coalesce(v_out_g, 0) > 0 then v_total / v_out_g else 0 end,
    'unit', v.comp_unit, 'grams_per_unit', v.comp_gpu,
    'total_cost', v_total, 'raw_weight_g', v_raw_g, 'raw_pieces', v_raw_pcs, 'output_g', v_out_g,
    'version_id', v.id, 'version_no', v.version_no, 'effective_from', v.effective_from,
    'yield_mode', v.yield_mode, 'yield_pct', v.yield_pct, 'output_weight_g', v.output_weight_g,
    'flags', jsonb_strip_nulls(jsonb_build_object(
        'estimated', case when v_est then true end,
        'unpriced',  case when v_unp > 0 then v_unp end,
        'no_weight', case when v_now and v.yield_mode = 'pct' and v.comp_unit <> 'pcs' then true end,
        'zero_output', case when coalesce(v_out_g,0) <= 0 then true end)),
    'lines', v_lines);
end $$;

create or replace function public.cost_explode(p_component uuid, p_grams numeric, p_date date, p_depth integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb; ln jsonb; kids jsonb := '[]'::jsonb; v_scale numeric; v_out numeric; v_name text; v_cpg numeric; v_u text;
begin
  select name, base_unit into v_name, v_u from cost_components where id = p_component;
  if p_depth > 12 then
    return jsonb_build_object('kind', 'component', 'id', p_component, 'name', v_name, 'grams', p_grams,
                              'qty', p_grams, 'unit', v_u,
                              'cost', 0, 'leaf', true, 'flags', jsonb_build_object('cycle', true), 'children', '[]'::jsonb);
  end if;
  c := public.cost_component_cost_at(p_component, p_date);
  v_cpg := coalesce((c->>'cost_per_g')::numeric, 0);
  v_out := (c->>'output_g')::numeric;
  v_scale := case when coalesce(v_out, 0) > 0 then p_grams / v_out end;
  if v_scale is not null and coalesce(c->>'yield_mode', '') <> 'fixed' then
    for ln in select * from jsonb_array_elements(coalesce(c->'lines', '[]'::jsonb)) loop
      if ln->>'kind' = 'item' then
        kids := kids || jsonb_build_object(
          'kind', 'item', 'id', ln->>'id', 'name', ln->>'name', 'unit', ln->>'unit',
          'qty', (ln->>'qty')::numeric * v_scale,
          'unit_cost', (ln->>'unit_cost')::numeric, 'source', ln->>'source', 'price_date', ln->>'price_date',
          'invoice_id', ln->>'invoice_id',
          'cost', (ln->>'line_cost')::numeric * v_scale);
      else
        kids := kids || public.cost_explode((ln->>'id')::uuid, (ln->>'qty')::numeric * v_scale, p_date, p_depth + 1);
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'kind', 'component', 'id', p_component, 'name', v_name, 'grams', p_grams, 'qty', p_grams, 'unit', v_u,
    'cost_per_g', v_cpg, 'cost', p_grams * v_cpg,
    'yield_mode', c->>'yield_mode', 'yield_pct', c->'yield_pct', 'output_weight_g', c->'output_weight_g',
    'raw_weight_g', c->'raw_weight_g', 'output_g', c->'output_g',
    'version_no', c->'version_no', 'effective_from', c->'effective_from',
    'leaf', jsonb_array_length(kids) = 0,
    'flags', coalesce(c->'flags', '{}'::jsonb),
    'children', kids);
end $$;

create or replace function public.admin_cost_variant_tree(p_variant text, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, public.cost_today());
  b jsonb; ln jsonb; lines jsonb := '[]'::jsonb; v_tree jsonb;
begin
  perform public.cost_assert_admin();
  b := public.cost_variant_cost_at(p_variant, v_date);
  if b is null then return null; end if;
  for ln in select * from jsonb_array_elements(coalesce(b->'lines', '[]'::jsonb)) loop
    v_tree := case when ln->>'component_id' is not null
                   then public.cost_explode((ln->>'component_id')::uuid,
                                            coalesce((ln->>'qty')::numeric, 0), v_date) end;
    lines := lines || jsonb_build_object(
      'ingredient_id', ln->'ingredient_id', 'ingredient', ln->'ingredient', 'grams', ln->'grams',
      'qty', ln->'qty', 'unit', ln->'unit',
      'link_source', ln->'link_source', 'unlinked', coalesce((ln->>'unlinked')::boolean, false),
      'line_cost', ln->'line_cost', 'flags', ln->'flags', 'tree', v_tree);
  end loop;
  return jsonb_build_object(
    'variant_id', p_variant, 'date', v_date,
    'food_cost', b->'food_cost', 'packaging_cost', b->'packaging_cost', 'product_cost', b->'product_cost',
    'lines', lines,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'qty', qty, 'cost', cost,
                                          'unit_cost', unit_cost, 'source', source, 'price_date', price_date, 'invoice_id', invoice_id)
                       order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, min(x->>'unit') unit,
               sum((x->>'qty')::numeric) qty, sum((x->>'cost')::numeric) cost,
               max((x->>'unit_cost')::numeric) unit_cost, min(x->>'source') source, max(x->>'price_date') price_date,
               (array_agg(x->>'invoice_id' order by x->>'price_date' desc nulls last))[1] invoice_id
        from jsonb_path_query(lines, 'strict $[*].tree.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'item'
        group by x->>'id'
      ) s), '[]'::jsonb),
    'leaf_components', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grams', grams, 'unit', unit, 'cost', cost,
                                          'yield_mode', yield_mode, 'flags', flags) order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, sum((x->>'qty')::numeric) grams, min(x->>'unit') unit,
               sum((x->>'cost')::numeric) cost, min(x->>'yield_mode') yield_mode, (array_agg(x->'flags'))[1] flags
        from jsonb_path_query(lines, 'strict $[*].tree.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'component' and (x->>'leaf')::boolean
        group by x->>'id'
      ) s), '[]'::jsonb));
end $$;

create or replace function public.cost_variant_cost_at(p_variant text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_dish text; v_price int;
  ln record; c jsonb; pk record;
  v_food numeric := 0; v_pack numeric := 0;
  v_lines jsonb := '[]'::jsonb; v_packs jsonb := '[]'::jsonb;
  v_unlinked int := 0; v_unp int := 0; v_est boolean := false;
  v_cost numeric; v_cpg numeric; v_qty numeric; v_flags jsonb;
begin
  select dish_id, price into v_dish, v_price from dish_variants where id = p_variant;
  if v_dish is null then return null; end if;
  for ln in
    select g.ingredient_id, g.grams, ing.name_el, lc.component_id, lc.link_source, cc.name as component_name,
           cc.base_unit as comp_unit, cc.grams_per_unit as comp_gpu
    from (
      select distinct on (h.ingredient_id) h.ingredient_id, h.grams
      from cost_dish_gram_history h
      where h.variant_id = p_variant and h.effective_from <= p_date
      order by h.ingredient_id, h.effective_from desc, h.id desc
    ) g
    join ingredients ing on ing.id = g.ingredient_id
    left join lateral public.cost_line_component(v_dish, g.ingredient_id) lc on true
    left join cost_components cc on cc.id = lc.component_id
    where g.grams > 0
    order by g.grams desc
  loop
    if ln.component_id is null then
      v_unlinked := v_unlinked + 1;
      v_lines := v_lines || jsonb_build_object('ingredient_id', ln.ingredient_id, 'ingredient', ln.name_el,
                   'grams', ln.grams, 'component_id', null, 'line_cost', 0, 'unlinked', true);
      continue;
    end if;
    c := public.cost_component_cost_at(ln.component_id, p_date);
    v_cpg := (c->>'cost_per_g')::numeric;
    v_flags := coalesce(c->'flags', '{}'::jsonb);
    if ln.comp_unit = 'pcs' then
      v_qty := case when ln.comp_gpu > 0 then ln.grams / ln.comp_gpu end;
      if v_qty is null then v_flags := v_flags || jsonb_build_object('no_piece_weight', true); end if;
    else
      v_qty := ln.grams;
    end if;
    v_cost := coalesce(v_qty, 0) * v_cpg;
    v_food := v_food + v_cost;
    if coalesce((v_flags->>'estimated')::boolean, false) then v_est := true; end if;
    v_unp := v_unp + coalesce((v_flags->>'unpriced')::int, 0)
                   + case when coalesce((v_flags->>'no_version')::boolean, false) then 1 else 0 end
                   + case when coalesce((v_flags->>'no_piece_weight')::boolean, false) then 1 else 0 end;
    v_lines := v_lines || jsonb_build_object('ingredient_id', ln.ingredient_id, 'ingredient', ln.name_el,
                 'grams', ln.grams, 'qty', v_qty, 'unit', coalesce(ln.comp_unit, 'g'),
                 'component_id', ln.component_id, 'component', ln.component_name,
                 'link_source', ln.link_source, 'cost_per_g', v_cpg, 'line_cost', v_cost, 'flags', v_flags);
  end loop;
  for pk in
    select p.cost_item_id, p.qty_per_portion, i.name
    from cost_dish_packaging p join cost_items i on i.id = p.cost_item_id
    where p.dish_id = v_dish order by i.name
  loop
    c := public.cost_item_cost_at(pk.cost_item_id, p_date);
    v_cost := pk.qty_per_portion * (c->>'unit_cost')::numeric;
    v_pack := v_pack + v_cost;
    if c->>'source' = 'standard' then v_est := true; end if;
    if c->>'source' = 'unpriced' then v_unp := v_unp + 1; end if;
    v_packs := v_packs || jsonb_build_object('cost_item_id', pk.cost_item_id, 'name', pk.name,
                 'qty', pk.qty_per_portion, 'unit_cost', c->'unit_cost', 'source', c->>'source',
                 'price_date', c->>'price_date', 'invoice_id', c->>'invoice_id', 'line_cost', v_cost);
  end loop;
  return jsonb_build_object(
    'variant_id', p_variant, 'dish_id', v_dish, 'date', p_date,
    'price', round(v_price / 100.0, 2),
    'food_cost', v_food, 'packaging_cost', v_pack, 'product_cost', v_food + v_pack,
    'flags', jsonb_strip_nulls(jsonb_build_object(
        'unlinked', case when v_unlinked > 0 then v_unlinked end,
        'unpriced', case when v_unp > 0 then v_unp end,
        'estimated', case when v_est then true end,
        'no_packaging', case when jsonb_array_length(v_packs) = 0 then true end)),
    'lines', v_lines, 'packaging', v_packs);
end $$;
