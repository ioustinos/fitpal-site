-- ============================================================================
-- WEC-866 (dish costing) — selling-price history of a variant, for the dish
-- drawer's «Food cost %» chart.
-- 🟢 Ioustinos (11/11): «a food cost percentage view for this graph (where a dish
-- price change is also an event) — only the dishes graph».
--
-- Source: public.audit_log (dish_variants INSERT / UPDATE rows where the price
-- changed). Prices are stored in cents; returned in euros like the cost ledger.
-- If the log has nothing for the variant, the current price is returned from 1900.
-- Applied to DEV 2026-11-11.
-- ============================================================================
create or replace function public.admin_cost_variant_price_history(p_variant text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.cost_assert_admin();
  select jsonb_agg(jsonb_build_object('date', d, 'price', p) order by d) into v
  from (
    select distinct on (changed_at::date) changed_at::date d, (new_row->>'price')::numeric / 100 p
    from audit_log
    where table_name = 'dish_variants' and row_pk = p_variant and new_row ? 'price'
      and (op = 'INSERT' or (op = 'UPDATE' and old_row->'price' is distinct from new_row->'price'))
    order by changed_at::date, changed_at desc
  ) s;
  if v is null then
    select jsonb_build_array(jsonb_build_object('date', '1900-01-01', 'price', price::numeric / 100)) into v
    from dish_variants where id = p_variant;
  end if;
  return coalesce(v, '[]'::jsonb);
end $$;
grant execute on function public.admin_cost_variant_price_history(text) to authenticated;
