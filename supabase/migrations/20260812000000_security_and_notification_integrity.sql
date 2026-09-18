begin;

-- A user may edit personal profile fields, but tenant, role, dealer, branch,
-- activation, and access-lifecycle fields remain server/admin owned.
create or replace function private.guard_self_app_user_security_fields()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if auth.uid() = old.id and (
    new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.role is distinct from old.role
    or new.dealer_id is distinct from old.dealer_id
    or new.branch_id is distinct from old.branch_id
    or new.is_active is distinct from old.is_active
    or new.status is distinct from old.status
    or new.organization_type is distinct from old.organization_type
    or new.invited_by is distinct from old.invited_by
    or new.invited_at is distinct from old.invited_at
    or new.role_changed_by is distinct from old.role_changed_by
    or new.role_changed_at is distinct from old.role_changed_at
    or new.deactivated_by is distinct from old.deactivated_by
    or new.deactivated_at is distinct from old.deactivated_at
  ) then
    raise exception 'Users cannot modify their own access scope or security status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_self_app_user_security_fields()
  from public, anon, authenticated;

drop trigger if exists guard_self_app_user_security_fields on public.app_users;
create trigger guard_self_app_user_security_fields
before update on public.app_users
for each row execute function private.guard_self_app_user_security_fields();

-- Explicit user targeting wins. Role broadcasts must match the current role;
-- dealer users may additionally see only company-wide or own-dealer messages.
-- For internal roles, dealer_id is business context rather than audience scope.
create or replace function private.notification_visible_to_current_user(
  p_company_id uuid,
  p_recipient_user_id uuid,
  p_recipient_role text,
  p_dealer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    auth.uid() is not null
    and p_company_id = private.get_current_user_company_id()
    and (
      p_recipient_user_id = auth.uid()
      or (
        p_recipient_user_id is null
        and (p_recipient_role is null or p_recipient_role = private.get_current_user_role())
        and (
          p_dealer_id is null
          or private.get_current_user_dealer_id() is null
          or p_dealer_id = private.get_current_user_dealer_id()
        )
      )
    ),
    false
  );
$$;

