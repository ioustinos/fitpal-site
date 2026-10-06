-- WEC-838: generic DB-level audit trail. Catches EVERY write (admin UI, API,
-- scheduled job, or a direct SQL change) to the core admin tables, with the
-- acting user, timestamp and before/after row. Built at the DB layer on purpose:
-- app-level logging would have missed the 2026-10-06 incident where a published
-- retail menu was moved to another storefront and nobody could tell who/when.
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  changed_at  timestamptz not null default now(),
  table_name  text not null,
  op          text not null,                      -- INSERT | UPDATE | DELETE
  row_pk      text,                               -- affected row id/key when present
  actor_uid   uuid,                               -- auth.uid() of the logged-in user
  actor_role  text,                               -- db role
  old_row     jsonb,
  new_row     jsonb
);
create index if not exists audit_log_table_time_idx on public.audit_log (table_name, changed_at desc);
create index if not exists audit_log_actor_idx      on public.audit_log (actor_uid, changed_at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_owner_read on public.audit_log;
create policy audit_log_owner_read on public.audit_log
  for select to authenticated using (public.current_admin_role() = 'owner');

create or replace function public.fn_audit_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pk text;
begin
  begin
    v_pk := case when tg_op = 'DELETE'
                 then coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'key')
                 else coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key') end;
    insert into public.audit_log(table_name, op, row_pk, actor_uid, actor_role, old_row, new_row)
    values (tg_table_name, tg_op, v_pk, auth.uid(), current_user,
            case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
            case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end);
  exception when others then null;   -- auditing must NEVER break the real write
  end;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'weekly_menus','menu_day_dishes','dishes','dish_variants','categories','tags',
    'dish_tags','settings','delivery_zones','zone_time_slots','stores'
  ] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit_log()', t);
  end loop;
end $$;
