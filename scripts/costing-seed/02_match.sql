-- ============================================================================
-- WEC-860 (Excel seed) + WEC-865 (link dish lines to components) — matching.
-- Pure analysis inside costing_seed; writes nothing to public.*.
--   costing_seed.norm / loose   text normalisers (no unaccent/pg_trgm on our DBs)
--   costing_seed.dish_match     Fitpal dish → Excel dish (title + gram signatures)
--   costing_seed.line_match     Fitpal dish line → Excel component name
-- Run:  select costing_seed.run_match();
-- ============================================================================

-- lower-case, strip Greek/Latin accents, final ς→σ, punctuation → space
create or replace function costing_seed.norm(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(t, '')),
      'άέήίόύώϊϋΐΰςàáâäèéêëìíîïòóôöùúûüç',
      'αεηιουωιυιυσaaaaeeeeiiiioooouuuuc'),
    '[^a-zα-ω0-9%]+', ' ', 'g'))
$$;

-- phonetic-ish: η/υ/ει/οι → ι, ω → ο, αι → ε (catches «Γλυκόξυνο» vs «Γλυκόξινο»)
create or replace function costing_seed.loose(t text) returns text
language sql immutable as $$
  select translate(replace(replace(replace(costing_seed.norm(t), 'ει', 'ι'), 'οι', 'ι'), 'αι', 'ε'), 'ηυω', 'ιιο')
$$;

create or replace function costing_seed.tokens(t text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct w), '{}') from unnest(string_to_array(costing_seed.loose(t), ' ')) w
  where length(w) > 2 and w not in ('και','με','για','απο','στο','στη','την','τον','του','της','των','σε','ωμα','ωμο','ομα','ομο')
$$;

-- share of a's tokens found in b
create or replace function costing_seed.contain(a text[], b text[]) returns numeric
language sql immutable as $$
  select case when cardinality(a) = 0 then 0
         else (select count(*) from unnest(a) x where x = any(b))::numeric / cardinality(a) end
$$;

create table if not exists costing_seed.dish_match (
  dish_id text primary key, sheet text, no int, title_score numeric, gram_score numeric,
  runner_up text, status text);   -- matched | title_only | weak | ambiguous | none
create table if not exists costing_seed.line_match (
  dish_id text, ingredient_id uuid, ingredient text, excel_name text,
  gram_score numeric, name_score numeric, status text,      -- exact | grams | name | ambiguous | none
  component_id uuid, component_source text,
  primary key (dish_id, ingredient_id));

