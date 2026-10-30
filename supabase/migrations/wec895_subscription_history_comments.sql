-- WEC-895: subscription action history (timeline) + real comments with customer visibility.
-- Applied to prod (rhwetztxwjxfstffalwl) + dev branch (jrxxsixhxgawucorfyjt) 2026-10-29.

-- 1. admin_change_log can now point at a wallet plan (DECISION: new column, there is
--    no record_id on this table; the 4 writers below stamp it).
alter table public.admin_change_log
  add column if not exists wallet_plan_id uuid references public.wallet_plans(id) on delete cascade;
create index if not exists idx_admin_change_log_wallet_plan
  on public.admin_change_log(wallet_plan_id) where wallet_plan_id is not null;

-- 2. Comments: a real thread, decoupled from wallet_plans.admin_note. Hard delete.
create table if not exists public.wallet_plan_comments (
  id bigint generated always as identity primary key,
  wallet_plan_id uuid not null references public.wallet_plans(id) on delete cascade,
  body text not null,
  visible_to_customer boolean not null default false,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wallet_plan_comments_plan
  on public.wallet_plan_comments(wallet_plan_id, created_at);

alter table public.wallet_plan_comments enable row level security;

drop policy if exists wpc_admin_all on public.wallet_plan_comments;
create policy wpc_admin_all on public.wallet_plan_comments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists wpc_customer_read on public.wallet_plan_comments;
create policy wpc_customer_read on public.wallet_plan_comments
  for select to authenticated
  using (
    visible_to_customer
    and exists (
      select 1 from public.wallet_plans wp
      join public.wallets w on w.id = wp.wallet_id
      where wp.id = wallet_plan_comments.wallet_plan_id
        and w.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.wallet_plan_comments to authenticated;

-- 3. Backfill existing admin_note → an admin-only comment (data preserved; the
--    note column stays but is no longer written by the expiry Save button).
insert into public.wallet_plan_comments (wallet_plan_id, body, visible_to_customer, author, created_at)
select wp.id, wp.admin_note, false, 'legacy', coalesce(wp.created_at, now())
from public.wallet_plans wp
where wp.admin_note is not null and btrim(wp.admin_note) <> '';

-- 4. Customer-facing timeline: curated plan events + their own visible comments.
create or replace function public.customer_wallet_plan_timeline(p_plan uuid)
returns table (kind text, at timestamptz, label text, body text, author text)
language sql stable security definer set search_path = public as $$
  with owned as (
    select wp.id
    from public.wallet_plans wp
    join public.wallets w on w.id = wp.wallet_id
    where wp.id = p_plan and w.user_id = auth.uid()
  )
  select * from (
    select 'change'::text as kind, cl.created_at as at,
      case cl.field_name
        when 'start_date' then 'Αλλαγή ημερομηνίας έναρξης'
        when 'active_until' then 'Αλλαγή ημερομηνίας λήξης'
        when 'status' then 'Αλλαγή κατάστασης συνδρομής'
        when 'amount_to_pay_cents' then 'Αλλαγή τιμής'
        when 'subtotal_cents' then 'Αλλαγή τιμής'
        when 'discount_pct' then 'Αλλαγή έκπτωσης'
        when 'discount_cents' then 'Αλλαγή έκπτωσης'
        else 'Ενημέρωση συνδρομής'
      end as label, null::text as body, null::text as author
    from public.admin_change_log cl
    where cl.wallet_plan_id = p_plan
      and exists (select 1 from owned)
      and cl.field_name in ('start_date','active_until','status','amount_to_pay_cents','discount_pct','discount_cents','subtotal_cents')
    union all
    select 'comment'::text, c.created_at, null::text, c.body, c.author
    from public.wallet_plan_comments c
    where c.wallet_plan_id = p_plan
      and c.visible_to_customer = true
      and exists (select 1 from owned)
  ) t
  order by t.at desc;
$$;
grant execute on function public.customer_wallet_plan_timeline(uuid) to authenticated;
