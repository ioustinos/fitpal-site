-- ============================================================================
-- WEC-862..866 — admin costing API (read models + the few writes that must be
-- atomic). Applied to DEV (jrxxsixhxgawucorfyjt) 2026-10-12; PROD pending.
--
-- Every function: SECURITY DEFINER, starts with cost_assert_admin(), returns
-- jsonb (one value → no PostgREST 1000-row cap). Plain CRUD (suppliers, items,
-- invoice headers/lines, links, packaging) goes through the tables directly
-- with the admin RLS policies from wec858.
-- ============================================================================

create or replace function public.cost_assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
end $$;

create or replace function public.cost_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Athens')::date $$;

-- ── cost items ──────────────────────────────────────────────────────────────
create or replace function public.admin_cost_items_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.cost_today();
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'kind', i.kind, 'category', i.category, 'base_unit', i.base_unit,
      'grams_per_unit', i.grams_per_unit, 'default_pack_label', i.default_pack_label,
      'default_base_qty_per_pack', i.default_base_qty_per_pack, 'default_vat_rate', i.default_vat_rate,
      'standard_cost_per_unit', i.standard_cost_per_unit, 'active', i.active, 'notes', i.notes,
      'source_ref', i.source_ref,
      'unit_cost', h.unit_cost, 'source', h.breakdown->>'source', 'price_date', h.breakdown->>'price_date',
      'spark', (select jsonb_agg(jsonb_build_array(x.effective_from, x.unit_cost) order by x.effective_from)
                from cost_history x where x.entity_type = 'item' and x.entity_id = i.id::text
                  and x.superseded_at is null and x.effective_from > v_today - 90),
      'used_in_components', (select count(distinct v.component_id) from cost_component_version_lines l
                               join cost_component_versions v on v.id = l.version_id where l.cost_item_id = i.id),
      'used_in_dishes', (select count(*) from cost_dish_packaging p where p.cost_item_id = i.id),
      'purchases', (select count(*) from cost_purchase_lines l where l.cost_item_id = i.id)
    ) order by i.name)
    from cost_items i
    left join lateral (select * from public.cost_at('item', i.id::text, v_today)) h on true
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_cost_item_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return jsonb_build_object(
    'current', public.cost_item_cost_at(p_id, public.cost_today()),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'invoice_id', inv.id, 'invoice_date', inv.invoice_date, 'invoice_number', inv.invoice_number,
        'supplier', s.name, 'qty_packs', l.qty_packs, 'pack_label', l.pack_label, 'base_qty_per_pack', l.base_qty_per_pack,
        'net_price_per_pack', l.net_price_per_pack, 'vat_rate', l.vat_rate, 'unit_cost', l.unit_cost,
        'exclude_from_costing', l.exclude_from_costing) order by inv.invoice_date desc, l.created_at desc)
      from cost_purchase_lines l join cost_purchase_invoices inv on inv.id = l.invoice_id
      left join cost_suppliers s on s.id = inv.supplier_id
      where l.cost_item_id = p_id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('date', effective_from, 'unit_cost', unit_cost, 'flags', flags, 'cause', cause)
                       order by effective_from)
      from cost_history where entity_type = 'item' and entity_id = p_id::text and superseded_at is null), '[]'::jsonb),
    'components', coalesce((
      select jsonb_agg(distinct jsonb_build_object('id', c.id, 'name', c.name))
      from cost_component_version_lines l join cost_component_versions v on v.id = l.version_id
      join cost_components c on c.id = v.component_id where l.cost_item_id = p_id), '[]'::jsonb),
    'dishes', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name_el, 'qty', p.qty_per_portion) order by d.name_el)
      from cost_dish_packaging p join dishes d on d.id = p.dish_id where p.cost_item_id = p_id), '[]'::jsonb));
end $$;

