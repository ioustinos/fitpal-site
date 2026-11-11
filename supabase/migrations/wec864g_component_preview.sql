-- ============================================================================
-- WEC-864 (components & recipes) — live preview for the in-drawer editor.
-- 🟢 Ioustinos (11/11): «creating new and editing a component should be the same
-- UI as viewing it … the tree should live in components as well».
--
-- admin_cost_component_preview(p jsonb) costs an UNSAVED recipe exactly like the
-- engine would and returns the same node shape as cost_explode, so the editor can
-- render the expandable tree while you type. Nothing is written.
--   p = { date, base_unit, grams_per_unit, yield_mode, yield_pct, output_weight_g,
--         fixed_cost_per_g, lines: [{ idx, cost_item_id | child_component_id, qty }] }
-- Each child node carries «idx» so the UI can attach it to its editable line.
-- Applied to DEV 2026-11-11.
-- ============================================================================
create or replace function public.admin_cost_component_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(nullif(p->>'date', '')::date, public.cost_today());
  v_unit text := coalesce(nullif(p->>'base_unit', ''), 'g');
  v_mode text := coalesce(nullif(p->>'yield_mode', ''), 'pct');
  ln jsonb; c jsonb; node jsonb; kids jsonb := '[]'::jsonb;
  v_total numeric := 0; v_raw_g numeric := 0; v_raw_pcs numeric := 0; v_out numeric; v_qty numeric;
  i record; cc record; v_cpu numeric;
begin
  perform public.cost_assert_admin();
  if v_mode = 'fixed' then
    v_cpu := coalesce((p->>'fixed_cost_per_g')::numeric, 0);
    return jsonb_build_object('kind', 'component', 'name', null, 'unit', v_unit, 'yield_mode', 'fixed',
      'cost_per_g', v_cpu, 'cost', null, 'children', '[]'::jsonb, 'flags', jsonb_build_object('estimated', true));
  end if;
  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 0);
    if nullif(ln->>'cost_item_id', '') is not null then
      select id, name, base_unit, grams_per_unit into i from cost_items where id = (ln->>'cost_item_id')::uuid;
      if not found then continue; end if;
      c := public.cost_item_cost_at(i.id, v_date);
      node := jsonb_build_object('kind', 'item', 'idx', ln->'idx', 'id', i.id, 'name', i.name, 'unit', i.base_unit,
        'qty', v_qty, 'unit_cost', (c->>'unit_cost')::numeric, 'source', c->>'source', 'price_date', c->>'price_date',
        'invoice_id', c->>'invoice_id', 'cost', v_qty * (c->>'unit_cost')::numeric);
      if i.base_unit = 'pcs' then v_raw_pcs := v_raw_pcs + v_qty; end if;
      v_raw_g := v_raw_g + case when i.base_unit in ('g', 'ml') then v_qty
                                when i.grams_per_unit is not null then v_qty * i.grams_per_unit else 0 end;
    elsif nullif(ln->>'child_component_id', '') is not null then
      select id, base_unit, grams_per_unit into cc from cost_components where id = (ln->>'child_component_id')::uuid;
      if not found then continue; end if;
      node := public.cost_explode(cc.id, v_qty, v_date) || jsonb_build_object('idx', ln->'idx');
      if cc.base_unit = 'pcs' then
        v_raw_pcs := v_raw_pcs + v_qty;
        v_raw_g := v_raw_g + coalesce(v_qty * cc.grams_per_unit, 0);
      else
        v_raw_g := v_raw_g + v_qty;
      end if;
    else
      continue;
    end if;
    v_total := v_total + coalesce((node->>'cost')::numeric, 0);
    kids := kids || node;
  end loop;
  v_out := case
    when v_mode = 'pct' and v_unit = 'pcs' then v_raw_pcs * coalesce((p->>'yield_pct')::numeric, 0) / 100
    when v_mode = 'pct' then v_raw_g * coalesce((p->>'yield_pct')::numeric, 0) / 100
    else (p->>'output_weight_g')::numeric end;
  return jsonb_build_object(
    'kind', 'component', 'unit', v_unit, 'yield_mode', v_mode, 'yield_pct', p->'yield_pct',
    'output_weight_g', p->'output_weight_g', 'raw_weight_g', v_raw_g, 'raw_pieces', v_raw_pcs, 'output_g', v_out,
    'cost', v_total, 'cost_per_g', case when coalesce(v_out, 0) > 0 then v_total / v_out end,
    'grams', v_out, 'qty', v_out, 'children', kids, 'flags', '{}'::jsonb);
end $$;
grant execute on function public.admin_cost_component_preview(jsonb) to authenticated;