create or replace function costing_seed.run_match() returns jsonb
language plpgsql as $$
declare d record; n_d int := 0;
begin
  truncate costing_seed.dish_match, costing_seed.line_match;

  -- Fitpal resolved grams per variant / line (same rule as the dish modal)
  create temp table fl on commit drop as
  select v.dish_id, v.id as variant_id, v.sort_order as vpos, di.ingredient_id, i.name_el as ingredient,
         coalesce(case when di.is_variant then a.grams else di.fixed_grams end, 0)::numeric as g
  from dish_variants v
  join dish_ingredients di on di.dish_id = v.dish_id
  join ingredients i on i.id = di.ingredient_id
  left join dish_variant_ingredient_amounts a on a.variant_id = v.id and a.ingredient_id = di.ingredient_id;

  create temp table fsig on commit drop as
  select dish_id, variant_id, array_agg(trim_scale(g) order by g)::text as sig from fl where g > 0 group by 1, 2;

  -- Excel rows: one per variant row k, names[i] → grams[k][i]
  create temp table el on commit drop as
  select e.sheet, e.no, k.ord - 1 as k, n.ord - 1 as i, n.name, (k.val->>(n.ord - 1)::int)::numeric as g
  from costing_seed.dishes e
  cross join lateral jsonb_array_elements(e.grams) with ordinality k(val, ord)
  cross join lateral unnest(e.names) with ordinality n(name, ord);

  create temp table esig on commit drop as
  select sheet, no, k, array_agg(trim_scale(g) order by g)::text as sig from el where g > 0 group by 1, 2, 3;

  create index on fl (variant_id, ingredient_id); create index on fl (dish_id);
  create index on el (sheet, no, k, i); create index on fsig (dish_id); create index on esig (sheet, no);
  analyze fl; analyze el; analyze fsig; analyze esig;

  -- candidate pairs: share a gram signature, or title overlap ≥ 0.5
  create temp table cand on commit drop as
  with gs as (
    select f.dish_id, e.sheet, e.no, count(distinct f.variant_id)::numeric as hit
    from fsig f join esig e on e.sig = f.sig group by 1, 2, 3
  ), nv as (select dish_id, count(*)::numeric as n from fsig group by 1),
  ft as (select id as dish_id, costing_seed.tokens(name_el) as tk from dishes),
  et as (select sheet, no, costing_seed.tokens(title) as tk from costing_seed.dishes),
  tt as (
    select ft.dish_id, et.sheet, et.no, costing_seed.contain(ft.tk, et.tk) as ts
    from ft cross join et
  )
  select tt.dish_id, tt.sheet, tt.no, tt.ts, coalesce(gs.hit / nullif(nv.n, 0), 0) as gsc
  from tt left join gs using (dish_id, sheet, no) left join nv using (dish_id)
  where tt.ts >= 0.5 or gs.hit is not null;

  insert into costing_seed.dish_match
  select dish_id, sheet, no, ts, gsc, runner,
         case when runner_total is not null and runner_total >= best_total - 0.05 then 'ambiguous'
              when ts >= 0.6 and gsc >= 0.5 then 'matched'      -- title AND grams agree
              when ts >= 0.75 then 'title_only'                 -- recipe changed since the Excel
              else 'weak' end
  from (
    select c.*, c.ts * 2 + c.gsc as best_total,
           lead(c.ts * 2 + c.gsc) over w as runner_total,
           lead(c.sheet || ':' || c.no) over w as runner,
           row_number() over w as rn
    from cand c
    window w as (partition by c.dish_id order by c.ts * 2 + c.gsc desc, c.sheet, c.no)
  ) x where rn = 1;

  insert into costing_seed.dish_match (dish_id, status)
  select id, 'none' from dishes where id not in (select dish_id from costing_seed.dish_match);

  -- line pairing inside matched/weak/ambiguous dishes
  for d in select * from costing_seed.dish_match where status <> 'none' loop
    n_d := n_d + 1;
    insert into costing_seed.line_match (dish_id, ingredient_id, ingredient, excel_name, gram_score, name_score, status)
    with
    -- align Fitpal variant → Excel row with the same signature (first unused)
    al as (
      select distinct on (f.variant_id) f.variant_id, e.k
      from fsig f join esig e on e.sig = f.sig and e.sheet = d.sheet and e.no = d.no
      where f.dish_id = d.dish_id
      order by f.variant_id, e.k
    ),
    lines as (
      select ingredient_id, min(ingredient) as ingredient, array_agg(distinct g) filter (where g > 0) as gset
      from fl where dish_id = d.dish_id group by 1 having max(g) > 0
    ),
    names as (
      select i, name, array_agg(distinct g) filter (where g > 0) as gset
      from el where sheet = d.sheet and no = d.no group by 1, 2 having max(g) > 0
    ),
    sc as (
      select l.ingredient_id, l.ingredient, n.name,
        case when (select count(*) from al) > 0 then
          (select count(*) filter (where coalesce(f.g, 0) = coalesce(e.g, 0))::numeric / count(*)
           from al
           join fl f on f.variant_id = al.variant_id and f.ingredient_id = l.ingredient_id
           left join el e on e.sheet = d.sheet and e.no = d.no and e.k = al.k and e.i = n.i)
        else
          (select count(*)::numeric from unnest(l.gset) x where x = any(n.gset))
            / greatest(cardinality(l.gset), cardinality(n.gset))
        end as gscore,
        greatest(costing_seed.contain(costing_seed.tokens(l.ingredient), costing_seed.tokens(n.name)),
                 costing_seed.contain(costing_seed.tokens(n.name), costing_seed.tokens(l.ingredient))) as nscore
      from lines l cross join names n
    ),
    ranked as (
      select sc.*, row_number() over (partition by ingredient_id order by gscore * 2 + nscore desc, name) as rn,
             count(*) filter (where gscore = 1) over (partition by ingredient_id) as n_exact,
             max(gscore * 2 + nscore) over (partition by ingredient_id) as top,
             nth_value(gscore * 2 + nscore, 2) over (partition by ingredient_id order by gscore * 2 + nscore desc, name
                                                     rows between unbounded preceding and unbounded following) as second
      from sc
    )
    select d.dish_id, ingredient_id, ingredient,
           case when top >= 1 then name end, gscore, nscore,
           case when top < 1 then 'none'
                when second is not null and second >= top - 0.01 then 'ambiguous'
                when gscore = 1 and nscore > 0 then 'exact'
                when gscore = 1 then 'grams'
                else 'name' end
    from ranked where rn = 1;
  end loop;

  -- Fitpal lines with grams in dishes that matched nothing
  insert into costing_seed.line_match (dish_id, ingredient_id, ingredient, status)
  select dish_id, ingredient_id, min(ingredient), 'no_dish'
  from fl where g > 0 and dish_id in (select dish_id from costing_seed.dish_match where status = 'none')
  group by 1, 2
  on conflict do nothing;

  return jsonb_build_object('dishes', (select jsonb_object_agg(status, n) from (select status, count(*) n from costing_seed.dish_match group by 1) s),
                            'lines', (select jsonb_object_agg(status, n) from (select status, count(*) n from costing_seed.line_match group by 1) s));
end $$;
