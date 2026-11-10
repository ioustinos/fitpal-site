-- ============================================================================
-- WEC-864 (components & recipes) — import the composite recipes from the
-- kitchen's «Groups» Google Sheet (one tab per composite) + the live price
-- list in its «New Index Υλικών» tab. Staging part. DEV first (2026-11-10).
--
-- Load with the chunk files from build_groups_payload.py:
--   select costing_seed.load_groups('<kind>', '<md5>', $payload$…$payload$);
-- kinds:
--   grp_recipes : [[component_name, output_cooked_g, [[child_component_name, cooked_g], …]], …]
--   price_list  : [[simple_component_name, cost_per_100g_raw, cooked_g_per_100g_raw], …]
-- ============================================================================
create table if not exists costing_seed.grp_recipes (
  component text primary key, output_g numeric not null, lines jsonb not null);
create table if not exists costing_seed.price_list (
  component text primary key, cost100_raw numeric not null, cooked_g numeric);

create or replace function costing_seed.load_groups(p_kind text, p_md5 text, p_payload text)
returns text language plpgsql as $$
declare j jsonb; n int;
begin
  if md5(p_payload) <> p_md5 then
    raise exception 'chunk % md5 mismatch: got % expected %', p_kind, md5(p_payload), p_md5;
  end if;
  j := p_payload::jsonb;
  n := jsonb_array_length(j);
  if p_kind = 'grp_recipes' then
    insert into costing_seed.grp_recipes
    select e->>0, (e->>1)::numeric, e->2 from jsonb_array_elements(j) e
    on conflict (component) do update set output_g = excluded.output_g, lines = excluded.lines;
  elsif p_kind = 'price_list' then
    insert into costing_seed.price_list
    select e->>0, (e->>1)::numeric, (e->>2)::numeric from jsonb_array_elements(j) e
    on conflict (component) do update set cost100_raw = excluded.cost100_raw, cooked_g = excluded.cooked_g;
  else
    raise exception 'unknown kind %', p_kind;
  end if;
  insert into costing_seed.chunks (md5, kind, rows) values (p_md5, p_kind, n)
  on conflict (md5) do update set loaded_at = now();
  return p_kind || ': ' || n || ' rows ok';
end $$;
