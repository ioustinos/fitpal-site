-- DEV ONLY (jrxxsixhxgawucorfyjt). Practice set for the Fitpal team
-- (Ioustinos 13/10/2026): maria@, faidra@, nena@, chris@fitpal.gr.
--  • each gets a dev login (admin, menu_order — same as prod for maria/faidra/
--    nena; chris has no prod account, given the same role),
--  • their own practice dietitian «Εξάσκηση — <Name>» (6% discount / 6%
--    commission, progress tracking + referral on, code praktiki-<name>),
--    with their login attached,
--  • 4 practice clients each, emails <name>+pelatisN@fitpal.gr:
--      1 active + consent + body data + targets + 250 € wallet
--      2 active, no consent yet
--      3 pending (existing customer — waits for client + Fitpal)
--      4 active + consent, body data empty (to practise filling it in)
-- Idempotent: re-running skips accounts that already exist.
do $seed$
declare
  ops jsonb := '[
    {"email":"maria@fitpal.gr","name":"Μαρία","full":"Μαρία (Fitpal)","code":"praktiki-maria","zip":"16675","area":"Γλυφάδα","clients":["Ελένη Παπαδοπούλου","Γιώργος Νικολάου","Κατερίνα Δημητρίου","Νίκος Αλεξίου"]},
    {"email":"faidra@fitpal.gr","name":"Φαίδρα","full":"Φαίδρα Μήλιου","code":"praktiki-faidra","zip":"15126","area":"Μαρούσι","clients":["Σοφία Κωνσταντίνου","Δημήτρης Ιωάννου","Άννα Γεωργίου","Πέτρος Μαυρίδης"]},
    {"email":"nena@fitpal.gr","name":"Νένα","full":"Nena Nydrioti","code":"praktiki-nena","zip":"10561","area":"Αθήνα","clients":["Μαρίνα Οικονόμου","Κώστας Βλάχος","Ειρήνη Σταύρου","Λευτέρης Παππάς"]},
    {"email":"chris@fitpal.gr","name":"Χρήστος","full":"Χρήστος (Fitpal)","code":"praktiki-chris","zip":"15236","area":"Νέα Πεντέλη","clients":["Βασιλική Τσάκου","Άρης Καραλής","Δέσποινα Ρήγα","Στέλιος Πετρίδης"]}
  ]';
  op jsonb; v_op uuid; v_pid uuid; v_c uuid; i int; cname text; cemail text; v_status text;
  streets text[] := array['Λεωφόρος Βουλιαγμένης 100','Κηφισίας 120','Ευριπίδου 11','Πεντέλης 64'];
begin
  for op in select * from jsonb_array_elements(ops) loop
    -- operator login
    select id into v_op from auth.users where lower(email) = op->>'email';
    if v_op is null then
      v_op := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_op, 'authenticated', 'authenticated', op->>'email', '', now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('name', op->>'full'), now(), now(), '', '', '', '');
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
      values (gen_random_uuid(), v_op::text, v_op, jsonb_build_object('sub', v_op::text, 'email', op->>'email', 'email_verified', true), 'email', now(), now());
      update profiles set name = op->>'full' where id = v_op;
    end if;
    insert into admin_users (user_id, role) select v_op, 'menu_order' where not exists (select 1 from admin_users where user_id = v_op);

    -- practice dietitian
    select id into v_pid from partners where referral_code = op->>'code';
    if v_pid is null then
      insert into partners (kind, name, default_commission_bps, default_discount_bps, is_internal, active, features, referral_code, email, notes)
      values ('dietitian', 'Εξάσκηση — ' || (op->>'name'), 600, 600, false, true,
              '{"progress_tracking":true,"referral":true,"notifications":false}', op->>'code', op->>'email',
              'Dev practice dietitian for ' || (op->>'email') || ' (user manual).')
      returning id into v_pid;
    end if;
    insert into partner_users (partner_id, user_id) select v_pid, v_op where not exists (select 1 from partner_users where user_id = v_op);

    -- practice clients
    for i in 1..4 loop
      cname := op->'clients'->>(i-1);
      cemail := split_part(op->>'email','@',1) || '+pelatis' || i || '@fitpal.gr';
      if exists (select 1 from auth.users where lower(email) = cemail) then continue; end if;
      v_c := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_c, 'authenticated', 'authenticated', cemail, '', now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('name', cname), now() - interval '60 days', now(), '', '', '', '');
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
      values (gen_random_uuid(), v_c::text, v_c, jsonb_build_object('sub', v_c::text, 'email', cemail, 'email_verified', true), 'email', now(), now());
      update profiles set name = cname, phone = '+30697' || lpad((1000000 + floor(random()*8999999))::int::text, 7, '0') where id = v_c;
      insert into addresses (user_id, label_el, label_en, street, area, zip, floor, doorbell, is_default, sort_order)
      values (v_c, 'Σπίτι', 'Home', streets[i], op->>'area', op->>'zip', (i)::text, cname, true, 0);
      if i in (1) then
        update profiles set sex = 'female', birth_year = 1988, height_cm = 165, weight_kg = 64, activity_level = 'moderate', goal = 'lose' where id = v_c;
        insert into client_targets (user_id, kcal, protein, carbs, fat, meals, updated_at) values (v_c, 1600, 100, 170, 55, '{}', now());
        insert into wallets (user_id, balance, base_balance, bonus_balance, active) values (v_c, 25000, 25000, 0, true)
          on conflict (user_id) do update set balance = 25000, base_balance = 25000, bonus_balance = 0, active = true;
      end if;
      v_status := case when i = 3 then 'pending' else 'active' end;
      insert into partner_clients (partner_id, client_user_id, status, discount_bps, commission_bps, created_via, created_by,
                                   client_confirmed_at, approved_at, consent_at)
      values (v_pid, v_c, v_status, 600, 600,
              case when i = 3 then 'partner_existing' else 'partner_new' end, v_op,
              case when i = 3 then null else now() end,
              case when i = 3 then null else now() end,
              case when i in (1,4) then now() else null end);
    end loop;
  end loop;
end
$seed$;
