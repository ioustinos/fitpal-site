-- ============================================================================
-- WEC-864 (components & recipes) — list: component type + cooking method.
-- 🟢 Ioustinos (10/11): the «Excel · απλό / Excel · σύνθετο» category naming is
-- wrong; απλό / σύνθετο should exist as the TYPE (single vs multi ingredient).
-- «on the table of components i would like to see the type of cooking».
--
-- * type is derived, never stored: 'single' = the version in force has exactly
--   one cost-item line; 'multi' = anything else (recipe or fixed estimate).
-- * the seed's «Excel · …» categories are cleared so category is free for real use.
-- Applied to DEV 2026-11-10.
-- ============================================================================
update public.cost_components set category = null
where category in ('Excel · απλό', 'Excel · σύνθετο');

create or replace function public.admin_cost_components_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.cost_today();
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'category', c.category, 'active', c.active, 'source_ref', c.source_ref,
      'cooking_method', c.cooking_method, 'cooking_method_other', c.cooking_method_other,
      'type', case when h.breakdown->>'yield_mode' <> 'fixed'
                    and jsonb_array_length(coalesce(h.breakdown->'lines', '[]'::jsonb)) = 1
                    and h.breakdown->'lines'->0->>'kind' = 'item' then 'single' else 'multi' end,
      'lines', jsonb_array_length(coalesce(h.breakdown->'lines', '[]'::jsonb)),
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
