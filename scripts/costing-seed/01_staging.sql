-- ============================================================================
-- WEC-860 (seed costing data from the kitchen Excel) — staging schema.
-- Holds the Excel rows as-is so the dry-run report, the seed and the dish-line
-- auto-match (WEC-865) all run inside the DB. Applied to DEV 2026-10-11.
-- Load with the chunk files from make_chunks.py: select costing_seed.load(...)
-- ============================================================================
create schema if not exists costing_seed;
revoke all on schema costing_seed from public, anon, authenticated;

create table if not exists costing_seed.src_costs (
  row int primary key, category text, name text, price_kg numeric, err text);
create table if not exists costing_seed.src_packaging (
  row int primary key, name text, pcs numeric, price_pack numeric, price_pc numeric, note text, err text);
create table if not exists costing_seed.idx (
  row int primary key, raw text, name text, cost100_raw numeric, cooked_g numeric, cost100_cooked numeric, err text);
create table if not exists costing_seed.groups (
  row int primary key, name text, cost100_raw numeric, cooked_g numeric, cost100_cooked numeric, err text);
create table if not exists costing_seed.packsets (id int primary key, packaging text);
create table if not exists costing_seed.dishes (
  sheet text not null, no int not null,
  title text, names text[], grams jsonb,           -- grams[variant][name position]
  prod_costs numeric[], pack_costs numeric[], packset int, excel_rows int[],
  primary key (sheet, no));
create table if not exists costing_seed.chunks (
  md5 text primary key, kind text, rows int, loaded_at timestamptz default now());

create or replace function costing_seed.load(p_kind text, p_md5 text, p_payload text)
returns text language plpgsql as $$
declare j jsonb; n int;
begin
  if md5(p_payload) <> p_md5 then
    raise exception 'chunk % md5 mismatch: got % expected %', p_kind, md5(p_payload), p_md5;
  end if;
  j := p_payload::jsonb;
  n := jsonb_array_length(j);
  if p_kind = 'costs' then
    insert into costing_seed.src_costs
    select (e->>0)::int, e->>1, e->>2, (e->>3)::numeric, e->>4 from jsonb_array_elements(j) e
    on conflict (row) do update set category=excluded.category, name=excluded.name, price_kg=excluded.price_kg, err=excluded.err;
  elsif p_kind = 'packaging' then
    insert into costing_seed.src_packaging
    select (e->>0)::int, e->>1, (e->>2)::numeric, (e->>3)::numeric, (e->>4)::numeric, e->>5, e->>6 from jsonb_array_elements(j) e
    on conflict (row) do update set name=excluded.name, pcs=excluded.pcs, price_pack=excluded.price_pack,
      price_pc=excluded.price_pc, note=excluded.note, err=excluded.err;
  elsif p_kind = 'index' then
    insert into costing_seed.idx
    select (e->>0)::int, e->>1, e->>2, (e->>3)::numeric, (e->>4)::numeric, (e->>5)::numeric, e->>6 from jsonb_array_elements(j) e
    on conflict (row) do update set raw=excluded.raw, name=excluded.name, cost100_raw=excluded.cost100_raw,
      cooked_g=excluded.cooked_g, cost100_cooked=excluded.cost100_cooked, err=excluded.err;
  elsif p_kind = 'groups' then
    insert into costing_seed.groups
    select (e->>0)::int, e->>1, (e->>2)::numeric, (e->>3)::numeric, (e->>4)::numeric, e->>5 from jsonb_array_elements(j) e
    on conflict (row) do update set name=excluded.name, cost100_raw=excluded.cost100_raw, cooked_g=excluded.cooked_g,
      cost100_cooked=excluded.cost100_cooked, err=excluded.err;
  elsif p_kind = 'packsets' then
    insert into costing_seed.packsets select (e->>0)::int, e->>1 from jsonb_array_elements(j) e
    on conflict (id) do update set packaging=excluded.packaging;
  elsif p_kind = 'dishes' then
    insert into costing_seed.dishes
    select case e->>0 when 'Κ' then 'main' when 'Σ' then 'salad' else 'breakfast' end, (e->>1)::int, e->>2,
           array(select jsonb_array_elements_text(e->3)), e->4,
           array(select (x)::numeric from jsonb_array_elements_text(e->5) x),
           array(select (x)::numeric from jsonb_array_elements_text(e->6) x),
           (e->>7)::int, array(select (x)::int from jsonb_array_elements_text(e->8) x)
    from jsonb_array_elements(j) e
    on conflict (sheet, no) do update set title=excluded.title, names=excluded.names, grams=excluded.grams,
      prod_costs=excluded.prod_costs, pack_costs=excluded.pack_costs, packset=excluded.packset, excel_rows=excluded.excel_rows;
  else
    raise exception 'unknown kind %', p_kind;
  end if;
  insert into costing_seed.chunks (md5, kind, rows) values (p_md5, p_kind, n)
  on conflict (md5) do update set loaded_at = now();
  return p_kind || ': ' || n || ' rows ok';
end $$;