-- unit cost of several items on a date, optionally ignoring one invoice
-- (the invoice being edited) → «delta vs previous price» in the entry grid
create or replace function public.admin_cost_items_price_at(p_ids uuid[], p_date date, p_exclude_invoice uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_object_agg(i.id, coalesce(
      (select jsonb_build_object('unit_cost', l.unit_cost, 'source', 'purchase', 'price_date', inv.invoice_date)
       from cost_purchase_lines l join cost_purchase_invoices inv on inv.id = l.invoice_id
       where l.cost_item_id = i.id and not l.exclude_from_costing and inv.invoice_date <= p_date
         and inv.id is distinct from p_exclude_invoice
       order by inv.invoice_date desc, l.created_at desc, l.id desc limit 1),
      case when i.standard_cost_per_unit is not null
           then jsonb_build_object('unit_cost', i.standard_cost_per_unit, 'source', 'standard')
           else jsonb_build_object('unit_cost', 0, 'source', 'unpriced') end))
    from cost_items i where i.id = any(p_ids)), '{}'::jsonb);
end $$;

-- ── suppliers ───────────────────────────────────────────────────────────────
create or replace function public.admin_cost_suppliers_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'vat_number', s.vat_number, 'notes', s.notes, 'active', s.active,
      'invoices', (select count(*) from cost_purchase_invoices i where i.supplier_id = s.id),
      'last_invoice_date', (select max(invoice_date) from cost_purchase_invoices i where i.supplier_id = s.id),
      'total_net', (select coalesce(sum(l.line_net), 0) from cost_purchase_lines l
                    join cost_purchase_invoices i on i.id = l.invoice_id where i.supplier_id = s.id)
    ) order by s.name)
    from cost_suppliers s), '[]'::jsonb);
end $$;

-- ── invoices ────────────────────────────────────────────────────────────────
create or replace function public.admin_cost_invoices_list(p_supplier uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'invoice_date', i.invoice_date, 'invoice_number', i.invoice_number, 'supplier_id', i.supplier_id,
      'supplier', s.name, 'attachment_path', i.attachment_path, 'notes', i.notes,
      'lines', t.n, 'net', t.net, 'vat', t.vat, 'gross', t.net + t.vat) order by i.invoice_date desc, i.created_at desc)
    from cost_purchase_invoices i
    left join cost_suppliers s on s.id = i.supplier_id
    cross join lateral (select count(*) n, coalesce(sum(l.line_net), 0) net, coalesce(sum(round(l.line_net * l.vat_rate, 4)), 0) vat
                        from cost_purchase_lines l where l.invoice_id = i.id) t
    where (p_supplier is null or i.supplier_id = p_supplier)
      and (p_from is null or i.invoice_date >= p_from) and (p_to is null or i.invoice_date <= p_to)), '[]'::jsonb);
end $$;

-- ── components ──────────────────────────────────────────────────────────────
create or replace function public.admin_cost_components_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.cost_today();
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'category', c.category, 'active', c.active, 'source_ref', c.source_ref,
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

create or replace function public.admin_cost_component_detail(p_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_date date := coalesce(p_date, public.cost_today());
begin
  perform public.cost_assert_admin();
  return jsonb_build_object(
    'component', (select to_jsonb(c) from cost_components c where c.id = p_id),
    'as_of', v_date,
    'breakdown', public.cost_component_cost_at(p_id, v_date),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'version_no', v.version_no, 'effective_from', v.effective_from, 'status', v.status,
        'yield_mode', v.yield_mode, 'yield_pct', v.yield_pct, 'output_weight_g', v.output_weight_g,
        'fixed_cost_per_g', v.fixed_cost_per_g, 'notes', v.notes, 'created_at', v.created_at,
        'published_at', v.published_at,
        'created_by', (select email from auth.users u where u.id = v.created_by),
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'cost_item_id', l.cost_item_id, 'child_component_id', l.child_component_id,
            'name', coalesce(i.name, cc.name), 'unit', coalesce(i.base_unit, 'g'), 'qty', l.qty, 'note', l.note)
            order by l.sort_order, l.id)
          from cost_component_version_lines l
          left join cost_items i on i.id = l.cost_item_id
          left join cost_components cc on cc.id = l.child_component_id
          where l.version_id = v.id), '[]'::jsonb)
      ) order by v.version_no desc)
      from cost_component_versions v where v.component_id = p_id), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('date', effective_from, 'cost_per_g', unit_cost, 'flags', flags, 'cause', cause)
                       order by effective_from)
      from cost_history where entity_type = 'component' and entity_id = p_id::text and superseded_at is null), '[]'::jsonb),
    'dishes', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name_el, 'ingredient', ing.name_el, 'source', k.source)
                       order by d.name_el)
      from cost_dish_line_links k join dishes d on d.id = k.dish_id join ingredients ing on ing.id = k.ingredient_id
      where k.component_id = p_id), '[]'::jsonb),
    'parents', coalesce((
      select jsonb_agg(distinct jsonb_build_object('id', c.id, 'name', c.name))
      from cost_component_version_lines l join cost_component_versions v on v.id = l.version_id
      join cost_components c on c.id = v.component_id where l.child_component_id = p_id), '[]'::jsonb));
