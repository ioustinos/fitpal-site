-- WEC-542: collision-proof order numbers. 4-digit random gave 10k slots/day;
-- birthday paradox produced ~3.3% duplicate-key 500s at ~500 orders/day.
-- Per-day counter → FP-YYMMDD-00001 (5 digits, monotonic, human-friendly).
-- 5-digit padding also guarantees no string collision with legacy 4-digit
-- random numbers issued earlier the same day.
-- Applied to live dev DB 2026-07-13 via MCP.

create table if not exists public.order_number_counters (
  day text primary key,
  n integer not null default 0
);
alter table public.order_number_counters enable row level security;
-- no policies on purpose: only reachable via the SECURITY DEFINER function / service role

create or replace function public.next_order_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := to_char(now() at time zone 'Europe/Athens', 'YYMMDD');
  v_n int;
begin
  insert into public.order_number_counters as c (day, n) values (v_day, 1)
  on conflict (day) do update set n = c.n + 1
  returning c.n into v_n;
  return 'FP-' || v_day || '-' || lpad(v_n::text, 5, '0');
end;
$$;

revoke all on function public.next_order_number() from public;
grant execute on function public.next_order_number() to service_role;
