-- ============================================================================
-- WEC-866 (dish costing) — packaging lines carry the purchase date they are
-- priced from, so the dish drawer can show it in the «Reference» column like
-- food cost items. Values unchanged. Applied to DEV 2026-11-10.
-- ============================================================================
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
                 'price_date', c->>'price_date', 'line_cost', v_cost);
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
