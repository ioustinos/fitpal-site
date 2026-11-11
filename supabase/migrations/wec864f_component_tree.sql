-- ============================================================================
-- WEC-864 (components & recipes) — component drawer shows the same expandable
-- recipe tree as the dish drawer, down to the purchased cost items.
-- 🟢 Ioustinos (11/11): «I should be able to see the analysis of the raw
-- ingredients as if I check the dish. The detailed tree of the dish is the
-- perfect UI».
--
-- admin_cost_component_tree(component, date, qty)
--   qty = how much of the component to explode, in its own unit
--         (null → one whole batch = its output; the UI also asks for 1000 g / 1 pc)
-- Returns { root: cost_explode(...), items: Σ per cost item, leaf_components }.
-- Overview also gains yield_ratio (cooked ÷ raw of the version in force) for the
-- editor's linked raw ↔ cooked inputs.
-- Applied to DEV 2026-11-11.
-- ============================================================================
create or replace function public.admin_cost_component_tree(p_id uuid, p_date date default null, p_qty numeric default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, public.cost_today());
  b jsonb; v_qty numeric; v_root jsonb;
begin
  perform public.cost_assert_admin();
  b := public.cost_component_cost_at(p_id, v_date);
  v_qty := coalesce(p_qty, nullif((b->>'output_g')::numeric, 0), case when b->>'unit' = 'pcs' then 1 else 1000 end);
  v_root := public.cost_explode(p_id, v_qty, v_date);
  return jsonb_build_object(
    'component_id', p_id, 'date', v_date, 'qty', v_qty, 'unit', coalesce(b->>'unit', 'g'),
    'batch_output', b->'output_g', 'cost', v_root->'cost', 'root', v_root,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'qty', qty, 'cost', cost,
                                          'unit_cost', unit_cost, 'source', source, 'price_date', price_date,
                                          'invoice_id', invoice_id) order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, min(x->>'unit') unit,
               sum((x->>'qty')::numeric) qty, sum((x->>'cost')::numeric) cost,
               max((x->>'unit_cost')::numeric) unit_cost, min(x->>'source') source, max(x->>'price_date') price_date,
               (array_agg(x->>'invoice_id' order by x->>'price_date' desc nulls last))[1] invoice_id
        from jsonb_path_query(v_root->'children', 'strict $.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'item'
        group by x->>'id'
      ) s), '[]'::jsonb),
    'leaf_components', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grams', grams, 'unit', unit, 'cost', cost,
                                          'yield_mode', yield_mode, 'flags', flags) order by cost desc)
      from (
        select x->>'id' id, min(x->>'name') name, sum((x->>'qty')::numeric) grams, min(x->>'unit') unit,
               sum((x->>'cost')::numeric) cost, min(x->>'yield_mode') yield_mode, (array_agg(x->'flags'))[1] flags
        from jsonb_path_query(v_root->'children', 'strict $.**') x
        where jsonb_typeof(x) = 'object' and x->>'kind' = 'component' and (x->>'leaf')::boolean
        group by x->>'id'
      ) s), '[]'::jsonb));
end $$;
grant execute on function public.admin_cost_component_tree(uuid, date, numeric) to authenticated;

create or replace function public.admin_cost_components_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.cost_today();
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'category', c.category, 'active', c.active, 'source_ref', c.source_ref,
      'cooking_method', c.cooking_method, 'cooking_method_other', c.cooking_method_other,
      'base_unit', c.base_unit, 'grams_per_unit', c.grams_per_unit,
      'type', case when h.breakdown->>'yield_mode' <> 'fixed'
                    and jsonb_array_length(coalesce(h.breakdown->'lines', '[]'::jsonb)) = 1
                    and h.breakdown->'lines'->0->>'kind' = 'item' then 'single' else 'multi' end,
      'lines', jsonb_array_length(coalesce(h.breakdown->'lines', '[]'::jsonb)),
      'yield_ratio', case when coalesce((h.breakdown->>'raw_weight_g')::numeric, 0) > 0
                          then (h.breakdown->>'output_g')::numeric / (h.breakdown->>'raw_weight_g')::numeric end,
      'cost_per_g', h.unit_cost, 'flags', h.flags,
      'cost_per_g_30d', (public.cost_at('component', c.id::text, v_today - 30)).unit_cost,
      'yield_mode', h.breakdown->>'yield_mode', 'yield_pct', h.breakdown->'yield_pct',
      'output_weight_g', h.breakdown->'output_weight_g', 'version_no', h.breakdown->'version_no',
      'versions', (select count(*) from cost_component_versions v where v.component_id = c.id),
      'drafts', (select count(*) from cost_component_versions v where v.component_id = c.id and v.status = 'draft'),
      'used_in_dishes', (select count(distinct dish_id) from cost_dish_line_links k where k.component_id = c.id),
      'used_in_components', (select count(distinct v.component_id) from cost_component_version_lines l
                             join cost_component_versions v on v.id = l.version_id where l.child_component_id = c.id)
    ) order by c.name)
    from cost_components c
    left join lateral (select * from public.cost_at('component', c.id::text, v_today)) h on true), '[]'::jsonb);
end $$;
