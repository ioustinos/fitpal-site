-- ============================================================================
-- WEC-861 — costing nightly check: ledger (cost_history) vs from-scratch
-- recompute. Applied to DEV (jrxxsixhxgawucorfyjt) 2026-10-11; PROD pending.
--
-- For every cost item, component and dish variant:
--   • today's ledger value          vs cost_compute(today)
--   • every live ledger row whose effective_from is in the last p_days days
--                                    vs cost_compute(that date)
-- Tolerance €0.0001 on unit_cost (and food/packaging for variants).
-- Result is persisted in cost_check_runs; errors go in `error`, never only logs.
-- ============================================================================
create table if not exists public.cost_check_runs (
  id                bigserial primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  trigger_source    text not null default 'manual' check (trigger_source in ('manual','scheduled','test')),
  days_back         int not null default 90,
  entities_checked  int not null default 0,
  values_checked    int not null default 0,
  mismatch_count    int not null default 0,
  mismatches        jsonb not null default '[]'::jsonb,   -- first 200
  error             text,
  status            text not null default 'running' check (status in ('running','ok','mismatch','error')),
  duration_ms       int,
  requested_by      uuid default auth.uid()
);
create index if not exists cost_check_runs_started_idx on public.cost_check_runs (started_at desc);

alter table public.cost_check_runs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='cost_check_runs' and policyname='admin_read_cost_check_runs') then
    create policy admin_read_cost_check_runs on public.cost_check_runs for select to authenticated using (public.is_admin());
  end if;
end $$;
grant select on public.cost_check_runs to authenticated;
grant all on public.cost_check_runs to service_role;
grant usage, select on sequence public.cost_check_runs_id_seq to service_role;

-- value of one entity's compute jsonb in the same shape the ledger stores
create or replace function public.cost_compute_values(p_type text, r jsonb)
returns numeric[] language sql immutable set search_path = public as $$
  select case p_type
    when 'item'      then array[(r->>'unit_cost')::numeric, null, null]
    when 'component' then array[(r->>'cost_per_g')::numeric, null, null]
    else array[(r->>'product_cost')::numeric, (r->>'food_cost')::numeric, (r->>'packaging_cost')::numeric]
  end
$$;

create or replace function public.cost_check_run(p_trigger text default 'manual', p_days int default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run bigint; t0 timestamptz := clock_timestamp();
  v_today date := (now() at time zone 'Europe/Athens')::date;
  e record; h record; r jsonb; vals numeric[];
  n_ent int := 0; n_val int := 0; n_mis int := 0; v_mis jsonb := '[]'::jsonb;
  v_status text; v_err text;
  tol constant numeric := 0.0001;
begin
  if not (public.is_admin() or current_user in ('postgres','service_role') or auth.role() = 'service_role') then
    raise exception 'admin only';
  end if;
  insert into cost_check_runs (trigger_source, days_back) values (coalesce(p_trigger,'manual'), p_days)
  returning id into v_run;

  begin
    for e in
      select 'item'::text as t, id::text as id from cost_items
      union all select 'component', id::text from cost_components
      union all select 'variant', id from dish_variants
    loop
      n_ent := n_ent + 1;
      for h in
        -- the row in force today + every live row in the window
        select d.check_date, l.unit_cost, l.food_cost, l.packaging_cost
        from (
          select v_today as check_date
          union
          select effective_from from cost_history
          where entity_type = e.t and entity_id = e.id and superseded_at is null
            and effective_from >= v_today - p_days and effective_from <= v_today
        ) d
        left join lateral (
          select x.unit_cost, x.food_cost, x.packaging_cost from cost_history x
          where x.entity_type = e.t and x.entity_id = e.id and x.superseded_at is null
            and x.effective_from <= d.check_date
          order by x.effective_from desc limit 1
        ) l on true
      loop
        r := public.cost_compute(e.t, e.id, h.check_date);
        if r is null then continue; end if;
        vals := public.cost_compute_values(e.t, r);
        n_val := n_val + 1;
        if h.unit_cost is null
           or abs(h.unit_cost - vals[1]) > tol
           or (e.t = 'variant' and (abs(coalesce(h.food_cost,0) - vals[2]) > tol
                                 or abs(coalesce(h.packaging_cost,0) - vals[3]) > tol)) then
          n_mis := n_mis + 1;
          if n_mis <= 200 then
            v_mis := v_mis || jsonb_build_object(
              'entity_type', e.t, 'entity_id', e.id, 'date', h.check_date,
              'ledger', h.unit_cost, 'recomputed', round(vals[1], 8),
              'delta', case when h.unit_cost is null then null else round(vals[1] - h.unit_cost, 8) end,
              'ledger_food', h.food_cost, 'recomputed_food', round(vals[2], 6),
              'ledger_pack', h.packaging_cost, 'recomputed_pack', round(vals[3], 6));
          end if;
        end if;
      end loop;
    end loop;
    v_status := case when n_mis > 0 then 'mismatch' else 'ok' end;
  exception when others then
    v_status := 'error';
    v_err := sqlerrm;
  end;

  update cost_check_runs set
    finished_at = clock_timestamp(), entities_checked = n_ent, values_checked = n_val,
    mismatch_count = n_mis, mismatches = v_mis, error = v_err, status = v_status,
    duration_ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
  where id = v_run;

  return jsonb_build_object('run_id', v_run, 'status', v_status, 'entities_checked', n_ent,
    'values_checked', n_val, 'mismatch_count', n_mis, 'error', v_err,
    'duration_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);
end $$;

revoke execute on function public.cost_compute_values(text, jsonb) from public, anon, authenticated;
revoke execute on function public.cost_check_run(text, int) from public, anon, authenticated;
grant execute on function public.cost_check_run(text, int) to service_role;
