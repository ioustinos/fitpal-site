-- WEC-703: vouchers can now target orders OR subscriptions (never both).
-- `applies_to` default 'orders' → all 127 existing vouchers (incl. the 118
-- GonnaOrder codes from WEC-527) stay food-order only. The CHECK enforces the
-- two-value invariant at the DB, not just the admin form.
alter table public.vouchers
  add column if not exists applies_to text not null default 'orders'
    check (applies_to in ('orders', 'subscriptions'));

-- Atomic redemption for a wallet plan — mirror of redeem_voucher_for_order but
-- writes wallet_plan_id, and rejects a non-subscriptions voucher (belt to the
-- validate-voucher braces).
create or replace function public.redeem_voucher_for_plan(
  p_voucher_id uuid, p_user_id uuid, p_wallet_plan_id uuid, p_amount_cents integer,
  p_email text, p_phone text
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_voucher record;
  v_uses int;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(p_phone, '');
begin
  select id, type, active, expires_at, max_uses, uses_count, per_user_limit, remaining, registered_only, applies_to
    into v_voucher from public.vouchers where id = p_voucher_id for update;

  if not found then raise exception 'voucher_not_found' using errcode = 'P0001'; end if;
  if not v_voucher.active then raise exception 'voucher_inactive' using errcode = 'P0001'; end if;
  if v_voucher.applies_to <> 'subscriptions' then raise exception 'voucher_wrong_scope' using errcode = 'P0001'; end if;
  if v_voucher.expires_at is not null and v_voucher.expires_at < now() then
    raise exception 'voucher_expired' using errcode = 'P0001';
  end if;
  if v_voucher.max_uses is not null and v_voucher.uses_count >= v_voucher.max_uses then
    raise exception 'voucher_max_uses_reached' using errcode = 'P0001';
  end if;
  if v_voucher.registered_only and p_user_id is null then
    raise exception 'voucher_registered_only' using errcode = 'P0001';
  end if;
  if v_voucher.per_user_limit is not null then
    select count(*)::int into v_uses
      from public.voucher_uses
      where voucher_id = p_voucher_id
        and (
             (p_user_id is not null and user_id = p_user_id)
          or (v_email is not null and email = v_email)
          or (v_phone is not null and phone = v_phone)
        );
    if v_uses >= v_voucher.per_user_limit then
      raise exception 'voucher_per_user_limit_reached' using errcode = 'P0001';
    end if;
  end if;
  if v_voucher.type = 'credit' and coalesce(v_voucher.remaining, 0) < p_amount_cents then
    raise exception 'voucher_insufficient_credit' using errcode = 'P0001';
  end if;

  insert into public.voucher_uses (voucher_id, user_id, wallet_plan_id, amount, email, phone)
    values (p_voucher_id, p_user_id, p_wallet_plan_id, p_amount_cents, v_email, v_phone);

  update public.vouchers
     set uses_count = uses_count + 1,
         remaining  = case when type = 'credit'
                           then greatest(0, coalesce(remaining, 0) - p_amount_cents)
                           else remaining end
   where id = p_voucher_id;
end;
$function$;

-- Un-redeem a plan's voucher use (mirror of unredeem_voucher_for_order).
create or replace function public.unredeem_voucher_for_plan(p_wallet_plan_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_use record;
begin
  select voucher_id, amount into v_use
    from public.voucher_uses where wallet_plan_id = p_wallet_plan_id for update;
  if not found then return; end if;
  update public.vouchers
     set uses_count = greatest(0, uses_count - 1),
         remaining  = case when type = 'credit'
                           then coalesce(remaining, 0) + v_use.amount
                           else remaining end
   where id = v_use.voucher_id;
  delete from public.voucher_uses where wallet_plan_id = p_wallet_plan_id;
end;
$function$;

grant execute on function public.redeem_voucher_for_plan(uuid, uuid, uuid, integer, text, text) to authenticated, anon, service_role;
grant execute on function public.unredeem_voucher_for_plan(uuid) to authenticated, service_role;

-- Scope guard on the ORDER redeem path too: a 'subscriptions' voucher must never
-- redeem against a food order, even if validation is bypassed. (Body otherwise
-- identical to the WEC-546 version — only the applies_to check is added.)
create or replace function public.redeem_voucher_for_order(
  p_voucher_id uuid, p_user_id uuid, p_order_id uuid, p_amount_cents integer,
  p_email text, p_phone text
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_voucher record;
  v_uses int;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(p_phone, '');
begin
  select id, type, active, expires_at, max_uses, uses_count, per_user_limit, remaining, registered_only, applies_to
    into v_voucher from public.vouchers where id = p_voucher_id for update;

  if not found then raise exception 'voucher_not_found' using errcode = 'P0001'; end if;
  if not v_voucher.active then raise exception 'voucher_inactive' using errcode = 'P0001'; end if;
  if v_voucher.applies_to <> 'orders' then raise exception 'voucher_wrong_scope' using errcode = 'P0001'; end if;
  if v_voucher.expires_at is not null and v_voucher.expires_at < now() then
    raise exception 'voucher_expired' using errcode = 'P0001';
  end if;
  if v_voucher.max_uses is not null and v_voucher.uses_count >= v_voucher.max_uses then
    raise exception 'voucher_max_uses_reached' using errcode = 'P0001';
  end if;
  if v_voucher.registered_only and p_user_id is null then
    raise exception 'voucher_registered_only' using errcode = 'P0001';
  end if;
  if v_voucher.per_user_limit is not null then
    select count(*)::int into v_uses
      from public.voucher_uses
      where voucher_id = p_voucher_id
        and (
             (p_user_id is not null and user_id = p_user_id)
          or (v_email is not null and email = v_email)
          or (v_phone is not null and phone = v_phone)
        );
    if v_uses >= v_voucher.per_user_limit then
      raise exception 'voucher_per_user_limit_reached' using errcode = 'P0001';
    end if;
  end if;
  if v_voucher.type = 'credit' and coalesce(v_voucher.remaining, 0) < p_amount_cents then
    raise exception 'voucher_insufficient_credit' using errcode = 'P0001';
  end if;

  insert into public.voucher_uses (voucher_id, user_id, order_id, amount, email, phone)
    values (p_voucher_id, p_user_id, p_order_id, p_amount_cents, v_email, v_phone);

  update public.vouchers
     set uses_count = uses_count + 1,
         remaining  = case when type = 'credit'
                           then greatest(0, coalesce(remaining, 0) - p_amount_cents)
                           else remaining end
   where id = p_voucher_id;
end;
$function$;
