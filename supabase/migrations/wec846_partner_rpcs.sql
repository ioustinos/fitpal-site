-- ============================================================================
-- WEC-846 / 842 / 843 / 847 / 848 / 850 / 851 / 852 — Dietitian Partners RPCs
-- (epic WEC-838). Applied to rhwetztxwjxfstffalwl on 2026-10-09.
--
-- The partner portal and the client-side link flow never read partner tables
-- directly: every call goes through one of these SECURITY DEFINER functions,
-- each of which checks access itself (current_partner_id / partner_can_access
-- / is_admin / auth.uid()). Admin screens use the admin_all_* RLS policies.
--
-- COMMISSION IS DERIVED, never stored (🟢 «only when payment happens»):
--   order base  = Σ payment_links.amount (status success) + manual_paid_amount
--                 − refund_amount, floored at 0. Wallet debits are not in it,
--                 so wallet-paid orders earn nothing — the commission was
--                 earned when the plan was paid.
--   plan base   = amount_to_pay_cents − refund_amount_cents when paid, else 0.
--   commission  = round(base × frozen bps / 10000).
--   There is no delivery fee in this platform, so «excluding delivery» holds
--   by construction (checked 2026-10-09: no delivery-fee column or setting).
-- Payouts record what Fitpal paid per line; outstanding = commission − paid.
-- A refund after payout makes outstanding negative = a clawback owed back.
-- ============================================================================

-- ── commission lines (internal; NOT granted to anyone) ─────────────────────
create or replace function public.partner_commission_lines(p_partner uuid, p_from date, p_to date)
returns table(
  source_type text, source_id uuid, client_user_id uuid, client_name text, ref text,
  occurred_at timestamptz, gross int, base int, rate_bps int, commission int,
  paid_out int, outstanding int, payment_method text, payment_status text, order_status text
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.id, o.user_id, coalesce(o.customer_name, pr.name, o.customer_email) as cname,
           o.order_number, coalesce(o.submitted_at, o.created_at) as at, o.total,
           greatest(0,
             coalesce((select sum(pl.amount) from payment_links pl where pl.order_id = o.id and pl.status = 'success'),0)
             + coalesce(o.manual_paid_amount,0) - coalesce(o.refund_amount,0))::int as base,
           coalesce(o.partner_commission_bps,0) as bps,
           o.payment_method::text pm, o.payment_status::text ps, o.status::text os
      from orders o left join profiles pr on pr.id = o.user_id
     where o.partner_id = p_partner and o.status <> 'draft'
  ),
  w as (
    select wp.id, wl.user_id, coalesce(pr.name, pr.email) as cname,
           'Πλάνο ' || coalesce(wp.plan_length::text,'') as ref, coalesce(wp.confirmed_at, wp.created_at) as at,
           coalesce(wp.amount_to_pay_cents,0) as total,
           case when wp.payment_status = 'paid'
                then greatest(0, coalesce(wp.amount_to_pay_cents,0) - coalesce(wp.refund_amount_cents,0)) else 0 end::int as base,
           coalesce(wp.partner_commission_bps,0) as bps,
           wp.payment_method::text pm, wp.payment_status::text ps, wp.status os
      from wallet_plans wp join wallets wl on wl.id = wp.wallet_id left join profiles pr on pr.id = wl.user_id
     where wp.partner_id = p_partner
  ),
  lines as (
    select 'order'::text st, id, user_id, cname, order_number ref, at, total, base, bps, pm, ps, os from o
    union all
    select 'wallet_plan', id, user_id, cname, ref, at, total, base, bps, pm, ps, os from w
  )
  select l.st, l.id, l.user_id, l.cname, l.ref, l.at, l.total, l.base, l.bps,
         round(l.base * l.bps / 10000.0)::int as commission,
         coalesce(p.paid,0)::int as paid_out,
         (round(l.base * l.bps / 10000.0)::int - coalesce(p.paid,0))::int as outstanding,
         l.pm, l.ps, l.os
    from lines l
    left join (select source_type, source_id, sum(amount) paid from partner_payout_items group by 1,2) p
      on p.source_type = l.st and p.source_id = l.id
   where (p_from is null or (l.at at time zone 'Europe/Athens')::date >= p_from)
     and (p_to   is null or (l.at at time zone 'Europe/Athens')::date <= p_to)
   order by l.at desc
$$;
revoke execute on function public.partner_commission_lines(uuid, date, date) from public, anon, authenticated;

-- ── partner side ────────────────────────────────────────────────────────────
create or replace function public.my_partner()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select p.id, p.name, p.is_internal, p.features, p.default_commission_bps, p.default_discount_bps,
           case when coalesce((p.features->>'referral')::boolean,false) then p.referral_code end as referral_code
      from partners p where p.id = public.current_partner_id()
  ) x
