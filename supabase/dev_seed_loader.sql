-- Dev branch only (jrxxsixhxgawucorfyjt). Loads the anonymized production
-- sample staged in devsync.seed_parts (parts 0-3 = payload, 100 = streets).
-- Names → «Πελάτης Δοκιμής NN», emails → ioustinos.sarris+devNN@gmail.com,
-- phones fake, doorbells replaced; streets/zip/areas real (OK'd 2026-10-11).
-- Order numbers get prefix SD- so they never collide with dev's FP- counter.
-- Every seeded row is left airtable_dirty=false so nothing is pushed.
do $loader$
declare
  j jsonb; s jsonb; r jsonb; v_uid uuid; v_oid uuid; v_kid uuid; v_wid uuid; v_pid uuid;
  v_idx int; v_i int; v_store uuid; v_st jsonb;
begin
  if exists (select 1 from auth.users where email like 'ioustinos.sarris+dev%@gmail.com') then
    raise exception 'seed already loaded';
  end if;
  select (string_agg(body, '' order by part) filter (where part < 100))::jsonb into j from devsync.seed_parts;
  select body::jsonb into s from devsync.seed_parts where part = 100;

  create temp table m_c (idx int primary key, uid uuid) on commit drop;
  create temp table m_o (idx int primary key, oid uuid) on commit drop;
  create temp table m_k (idx int primary key, kid uuid) on commit drop;

  -- customers
  for r in select * from jsonb_array_elements(j->'c') loop
    v_idx := (r->>0)::int; v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      format('ioustinos.sarris+dev%s@gmail.com', lpad(v_idx::text, 2, '0')), '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', 'Πελάτης Δοκιμής ' || v_idx), now() - interval '30 days', now(),
      '', '', '', '');
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (gen_random_uuid(), v_uid::text, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', format('ioustinos.sarris+dev%s@gmail.com', lpad(v_idx::text, 2, '0')), 'email_verified', true),
      'email', now(), now());
    update public.profiles set
      name = 'Πελάτης Δοκιμής ' || v_idx,
      name_en = 'Test Customer ' || v_idx,
      phone = '6900000' || lpad(v_idx::text, 3, '0'),
      sex = (r->>1)::sex, birth_year = (r->>2)::int2, height_cm = (r->>3)::int2,
      weight_kg = (r->>4)::numeric, activity_level = (r->>5)::activity_level, goal = (r->>6)::goal
    where id = v_uid;
    insert into m_c values (v_idx, v_uid);
  end loop;

  -- saved addresses
  v_i := 0;
  for r in select * from jsonb_array_elements(j->'a') loop
    v_st := s->'as'->v_i;
    insert into public.addresses (user_id, label_el, label_en, street, area, zip, floor, doorbell, is_default, sort_order)
    select m.uid, 'Διεύθυνση', 'Address', s->'s'->>((v_st->>0)::int), r->>2, r->>1, v_st->>1,
           'Πελάτης Δοκιμής ' || m.idx, (r->>3)::boolean, v_i
    from m_c m where m.idx = (r->>0)::int;
    v_i := v_i + 1;
  end loop;

  -- orders
  for r in select * from jsonb_array_elements(j->'o') loop
    v_oid := gen_random_uuid();
    select id into v_store from public.stores where slug = r->>9;
    insert into public.orders (id, order_number, user_id, customer_name, customer_email, customer_phone,
      subtotal, discount_amount, total, payment_method, payment_status, status, cutlery, invoice_type,
      invoice_name, invoice_vat, created_at, submitted_at, refund_amount, manual_paid_amount, manual_discount, store_id)
    select v_oid, replace(r->>2, 'FP-', 'SD-'), m.uid, p.name, p.email, p.phone,
      (r->>6)::int, (r->>7)::int, (r->>8)::int, (r->>4)::payment_method, (r->>5)::payment_status,
      (r->>3)::order_status, (r->>12)::boolean, (r->>13)::invoice_type,
      case when r->>13 = 'invoice' then 'Εταιρεία Δοκιμής ' || m.idx end,
      case when r->>13 = 'invoice' then '999' || lpad(m.idx::text, 6, '0') end,
      (r->>10)::timestamptz, (r->>11)::timestamptz, (r->>14)::int, (r->>15)::int, (r->>16)::int,
      coalesce(v_store, 'c199e822-dc36-42af-b3d0-ac2c4ea72a18')
    from m_c m join public.profiles p on p.id = m.uid where m.idx = (r->>1)::int;
    insert into m_o values ((r->>0)::int, v_oid);
  end loop;

  -- child orders (one per day)
  for r in select * from jsonb_array_elements(j->'k') loop
    v_kid := gen_random_uuid();
    v_st := s->'ks'->(r->>0);
    insert into public.child_orders (id, order_id, delivery_date, time_from, time_to, fulfillment_type,
      pickup_location_id, address_zip, address_area, address_street, address_floor, address_doorbell,
      cancelled_at, company_benefit_amount, created_at)
    select v_kid, mo.oid, (r->>2)::date, (r->>3)::time, (r->>4)::time, r->>5, r->>6,
      case when r->>5 = 'delivery' then r->>7 end,
      case when r->>5 = 'delivery' then r->>8 end,
      case when v_st is not null then s->'s'->>((v_st->>0)::int) end,
      v_st->>1,
      case when r->>5 = 'delivery' then 'Πελάτης Δοκιμής ' || o.user_id::text end,
      case when (r->>9)::boolean then now() end,
      coalesce((r->>10)::int, 0), o.created_at
    from m_o mo join public.orders o on o.id = mo.oid where mo.idx = (r->>1)::int;
    insert into m_k values ((r->>0)::int, v_kid);
  end loop;
  -- doorbell: replace the uuid placeholder above with the customer number
  update public.child_orders c set address_doorbell = 'Πελάτης Δοκιμής ' || m.idx
    from public.orders o join m_c m on m.uid = o.user_id
    where c.order_id = o.id and c.id in (select kid from m_k) and c.address_doorbell is not null;

  -- order items (names/macros from dev's own catalog)
  insert into public.order_items (child_order_id, dish_id, variant_id, name_el, name_en,
    variant_label_el, variant_label_en, quantity, unit_price, total_price, calories, protein, carbs, fat)
  select mk.kid, d.id, v.id, coalesce(d.name_el, x->>1), coalesce(d.name_en, d.name_el, x->>1),
    v.label_el, v.label_en, (x->>3)::int, (x->>4)::int, (x->>5)::int,
    coalesce(v.calories, 0), coalesce(v.protein, 0), coalesce(v.carbs, 0), coalesce(v.fat, 0)
  from jsonb_array_elements(j->'i') x
  join m_k mk on mk.idx = (x->>0)::int
  left join public.dishes d on d.id = x->>1
  left join public.dish_variants v on v.id = x->>2;

  -- wallets
  for r in select * from jsonb_array_elements(j->'w') loop
    insert into public.wallets (user_id, balance, base_balance, bonus_balance, active, admin_managed)
    select m.uid, (r->>1)::int, (r->>2)::int, (r->>3)::int, (r->>4)::boolean, (r->>5)::boolean
    from m_c m where m.idx = (r->>0)::int
    on conflict (user_id) do update set balance = excluded.balance, base_balance = excluded.base_balance,
      bonus_balance = excluded.bonus_balance, active = excluded.active, admin_managed = excluded.admin_managed;
  end loop;

  -- wallet plans
  for r in select * from jsonb_array_elements(j->'p') loop
    select w.id into v_wid from public.wallets w join m_c m on m.uid = w.user_id where m.idx = (r->>0)::int;
    if v_wid is null then
      insert into public.wallets (user_id) select uid from m_c where idx = (r->>0)::int returning id into v_wid;
    end if;
    insert into public.wallet_plans (wallet_id, goal, daily_kcal, macro_split, meal_breakfast, meal_lunch,
      meal_dinner, meal_snack, days_per_week, plan_length, plan_length_weeks, subtotal_cents, discount_cents,
      discount_pct, amount_to_pay_cents, bonus_pct, bonus_credits_cents, wallet_credit_cents, services,
      payment_method, payment_status, confirmed_at, activated_at, start_date, active_until, status,
      created_at, people, cost, credits, admin_note)
    values (v_wid, (r->>1)::goal, (r->>2)::int2, r->3, (r->>4)::boolean, (r->>5)::boolean,
      (r->>6)::boolean, (r->>7)::boolean, (r->>8)::int, (r->>9)::plan_length, (r->>10)::numeric,
      (r->>11)::int, (r->>12)::int, (r->>13)::numeric, (r->>14)::int, (r->>15)::int, (r->>16)::int,
      (r->>17)::int, r->18, (r->>19)::payment_method, (r->>20)::payment_status,
      (r->>21)::timestamptz, (r->>22)::timestamptz, (r->>23)::date, (r->>24)::date, r->>25,
      (r->>26)::timestamptz, (r->>27)::int, (r->>28)::int, (r->>29)::int, 'Seed από production (ανωνυμοποιημένο)')
    returning id into v_pid;
    update public.wallets set active_plan_id = v_pid where id = v_wid;
    v_wid := null;
  end loop;

  -- never mirror seeded rows to Airtable
  update public.orders set airtable_dirty = false where id in (select oid from m_o) and airtable_dirty;
  update public.wallet_plans wp set airtable_dirty = false
    from public.wallets w join m_c m on m.uid = w.user_id
    where wp.wallet_id = w.id and wp.airtable_dirty;
end
$loader$;

select (select count(*) from auth.users where email like 'ioustinos.sarris+dev%') users,
       (select count(*) from public.addresses) addresses,
       (select count(*) from public.orders where order_number like 'SD-%') orders,
       (select count(*) from public.child_orders) child_orders,
       (select count(*) from public.order_items) items,
       (select count(*) from public.order_items where dish_id is null) items_unmatched,
       (select count(*) from public.wallets) wallets,
       (select count(*) from public.wallet_plans) plans,
       (select count(*) from public.orders where airtable_dirty) dirty_orders,
       (select count(*) from public.wallet_plans where airtable_dirty) dirty_plans;
