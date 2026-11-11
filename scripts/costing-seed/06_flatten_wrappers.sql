-- ============================================================================
-- WEC-864 (components & recipes) — replace 100% «wrapper» component lines inside
-- recipes with their cost item directly.
-- 🟢 Ioustinos (11/11): «yes» to: «replace each 100% wrapper line inside recipes
-- with its cost item directly … the wrappers would stay for the dish links».
--
-- A wrapper = a component whose version in force today is yield 100% with exactly
-- one line, a cost item (the Excel «Index» rows). At 100% its cooked qty equals the
-- item's raw qty, so the swap keeps every cost identical.
-- For every component whose LATEST published version uses wrappers, a new published
-- version is saved with the same effective date (higher version_no wins on that date),
-- same yield, same order and notes — only those lines point to the cost item.
-- Wrappers themselves are untouched (dish lines can only link to components).
-- Drafts are untouched.
--
-- Run (dev, as owner): set request.jwt.claims to the owner, then run this block
-- repeatedly until it reports 0 — each run handles up to `batch` components.
-- Applied to DEV 2026-11-11.
-- ============================================================================
do $$
declare
  batch int := 40;
  r record; ln record; lines jsonb; n int := 0;
begin
  for r in
    with cur as (
      select distinct on (v.component_id) v.* from cost_component_versions v
      where v.status = 'published' and v.effective_from <= public.cost_today()
      order by v.component_id, v.effective_from desc, v.version_no desc),
    w as (
      select cur.component_id wid, l.cost_item_id iid
      from cur join cost_component_version_lines l on l.version_id = cur.id
      where cur.yield_mode = 'pct' and cur.yield_pct = 100 and l.cost_item_id is not null
        and (select count(*) from cost_component_version_lines x where x.version_id = cur.id) = 1),
    latest as (
      select distinct on (v.component_id) v.* from cost_component_versions v
      where v.status = 'published'
      order by v.component_id, v.effective_from desc, v.version_no desc)
    select lt.* from latest lt
    where exists (select 1 from cost_component_version_lines l join w on w.wid = l.child_component_id where l.version_id = lt.id)
    order by lt.component_id
    limit batch
  loop
    lines := '[]'::jsonb;
    for ln in
      select l.*, w.iid
      from cost_component_version_lines l
      left join (
        select cur2.component_id wid, l2.cost_item_id iid
        from (select distinct on (v.component_id) v.* from cost_component_versions v
              where v.status = 'published' and v.effective_from <= public.cost_today()
              order by v.component_id, v.effective_from desc, v.version_no desc) cur2
        join cost_component_version_lines l2 on l2.version_id = cur2.id
        where cur2.yield_mode = 'pct' and cur2.yield_pct = 100 and l2.cost_item_id is not null
          and (select count(*) from cost_component_version_lines x where x.version_id = cur2.id) = 1
      ) w on w.wid = l.child_component_id
      where l.version_id = r.id
      order by l.sort_order, l.id
    loop
      lines := lines || jsonb_build_object(
        'cost_item_id', coalesce(ln.iid, ln.cost_item_id),
        'child_component_id', case when ln.iid is null then ln.child_component_id end,
        'qty', ln.qty, 'note', ln.note);
    end loop;
    perform public.admin_cost_component_save(jsonb_build_object(
      'component_id', r.component_id,
      'effective_from', r.effective_from,
      'yield_mode', r.yield_mode, 'yield_pct', r.yield_pct,
      'output_weight_g', r.output_weight_g, 'fixed_cost_per_g', r.fixed_cost_per_g,
      'publish', true,
      'version_notes', 'Απευθείας cost items αντί για συστατικά-περιτυλίγματα 100% (ίδιο κόστος)',
      'lines', lines));
    n := n + 1;
  end loop;
  raise notice 'flattened % components', n;
end $$;