$$;

create or replace function public.partner_list_clients(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_partner_id(); v_internal boolean; v_q text;
begin
  if v_pid is null then raise exception 'not a partner' using errcode = '42501'; end if;
  select is_internal into v_internal from partners where id = v_pid;
  v_q := nullif(trim(coalesce(p_search,'')), '');
  return coalesce((
    select jsonb_agg(r order by r->>'name') from (
      select jsonb_build_object(
        'userId', pr.id, 'name', coalesce(pr.name, pr.email), 'email', pr.email, 'phone', pr.phone,
        'linkId', pc.id, 'status', pc.status, 'discountBps', pc.discount_bps, 'commissionBps', pc.commission_bps,
        'consent', pc.consent_at is not null, 'linkedAt', pc.created_at,
        'needsClientConfirm', pc.status = 'pending' and pc.client_confirmed_at is null,
        'needsFitpalApproval', pc.status = 'pending' and pc.approved_at is null,
        'lastOrderAt', (select max(coalesce(o.submitted_at,o.created_at)) from orders o where o.user_id = pr.id and o.status <> 'draft'),
        'walletBalance', (select w.balance from wallets w where w.user_id = pr.id),
        'planActiveUntil', (select wp.active_until from wallets w join wallet_plans wp on wp.id = w.active_plan_id where w.user_id = pr.id)
      ) r
      from profiles pr
      left join partner_clients pc on pc.client_user_id = pr.id and pc.partner_id = v_pid and pc.status <> 'inactive'
     where (pc.id is not null
            or (v_internal and v_q is not null))
       and (v_q is null or pr.name ilike '%'||v_q||'%' or pr.email ilike '%'||v_q||'%' or pr.phone ilike '%'||v_q||'%')
     limit 200
    ) s
  ), '[]'::jsonb);
end $$;

create or replace function public.partner_client_detail(p_client uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_partner_id(); v_internal boolean; v_link partner_clients; v_body boolean; v_feat jsonb;
begin
  if v_pid is null then raise exception 'not a partner' using errcode = '42501'; end if;
  if not public.partner_can_access(p_client) then raise exception 'no access to this client' using errcode = '42501'; end if;
  select is_internal, features into v_internal, v_feat from partners where id = v_pid;
  select * into v_link from partner_clients where client_user_id = p_client and status <> 'inactive' limit 1;
  -- 🟢 body data only with the client's consent (internal team: always)
  v_body := v_internal or (v_link.consent_at is not null);
  return jsonb_build_object(
    'userId', p_client,
    'link', case when v_link.id is null then null else jsonb_build_object(
       'id', v_link.id, 'status', v_link.status, 'discountBps', v_link.discount_bps,
       'commissionBps', case when v_link.partner_id = v_pid then v_link.commission_bps end,
       'consentAt', v_link.consent_at, 'ownLink', v_link.partner_id = v_pid) end,
    'bodyVisible', v_body,
    'profile', (select jsonb_build_object('name', name, 'email', email, 'phone', phone,
                  'sex', case when v_body then sex::text end, 'birthYear', case when v_body then birth_year end,
                  'heightCm', case when v_body then height_cm end, 'weightKg', case when v_body then weight_kg end,
                  'activityLevel', case when v_body then activity_level::text end, 'goal', case when v_body then goal::text end,
                  'dietaryNotes', dietary_notes)
                from profiles where id = p_client),
    'targets', (select jsonb_build_object('kcal', kcal, 'protein', protein, 'carbs', carbs, 'fat', fat,
                  'meals', meals, 'updatedAt', updated_at) from client_targets where user_id = p_client),
    'userGoals', (select to_jsonb(g) - 'user_id' from user_goals g where g.user_id = p_client),
    'addresses', coalesce((select jsonb_agg(jsonb_build_object('label', label_el, 'street', street, 'area', area,
                  'zip', zip, 'isDefault', is_default) order by sort_order) from addresses where user_id = p_client), '[]'::jsonb),
    'wallet', (select jsonb_build_object('balance', balance, 'active', active) from wallets where user_id = p_client),
    'plan', (select jsonb_build_object('id', wp.id, 'dailyKcal', wp.daily_kcal, 'macroSplit', wp.macro_split,
                  'planLength', wp.plan_length, 'startDate', wp.start_date, 'activeUntil', wp.active_until,
                  'paymentStatus', wp.payment_status, 'status', wp.status, 'amount', wp.amount_to_pay_cents,
                  'meals', jsonb_build_object('breakfast', wp.meal_breakfast, 'lunch', wp.meal_lunch,
                                              'dinner', wp.meal_dinner, 'snack', wp.meal_snack),
                  'daysPerWeek', wp.days_per_week)
                from wallets w join wallet_plans wp on wp.wallet_id = w.id
               where w.user_id = p_client order by wp.created_at desc limit 1),
    'progressEnabled', v_internal or coalesce((v_feat->>'progress_tracking')::boolean, false),
    'measurements', case when v_body and (v_internal or coalesce((v_feat->>'progress_tracking')::boolean,false)) then
        coalesce((select jsonb_agg(jsonb_build_object('id', id, 'measuredOn', measured_on, 'weightKg', weight_kg,
                   'bodyFatPct', body_fat_pct, 'waistCm', waist_cm, 'extra', extra, 'notes', notes) order by measured_on)
                  from body_measurements where user_id = p_client), '[]'::jsonb) end
  );
end $$;

create or replace function public.partner_update_client(p_client uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_pid uuid := public.current_partner_id(); v_internal boolean; v_consent boolean;
begin
  if v_pid is null or not public.partner_can_access(p_client) then
    raise exception 'no access to this client' using errcode = '42501';
  end if;
  select is_internal into v_internal from partners where id = v_pid;
  select consent_at is not null into v_consent from partner_clients where client_user_id = p_client and status = 'active' limit 1;

  if p ? 'profile' then
    update profiles set
      name  = coalesce(nullif(p->'profile'->>'name',''), name),
      phone = coalesce(nullif(p->'profile'->>'phone',''), phone)
     where id = p_client;
    if v_internal or coalesce(v_consent,false) then
      update profiles set
        sex            = coalesce(nullif(p->'profile'->>'sex','')::sex, sex),
        birth_year     = coalesce(nullif(p->'profile'->>'birthYear','')::smallint, birth_year),
        height_cm      = coalesce(nullif(p->'profile'->>'heightCm','')::smallint, height_cm),
        weight_kg      = coalesce(nullif(p->'profile'->>'weightKg','')::numeric, weight_kg),
        activity_level = coalesce(nullif(p->'profile'->>'activityLevel','')::activity_level, activity_level),
        goal           = coalesce(nullif(p->'profile'->>'goal','')::goal, goal),
        dietary_notes  = case when p->'profile' ? 'dietaryNotes' then p->'profile'->>'dietaryNotes' else dietary_notes end
       where id = p_client;
    end if;
  end if;

  if p ? 'targets' then
    insert into client_targets (user_id, kcal, protein, carbs, fat, meals, updated_by, updated_at)
    values (p_client,
            nullif(p->'targets'->>'kcal','')::int, nullif(p->'targets'->>'protein','')::int,
            nullif(p->'targets'->>'carbs','')::int, nullif(p->'targets'->>'fat','')::int,
            coalesce(p->'targets'->'meals', '{}'::jsonb), auth.uid(), now())
    on conflict (user_id) do update set
      kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat,
      meals = excluded.meals, updated_by = excluded.updated_by, updated_at = now();
  end if;
end $$;

create or replace function public.partner_add_measurement(p_client uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pid uuid := public.current_partner_id(); v_ok boolean; v_id uuid;
begin
  if v_pid is null or not public.partner_can_access(p_client) then
    raise exception 'no access to this client' using errcode = '42501';
  end if;
  select is_internal or coalesce((features->>'progress_tracking')::boolean,false) into v_ok from partners where id = v_pid;
  if not v_ok then raise exception 'progress tracking is not enabled for this partner' using errcode = '42501'; end if;
  insert into body_measurements (user_id, measured_on, weight_kg, body_fat_pct, waist_cm, extra, notes, created_by)
  values (p_client, coalesce(nullif(p->>'measuredOn','')::date, current_date),
          nullif(p->>'weightKg','')::numeric, nullif(p->>'bodyFatPct','')::numeric, nullif(p->>'waistCm','')::numeric,
          coalesce(p->'extra','{}'::jsonb), nullif(p->>'notes',''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Orders of the partner's clients (or one client), with per-day macros, the
-- client's daily target, and the delivery point. Per-DAY comparison only (🟢).
create or replace function public.partner_orders(p_client uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid := public.current_partner_id(); v_internal boolean;
begin
  if v_pid is null then raise exception 'not a partner' using errcode = '42501'; end if;
  select is_internal into v_internal from partners where id = v_pid;
  if p_client is not null and not public.partner_can_access(p_client) then
    raise exception 'no access to this client' using errcode = '42501';
  end if;
  if p_client is null and v_internal then
    raise exception 'pick a client' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(ord order by ord->>'firstDate' desc, ord->>'orderNumber' desc) from (
      select jsonb_build_object(
        'id', o.id, 'orderNumber', o.order_number, 'userId', o.user_id,
        'clientName', coalesce(pr.name, o.customer_name), 'status', o.status, 'paymentMethod', o.payment_method,
        'paymentStatus', o.payment_status, 'subtotal', o.subtotal, 'total', o.total,
        'partnerDiscount', o.partner_discount_amount, 'placedBy', o.placed_by_role,
        'firstDate', (select min(delivery_date) from child_orders where order_id = o.id),
        'target', (select jsonb_build_object('kcal', t.kcal, 'protein', t.protein, 'carbs', t.carbs, 'fat', t.fat)
                     from client_targets t where t.user_id = o.user_id),
        'days', (select jsonb_agg(jsonb_build_object(
                    'date', co.delivery_date, 'cancelled', co.cancelled_at is not null,
                    'fulfillment', co.fulfillment_type, 'pickupLocationId', co.pickup_location_id,
                    'area', co.address_area, 'zip', co.address_zip, 'street', co.address_street,
                    'timeFrom', co.time_from, 'timeTo', co.time_to,
                    'zoneName', (select dz.name_el from delivery_zones dz where co.address_zip = any(dz.postcodes) limit 1),
                    'totals', (select jsonb_build_object(
                                 'kcal', coalesce(sum(oi.calories * oi.quantity),0),
                                 'protein', coalesce(sum(oi.protein * oi.quantity),0),
                                 'carbs', coalesce(sum(oi.carbs * oi.quantity),0),
                                 'fat', coalesce(sum(oi.fat * oi.quantity),0))
                               from order_items oi where oi.child_order_id = co.id),
                    'items', (select jsonb_agg(jsonb_build_object('name', oi.name_el, 'variant', oi.variant_label_el,
                                 'qty', oi.quantity, 'kcal', oi.calories, 'protein', oi.protein, 'carbs', oi.carbs,
                                 'fat', oi.fat, 'comment', oi.comment))
                              from order_items oi where oi.child_order_id = co.id)
                  ) order by co.delivery_date)
                  from child_orders co where co.order_id = o.id)
      ) ord
      from orders o
      left join profiles pr on pr.id = o.user_id
     where o.status <> 'draft'
       and o.user_id is not null
       and (case when p_client is not null then o.user_id = p_client
                 else o.user_id in (select client_user_id from partner_clients where partner_id = v_pid and status = 'active') end)
       and (p_from is null or exists (select 1 from child_orders c2 where c2.order_id = o.id and c2.delivery_date >= p_from))
       and (p_to   is null or exists (select 1 from child_orders c3 where c3.order_id = o.id and c3.delivery_date <= p_to))
     limit 300
    ) s
  ), '[]'::jsonb);
end $$;

create or replace function public.partner_finance(p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    from public.partner_commission_lines(public.current_partner_id(), p_from, p_to) l
   where public.current_partner_id() is not null
$$;

-- ── admin side ──────────────────────────────────────────────────────────────
create or replace function public.admin_partner_finance(p_partner uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l)) from public.partner_commission_lines(p_partner, p_from, p_to) l), '[]'::jsonb);
end $$;

-- One row per partner: lifetime commission, paid out, outstanding, clients.
create or replace function public.admin_partner_balances()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'partnerId', p.id,
      'commission', coalesce((select sum(commission) from public.partner_commission_lines(p.id, null, null)),0),
      'paidOut',    coalesce((select sum(amount) from partner_payouts where partner_id = p.id),0),
      'outstanding',coalesce((select sum(outstanding) from public.partner_commission_lines(p.id, null, null)),0),
      'activeClients', (select count(*) from partner_clients where partner_id = p.id and status = 'active'),
      'pendingClients', (select count(*) from partner_clients where partner_id = p.id and status = 'pending')))
    from partners p), '[]'::jsonb);