revoke all on function private.notification_visible_to_current_user(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function private.notification_visible_to_current_user(uuid, uuid, text, uuid)
  to authenticated;

drop policy if exists "notifications tenant read" on public.notifications;
create policy "notifications tenant read" on public.notifications
for select to authenticated
using (
  private.notification_visible_to_current_user(
    company_id,
    recipient_user_id,
    recipient_role,
    dealer_id
  )
);

-- Direct row updates remain limited to a user's explicitly targeted message.
-- Broadcast reads continue to use per-user receipts through the RPC below.
drop policy if exists "notifications tenant update" on public.notifications;
create policy "notifications tenant update" on public.notifications
for update to authenticated
using (
  recipient_user_id = auth.uid()
  and private.notification_visible_to_current_user(
    company_id,
    recipient_user_id,
    recipient_role,
    dealer_id
  )
)
with check (
  recipient_user_id = auth.uid()
  and private.notification_visible_to_current_user(
    company_id,
    recipient_user_id,
    recipient_role,
    dealer_id
  )
);

create or replace function public.mark_notification_read(p_notification_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid := private.get_current_user_company_id();
  v_recipient_user_id uuid;
  v_read_at timestamptz := now();
begin
  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select notification.recipient_user_id
  into v_recipient_user_id
  from public.notifications notification
  where notification.id = p_notification_id
    and private.notification_visible_to_current_user(
      notification.company_id,
      notification.recipient_user_id,
      notification.recipient_role,
      notification.dealer_id
    )
  for update;

  if not found then
    raise exception 'Notification not found for this user' using errcode = '42501';
  end if;

  if v_recipient_user_id is null then
    insert into public.notification_read_receipts(notification_id, user_id, company_id, read_at)
    values (p_notification_id, v_user_id, v_company_id, v_read_at)
    on conflict (notification_id, user_id)
    do update set read_at = excluded.read_at, company_id = excluded.company_id;
  else
    update public.notifications notification
    set is_read = true,
        read_at = coalesce(notification.read_at, v_read_at)
    where notification.id = p_notification_id
      and notification.company_id = v_company_id
      and notification.recipient_user_id = v_user_id;
  end if;

  return v_read_at;
end;
$$;

create or replace function public.get_unread_notification_count()
returns bigint
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid := private.get_current_user_company_id();
  v_count bigint;
begin
  if v_user_id is null or v_company_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select count(*)
  into v_count
  from public.notifications notification
  where private.notification_visible_to_current_user(
      notification.company_id,
      notification.recipient_user_id,
      notification.recipient_role,
      notification.dealer_id
    )
    and (
      (notification.recipient_user_id = v_user_id and notification.is_read = false)
      or (
        notification.recipient_user_id is null
        and not exists (
          select 1
          from public.notification_read_receipts receipt
          where receipt.notification_id = notification.id
            and receipt.user_id = v_user_id
            and receipt.company_id = v_company_id
        )
      )
    );

  return v_count;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.get_unread_notification_count() from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;

-- Use typed row variables so a billet linked only to a production job does
-- not access fields on an unassigned generic record.
create or replace function public.validate_foundry_billet_lineage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requirement public.order_billet_requirements%rowtype;
  v_job public.production_jobs%rowtype;
begin
  if new.allocation_requirement_id is not null then
    select *
    into v_requirement
    from public.order_billet_requirements
    where id = new.allocation_requirement_id
    for share;

    if not found or v_requirement.company_id <> new.company_id then
      raise exception 'Billet allocation requirement does not belong to the selected company' using errcode = '23514';
    end if;
    if new.order_id is distinct from v_requirement.order_id then
      raise exception 'Billet allocation order does not match its requirement' using errcode = '23514';
    end if;
    if lower(btrim(coalesce(new.alloy, ''))) <> lower(btrim(coalesce(v_requirement.alloy, '')))
      or lower(btrim(coalesce(new.temper, ''))) <> lower(btrim(coalesce(v_requirement.temper, '')))
      or new.billet_diameter_inch <> v_requirement.billet_diameter_inch then
      raise exception 'Billet alloy, temper, and diameter must match the order requirement' using errcode = '23514';
    end if;
  end if;

  if new.production_job_id is not null then
    select *
    into v_job
    from public.production_jobs
    where id = new.production_job_id
    for share;

    if not found or v_job.company_id <> new.company_id then
      raise exception 'Billet production job does not belong to the selected company' using errcode = '23514';
    end if;
    if new.order_id is distinct from v_job.order_id then
      raise exception 'Billet order does not match its production job' using errcode = '23514';
    end if;
    if new.allocation_requirement_id is not null
      and v_requirement.profile_id <> v_job.profile_id then
      raise exception 'Billet requirement does not match the production job profile' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_foundry_billet_lineage()
  from public, anon, authenticated;

-- Quote item rows are the authoritative source for all header aggregates.
-- This guard neutralizes direct header poisoning and remains compatible with
-- save_quote_atomic, whose final header update derives the same values.
create or replace function private.derive_quote_header_financials()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_subtotal numeric(14,2);
  v_profit numeric(14,2);
  v_low_margin boolean;
  v_gst_percent numeric(7,2);
  v_gst_amount numeric(14,2);
begin
  select
    round(coalesce(sum(item.line_total_before_gst), 0), 2),
    round(coalesce(sum(item.estimated_profit_amount), 0), 2),
    coalesce(bool_or(item.approval_required), false)
  into v_subtotal, v_profit, v_low_margin
  from public.quote_items item
  where item.company_id = new.company_id
    and item.quote_id = new.id;

  v_gst_percent := greatest(least(coalesce(new.gst_percent, 0), 100), 0);
  v_gst_amount := round(v_subtotal * v_gst_percent / 100, 2);

  new.gst_percent := v_gst_percent;
  new.subtotal := v_subtotal;
  new.total_margin_amount := v_profit;
  new.total_before_gst := v_subtotal;
  new.gst_amount := v_gst_amount;
  new.grand_total := v_subtotal + v_gst_amount;
  new.low_margin_approval_required := v_low_margin;
  new.estimated_profit_amount := v_profit;
  new.estimated_profit_percent := case
    when v_subtotal > 0 then round(v_profit / v_subtotal * 100, 2)
    else 0
  end;

  return new;
end;
$$;

revoke all on function private.derive_quote_header_financials()
  from public, anon, authenticated;

drop trigger if exists derive_quote_header_financials on public.quotes;
create trigger derive_quote_header_financials
before insert or update on public.quotes
for each row execute function private.derive_quote_header_financials();

create or replace function private.refresh_quote_header_after_item_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.quotes
    set updated_at = now()
    where id = old.quote_id
      and company_id = old.company_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    update public.quotes
    set updated_at = now()
    where id = new.quote_id
      and company_id = new.company_id;
  end if;

  return null;
end;
$$;

revoke all on function private.refresh_quote_header_after_item_change()
  from public, anon, authenticated;

drop trigger if exists refresh_quote_header_after_item_change on public.quote_items;
create trigger refresh_quote_header_after_item_change
after insert or update or delete on public.quote_items
for each row execute function private.refresh_quote_header_after_item_change();

commit;
