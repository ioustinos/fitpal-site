-- WEC-895 follow-up (round-2 QA 5.1): customer timeline must show old → new values,
-- not just a bare label. Money fields rendered in euros, dates/status as stored.
-- create-or-replace; applied to dev (jrxxsixhxgawucorfyjt) + prod (rhwetztxwjxfstffalwl) 2026-10-30.
create or replace function public.customer_wallet_plan_timeline(p_plan uuid)
returns table (kind text, at timestamptz, label text, body text, author text)
language sql stable security definer set search_path = public as $$
  with owned as (
    select wp.id from public.wallet_plans wp join public.wallets w on w.id = wp.wallet_id
    where wp.id = p_plan and w.user_id = auth.uid()
  )
  select * from (
    select 'change'::text as kind, cl.created_at as at,
      case cl.field_name
        when 'start_date' then 'Ημ/νία έναρξης: ' || coalesce(nullif(cl.old_value,''),'—') || ' → ' || coalesce(nullif(cl.new_value,''),'—')
        when 'active_until' then 'Ημ/νία λήξης: ' || coalesce(nullif(cl.old_value,''),'—') || ' → ' || coalesce(nullif(cl.new_value,''),'—')
        when 'status' then 'Κατάσταση: '
          || (case cl.old_value when 'active' then 'Ενεργή' when 'cancelled' then 'Ακυρωμένη' else coalesce(nullif(cl.old_value,''),'—') end)
          || ' → '
          || (case cl.new_value when 'active' then 'Ενεργή' when 'cancelled' then 'Ακυρωμένη' else coalesce(nullif(cl.new_value,''),'—') end)
        when 'amount_to_pay_cents' then 'Τελική τιμή: '
          || coalesce(to_char(nullif(cl.old_value,'')::numeric/100,'FM999999990.00')||' €','—') || ' → '
          || coalesce(to_char(nullif(cl.new_value,'')::numeric/100,'FM999999990.00')||' €','—')
        when 'subtotal_cents' then 'Αξία: '
          || coalesce(to_char(nullif(cl.old_value,'')::numeric/100,'FM999999990.00')||' €','—') || ' → '
          || coalesce(to_char(nullif(cl.new_value,'')::numeric/100,'FM999999990.00')||' €','—')
        when 'discount_cents' then 'Έκπτωση: '
          || coalesce(to_char(nullif(cl.old_value,'')::numeric/100,'FM999999990.00')||' €','—') || ' → '
          || coalesce(to_char(nullif(cl.new_value,'')::numeric/100,'FM999999990.00')||' €','—')
        else 'Ενημέρωση συνδρομής'
      end as label, null::text as body, null::text as author
    from public.admin_change_log cl
    where cl.wallet_plan_id = p_plan and exists (select 1 from owned)
      and cl.field_name in ('start_date','active_until','status','amount_to_pay_cents','discount_cents','subtotal_cents')
    union all
    select 'comment'::text, c.created_at, null::text, c.body, c.author
    from public.wallet_plan_comments c
    where c.wallet_plan_id = p_plan and c.visible_to_customer = true and exists (select 1 from owned)
  ) t
  order by t.at desc;
$$;
grant execute on function public.customer_wallet_plan_timeline(uuid) to authenticated;
