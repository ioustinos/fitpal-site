-- ============================================================================
-- WEC-864 (components & recipes) — cooking method on components.
-- 🟢 Ioustinos (10/11): «add a cooking method (which would accompany the name)
-- … oil is the item and the components … would always be oil and in a
-- parenthesis the cooking way … add an "other" option».
--
-- cooking_method: fixed key (labels in the UI, Greek):
--   raw ωμό · boiled βραστό · steamed ατμού · sauteed σωτέ · roasted ψητό ·
--   baked φούρνου · pot κατσαρόλας · fried τηγανητό · cooked μαγειρεμένο ·
--   other → cooking_method_other (free text)
-- The quick «from a cost item» form names a new component «<name> (<method>)»; N/A = no parenthesis.
-- 🟢 Ioustinos: this is a convenience for creating components, NOT a rule for all components.
-- Existing names are never changed. The backfill below only fills the method field from the «, ωμό» suffix.
-- Applied to DEV 2026-11-10.
-- ============================================================================
alter table public.cost_components
  add column if not exists cooking_method text,
  add column if not exists cooking_method_other text;

do $$ begin
  alter table public.cost_components add constraint cost_components_cooking_method_ck check (
    cooking_method is null or cooking_method in
      ('raw','boiled','steamed','sauteed','roasted','baked','pot','fried','cooked','other'));
exception when duplicate_object then null; end $$;

-- backfill the seeded single-ingredient components from the name suffix («Καρότο, ωμό»)
update public.cost_components c set cooking_method = m.k
from (
  select id, case
    when s ~ '^(ωμ(ό|ή|ά|οί|ές|ος))$'                       then 'raw'
    when s ~ '^(βραστ(ό|ή|ά|ός|οί|ές))$'                    then 'boiled'
    when s ~ '^(ατμού|αχνιστ(ό|ή|ά))$'                      then 'steamed'
    when s = 'σωτέ'                                          then 'sauteed'
    when s ~ '^(ψητ(ό|ή|ά|ός|οί|ές)|roasted)$'              then 'roasted'
    when s = 'φούρνου'                                       then 'baked'
    when s = 'κατσαρόλας'                                    then 'pot'
    when s ~ '^τηγανητ'                                      then 'fried'
    when s ~ '^μαγειρεμέν'                                   then 'cooked'
  end k
  from (select id, lower(btrim(regexp_replace(name, '^.*,\s*', ''))) s
        from public.cost_components where source_ref like 'excel:Index:%' and name like '%,%') x
) m
where m.id = c.id and m.k is not null and c.cooking_method is null;

-- save RPC: accepts cooking_method / cooking_method_other (create + rename)
create or replace function public.admin_cost_component_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid := nullif(p->>'component_id', '')::uuid;
  v_draft uuid := nullif(p->>'draft_id', '')::uuid;
  v_ver uuid; v_no int; ln jsonb; v_child uuid; v_i int := 0;
  v_method text := nullif(p->>'cooking_method', '');
  v_other text := nullif(btrim(p->>'cooking_method_other'), '');
begin
  perform public.cost_assert_admin();
  if v_method = 'other' and v_other is null then
    raise exception 'Γράψτε τον τρόπο μαγειρέματος («Άλλο»)';
  end if;
  if v_method is distinct from 'other' then v_other := null; end if;
  if v_comp is null then
    if coalesce(btrim(p->>'name'), '') = '' then raise exception 'Το όνομα είναι υποχρεωτικό'; end if;
    insert into cost_components (name, category, notes, cooking_method, cooking_method_other)
    values (btrim(p->>'name'), nullif(btrim(p->>'category'), ''), nullif(p->>'notes', ''), v_method, v_other)
    returning id into v_comp;
  elsif p ? 'name' then
    update cost_components set name = coalesce(nullif(btrim(p->>'name'), ''), name),
      category = nullif(btrim(p->>'category'), ''), notes = nullif(p->>'notes', ''),
      cooking_method = case when p ? 'cooking_method' then v_method else cooking_method end,
      cooking_method_other = case when p ? 'cooking_method' then v_other else cooking_method_other end
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
