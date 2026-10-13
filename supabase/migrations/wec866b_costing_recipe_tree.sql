-- ============================================================================
-- WEC-866 (dish costing per variant) — follow-up requested by Ioustinos
-- 2026-10-13: «on dishes I need to see the recipe and the cost per
-- ingredient / cost item».
--
-- cost_explode()            one component, at a plated weight, exploded down to
--                           raw cost items (scaled to that weight) — recursive.
-- admin_cost_variant_tree() a dish variant: every dish line exploded, plus a
--                           roll-up per cost item for the whole portion.
-- Pure reads on top of the WEC-859 compute functions; nothing is stored.
-- Σ of all leaves == the variant's food cost (checked on dev).
-- Applied to DEV (jrxxsixhxgawucorfyjt) 2026-10-13; PROD pending.
-- ============================================================================

create or replace function public.cost_explode(p_component uuid, p_grams numeric, p_date date, p_depth int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb; ln jsonb; kids jsonb := '[]'::jsonb; v_scale numeric; v_out numeric; v_name text; v_cpg numeric;
begin
  select name into v_name from cost_components where id = p_component;
  if p_depth > 12 then
    return jsonb_build_object('kind', 'component', 'id', p_component, 'name', v_name, 'grams', p_grams,
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
          'cost', (ln->>'line_cost')::numeric * v_scale);
      else
        kids := kids || public.cost_explode((ln->>'id')::uuid, (ln->>'qty')::numeric * v_scale, p_date, p_depth + 1);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'kind', 'component', 'id', p_component, 'name', v_name, 'grams', p_grams,
    'cost_per_g', v_cpg, 'cost', p_grams * v_cpg,
    'yield_mode', c->>'yield_mode', 'yield_pct', c->'yield_pct', 'output_weight_g', c->'output_weight_g',
    'raw_weight_g', c->'raw_weight_g', 'output_g', c->'output_g',
    'version_no', c->'version_no', 'effective_from', c->'effective_from',
    -- leaf = nothing below it to show: fixed-cost (Excel estimate), no version, zero output
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
                   then public.cost_explode((ln->>'component_id')::uuid, (ln->>'grams')::numeric, v_date) end;
    lines := lines || jsonb_build_object(
      'ingredient_id', ln->'ingredient_id', 'ingredient', ln->'ingredient', 'grams', ln->'grams',
      'link_source', ln->'link_source', 'unlinked', coalesce((ln->>'unlinked')::boolean, false),
      'line_cost', ln->'line_cost', 'tree', v_tree);
  end loop;

  return jsonb_build_object(
    'variant_id', p_variant, 'date', v_date,
    'food_cost', b->'food_cost', 'packaging_cost', b->'packaging_cost', 'product_cost', b->'product_cost',
    'lines', lines,
    -- whole portion per raw cost item (purchased items)
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'qty', qty, 'cost', cost,
                                          'unit_cost', unit_cost, 'source', source, 'price_date', price_date)
                       order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, min(x->>'unit') unit,
               sum((x->>'qty')::numeric) qty, sum((x->>'cost')::numeric) cost,
               max((x->>'unit_cost')::numeric) unit_cost, min(x->>'source') source, max(x->>'price_date') price_date
        from jsonb_path_query(lines, 'strict $[*].tree.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'item'
        group by x->>'id'
      ) s), '[]'::jsonb),
    -- components with nothing below them (fixed Excel estimates, no version…)
    'leaf_components', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grams', grams, 'cost', cost,
                                          'yield_mode', yield_mode, 'flags', flags) order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, sum((x->>'grams')::numeric) grams,
               sum((x->>'cost')::numeric) cost, min(x->>'yield_mode') yield_mode, (array_agg(x->'flags'))[1] flags
        from jsonb_path_query(lines, 'strict $[*].tree.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'component' and (x->>'leaf')::boolean
        group by x->>'id'
      ) s), '[]'::jsonb));
end $$;

revoke execute on function public.cost_explode(uuid, numeric, date, int) from public, anon, authenticated;
revoke execute on function public.admin_cost_variant_tree(text, date) from public, anon;
grant execute on function public.admin_cost_variant_tree(text, date) to authenticated, service_role;