end $$;

-- Create a component and/or save a new version in one transaction.
-- p jsonb: { component_id?, name?, category?, notes?,
--            effective_from, yield_mode, yield_pct?, output_weight_g?, fixed_cost_per_g?,
--            publish (bool), version_notes?,
--            lines: [{cost_item_id? | child_component_id?, qty, note?}] }
-- Saving onto an existing DRAFT (p.draft_id) replaces that draft's lines.
create or replace function public.admin_cost_component_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid := nullif(p->>'component_id', '')::uuid;
  v_draft uuid := nullif(p->>'draft_id', '')::uuid;
  v_ver uuid; v_no int; ln jsonb; v_child uuid; v_i int := 0;
begin
  perform public.cost_assert_admin();
  if v_comp is null then
    if coalesce(btrim(p->>'name'), '') = '' then raise exception 'Το όνομα είναι υποχρεωτικό'; end if;
    insert into cost_components (name, category, notes)
    values (btrim(p->>'name'), nullif(btrim(p->>'category'), ''), nullif(p->>'notes', ''))
    returning id into v_comp;
  elsif p ? 'name' then
    update cost_components set name = coalesce(nullif(btrim(p->>'name'), ''), name),
      category = nullif(btrim(p->>'category'), ''), notes = nullif(p->>'notes', '')
    where id = v_comp;
  end if;

  -- loop guard: no child may (directly or indirectly) contain this component
  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_child := nullif(ln->>'child_component_id', '')::uuid;
    if v_child is not null and (v_child = v_comp
        or exists (select 1 from public.cost_component_closure(v_child) x where x.component_id = v_comp)) then
      raise exception 'Κύκλος: το «%» περιέχει ήδη (άμεσα ή έμμεσα) αυτό το συστατικό',
        (select name from cost_components where id = v_child);
    end if;
  end loop;

  if v_draft is not null then
    if not exists (select 1 from cost_component_versions where id = v_draft and component_id = v_comp and status = 'draft') then
      raise exception 'Η πρόχειρη έκδοση δεν βρέθηκε ή έχει ήδη δημοσιευτεί';
    end if;
    v_ver := v_draft;
    update cost_component_versions set
      effective_from = coalesce((p->>'effective_from')::date, public.cost_today()),
      yield_mode = p->>'yield_mode', yield_pct = (p->>'yield_pct')::numeric,
      output_weight_g = (p->>'output_weight_g')::numeric, fixed_cost_per_g = (p->>'fixed_cost_per_g')::numeric,
      notes = nullif(p->>'version_notes', '')
    where id = v_ver;
    -- the client removes the draft's old lines first (adminCosting.ts); drafts
    -- are not costed, so nothing to rebuild. Kept out of here on purpose: no
    -- row removal inside function bodies (the MCP apply refuses it).
    if exists (select 1 from cost_component_version_lines where version_id = v_ver) then
      raise exception 'Η πρόχειρη έκδοση έχει ακόμα γραμμές — ανανεώστε τη σελίδα';
    end if;
  else
    select coalesce(max(version_no), 0) + 1 into v_no from cost_component_versions where component_id = v_comp;
    insert into cost_component_versions (component_id, version_no, effective_from, yield_mode, yield_pct,
                                         output_weight_g, fixed_cost_per_g, notes)
    values (v_comp, v_no, coalesce((p->>'effective_from')::date, public.cost_today()), p->>'yield_mode',
            (p->>'yield_pct')::numeric, (p->>'output_weight_g')::numeric, (p->>'fixed_cost_per_g')::numeric,
            nullif(p->>'version_notes', ''))
    returning id into v_ver;
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into cost_component_version_lines (version_id, cost_item_id, child_component_id, qty, sort_order, note)
    values (v_ver, nullif(ln->>'cost_item_id', '')::uuid, nullif(ln->>'child_component_id', '')::uuid,
            (ln->>'qty')::numeric, v_i, nullif(ln->>'note', ''));
  end loop;

  if coalesce((p->>'publish')::boolean, false) then
    update cost_component_versions set status = 'published', published_at = now() where id = v_ver;
  end if;
  return jsonb_build_object('component_id', v_comp, 'version_id', v_ver);