end $$;

-- Mark lines paid (single or bulk). Pays each selected line's CURRENT
-- outstanding amount (which may be negative = settling a clawback).
create or replace function public.admin_partner_mark_paid(p_partner uuid, p_lines jsonb, p_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_payout uuid; v_total int := 0; r record;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  insert into partner_payouts (partner_id, amount, reference, note, created_by)
  values (p_partner, 0, p_reference, p_note, auth.uid()) returning id into v_payout;
  for r in
    select l.source_type, l.source_id, l.outstanding
      from public.partner_commission_lines(p_partner, null, null) l
      join jsonb_to_recordset(p_lines) as x(source_type text, source_id uuid)
        on x.source_type = l.source_type and x.source_id = l.source_id
     where l.outstanding <> 0
  loop
    insert into partner_payout_items (payout_id, source_type, source_id, amount)
    values (v_payout, r.source_type, r.source_id, r.outstanding);
    v_total := v_total + r.outstanding;
  end loop;
  if v_total = 0 and not exists (select 1 from partner_payout_items where payout_id = v_payout) then
    raise exception 'nothing outstanding on the selected lines' using errcode = '22023';
  end if;
  update partner_payouts set amount = v_total where id = v_payout;
  return v_payout;
end $$;

create or replace function public.admin_approve_partner_link(p_link uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v partner_clients;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  update partner_clients set approved_by = auth.uid(), approved_at = now() where id = p_link returning * into v;
  if v.status = 'pending' and v.client_confirmed_at is not null then
    update partner_clients set status = 'active' where id = p_link;
    return 'active';
  end if;
  return v.status;
end $$;

-- ── client side ─────────────────────────────────────────────────────────────
-- The client sees their dietitian and their DISCOUNT, never the commission
-- (🟢 «Δεν βλέπει τα οικονομικά του διαιτολόγου»).
create or replace function public.my_partner_link()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', pc.id, 'partnerName', p.name, 'status', pc.status,
           'discountBps', case when pc.status = 'active' and p.active then pc.discount_bps else 0 end,
           'needsConfirm', pc.status = 'pending' and pc.client_confirmed_at is null,
           'needsConsent', pc.consent_at is null,
           'awaitingFitpal', pc.status = 'pending' and pc.client_confirmed_at is not null and pc.approved_at is null)
    from partner_clients pc join partners p on p.id = pc.partner_id
   where pc.client_user_id = auth.uid() and pc.status <> 'inactive'
   limit 1
$$;

create or replace function public.client_respond_partner_link(p_link uuid, p_accept boolean, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v partner_clients;
begin
  select * into v from partner_clients where id = p_link and client_user_id = auth.uid() and status <> 'inactive';
  if v.id is null then raise exception 'link not found' using errcode = 'P0002'; end if;
  if not p_accept then
    -- declining is only possible while pending; an active link is ended by Fitpal
    if v.status = 'pending' then update partner_clients set status = 'inactive' where id = p_link; end if;
    return public.my_partner_link();
  end if;
  update partner_clients set
    client_confirmed_at = coalesce(client_confirmed_at, now()),
    consent_at = case when p_consent then coalesce(consent_at, now()) else consent_at end
   where id = p_link;
  update partner_clients set status = 'active'
   where id = p_link and status = 'pending' and approved_at is not null;
  return public.my_partner_link();
end $$;

-- 🟢 hidden add-on WEC-852: a self-signup via a dietitian's referral link.
create or replace function public.claim_partner_referral(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p partners;
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  select * into v_p from partners
   where lower(referral_code) = lower(trim(p_code)) and active and coalesce((features->>'referral')::boolean,false);
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if exists (select 1 from partner_clients where client_user_id = auth.uid() and status <> 'inactive') then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  -- An existing customer (has orders) goes through the same confirm+approve
  -- path as a dietitian adding an existing customer; a fresh signup is active.
  if exists (select 1 from orders where user_id = auth.uid() and status <> 'draft') then
    insert into partner_clients (partner_id, client_user_id, status, discount_bps, commission_bps, created_via, created_by, client_confirmed_at)
    values (v_p.id, auth.uid(), 'pending', v_p.default_discount_bps, v_p.default_commission_bps, 'referral', auth.uid(), now());
  else
    insert into partner_clients (partner_id, client_user_id, status, discount_bps, commission_bps, created_via, created_by, client_confirmed_at, approved_at)
    values (v_p.id, auth.uid(), 'active', v_p.default_discount_bps, v_p.default_commission_bps, 'referral', auth.uid(), now(), now());
  end if;
  return jsonb_build_object('ok', true, 'partnerName', v_p.name);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_partner()', 'public.partner_list_clients(text)', 'public.partner_client_detail(uuid)',
    'public.partner_update_client(uuid, jsonb)', 'public.partner_add_measurement(uuid, jsonb)',
    'public.partner_orders(uuid, date, date)', 'public.partner_finance(date, date)',
    'public.admin_partner_finance(uuid, date, date)', 'public.admin_partner_balances()',
    'public.admin_partner_mark_paid(uuid, jsonb, text, text)', 'public.admin_approve_partner_link(uuid)',
    'public.my_partner_link()', 'public.client_respond_partner_link(uuid, boolean, boolean)',
    'public.claim_partner_referral(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