end $$;

-- ── dishes ──────────────────────────────────────────────────────────────────
create or replace function public.admin_cost_dishes_overview(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_date date := coalesce(p_date, public.cost_today());
begin
  perform public.cost_assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name_el, 'category_id', d.category_id, 'active', d.active,
      'on_menu', exists (select 1 from menu_day_dishes m where m.dish_id = d.id and m.date >= public.cost_today()),
      'packaging_items', (select count(*) from cost_dish_packaging p where p.dish_id = d.id),
      'variants', (
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'label', v.label_el, 'price', round(v.price / 100.0, 2),
          'food_cost', h.food_cost, 'packaging_cost', h.packaging_cost, 'product_cost', h.unit_cost,
          'flags', h.flags) order by v.sort_order, v.id)
        from dish_variants v
        left join lateral (select * from public.cost_at('variant', v.id, v_date)) h on true
        where v.dish_id = d.id)
    ) order by d.name_el)
    from dishes d), '[]'::jsonb);
end $$;

create or replace function public.admin_cost_variant_detail(p_variant text, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return jsonb_build_object(
    'breakdown', public.cost_variant_cost_at(p_variant, coalesce(p_date, public.cost_today())),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('date', effective_from, 'product_cost', unit_cost, 'food_cost', food_cost,
                                          'packaging_cost', packaging_cost, 'flags', flags, 'cause', cause)
                       order by effective_from)
      from cost_history where entity_type = 'variant' and entity_id = p_variant and superseded_at is null), '[]'::jsonb));
end $$;

-- add / update a packaging set on many dishes at once
-- (for «replace», the client first removes the dishes' current rows)
create or replace function public.admin_cost_dish_packaging_apply(p_dishes text[], p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.cost_assert_admin();
  insert into cost_dish_packaging (dish_id, cost_item_id, qty_per_portion)
  select d, (x->>'cost_item_id')::uuid, coalesce((x->>'qty')::numeric, 1)
  from unnest(p_dishes) d cross join jsonb_array_elements(p_items) x
  on conflict (dish_id, cost_item_id) do update set qty_per_portion = excluded.qty_per_portion, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ── links review (WEC-865) ──────────────────────────────────────────────────
create or replace function public.admin_cost_links_review()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return coalesce((
    with lines as (
      select di.dish_id, di.ingredient_id, ing.name_el as ingredient, di.is_variant, di.fixed_grams,
        (select jsonb_agg(jsonb_build_object('variant_id', v.id,
                  'grams', coalesce(case when di.is_variant then a.grams else di.fixed_grams end, 0)) order by v.sort_order, v.id)
         from dish_variants v left join dish_variant_ingredient_amounts a on a.variant_id = v.id and a.ingredient_id = di.ingredient_id
         where v.dish_id = di.dish_id) as grams,
        (select max(coalesce(case when di.is_variant then a.grams else di.fixed_grams end, 0))
         from dish_variants v left join dish_variant_ingredient_amounts a on a.variant_id = v.id and a.ingredient_id = di.ingredient_id
         where v.dish_id = di.dish_id) as max_g,
        k.component_id as link_component_id, k.source, k.confirmed, k.match_note,
        dl.component_id as default_component_id
      from dish_ingredients di
      join ingredients ing on ing.id = di.ingredient_id
      left join cost_dish_line_links k on k.dish_id = di.dish_id and k.ingredient_id = di.ingredient_id
      left join cost_ingredient_default_links dl on dl.ingredient_id = di.ingredient_id
    )
    select jsonb_agg(jsonb_build_object(
      'dish_id', d.id, 'dish', d.name_el, 'category_id', d.category_id,
      'variants', (select jsonb_agg(jsonb_build_object('id', v.id, 'label', v.label_el) order by v.sort_order, v.id)
                   from dish_variants v where v.dish_id = d.id),
      'lines', (select jsonb_agg(jsonb_build_object(
                  'ingredient_id', l.ingredient_id, 'ingredient', l.ingredient, 'grams', l.grams,
                  'component_id', coalesce(l.link_component_id, l.default_component_id),
                  'component', (select name from cost_components c where c.id = coalesce(l.link_component_id, l.default_component_id)),
                  'source', coalesce(l.source, case when l.default_component_id is not null then 'default' end),
                  'confirmed', coalesce(l.confirmed, false), 'match_note', l.match_note) order by l.max_g desc)
                from lines l where l.dish_id = d.id and l.max_g > 0)
    ) order by d.name_el)
    from dishes d
    where exists (select 1 from lines l where l.dish_id = d.id and l.max_g > 0)), '[]'::jsonb);
end $$;

create or replace function public.admin_cost_dish_unlinked_count(p_dish text)
returns int language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then (
    select count(*)::int from dish_ingredients di
    where di.dish_id = p_dish
      and exists (select 1 from dish_variants v left join dish_variant_ingredient_amounts a
                    on a.variant_id = v.id and a.ingredient_id = di.ingredient_id
                  where v.dish_id = di.dish_id
                    and coalesce(case when di.is_variant then a.grams else di.fixed_grams end, 0) > 0)
      and not exists (select 1 from cost_dish_line_links k where k.dish_id = di.dish_id and k.ingredient_id = di.ingredient_id)
      and not exists (select 1 from cost_ingredient_default_links d where d.ingredient_id = di.ingredient_id))
  end
$$;

-- ── health / summary ────────────────────────────────────────────────────────
create or replace function public.admin_cost_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.cost_today();
begin
  perform public.cost_assert_admin();
  return jsonb_build_object(
    'items', (select count(*) from cost_items),
    'items_unpriced', (select count(*) from cost_items i where (public.cost_at('item', i.id::text, v_today)).breakdown->>'source' = 'unpriced'),
    'items_estimated', (select count(*) from cost_items i where (public.cost_at('item', i.id::text, v_today)).breakdown->>'source' = 'standard'),
    'components', (select count(*) from cost_components),
    'components_fixed', (select count(*) from cost_components c
                         where (public.cost_at('component', c.id::text, v_today)).breakdown->>'yield_mode' = 'fixed'),
    'invoices', (select count(*) from cost_purchase_invoices),
    'last_invoice_date', (select max(invoice_date) from cost_purchase_invoices),
    'variants_unlinked', (select count(*) from dish_variants v where (public.cost_at('variant', v.id, v_today)).flags ? 'unlinked'),
    'variants', (select count(*) from dish_variants),
    'links_unconfirmed', (select count(*) from cost_dish_line_links where not confirmed),
    'queue_pending', (select count(*) from cost_rebuild_queue where processed_at is null),
    'last_check', (select to_jsonb(r) - 'mismatches' from cost_check_runs r order by started_at desc limit 1));
end $$;

create or replace function public.admin_cost_check_run()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.cost_assert_admin();
  return public.cost_check_run('manual', 90);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'admin_cost_%' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
revoke execute on function public.cost_assert_admin() from public, anon;
grant execute on function public.cost_assert_admin() to authenticated, service_role;
grant execute on function public.cost_today() to authenticated, service_role;
