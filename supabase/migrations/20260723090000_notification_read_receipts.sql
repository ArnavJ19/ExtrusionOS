begin;

create table if not exists public.notification_read_receipts (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_read_receipts_company_user_idx
  on public.notification_read_receipts(company_id, user_id, read_at desc);

alter table public.notification_read_receipts enable row level security;

drop policy if exists "notifications tenant read" on public.notifications;
create policy "notifications tenant read" on public.notifications
for select to authenticated
using (
  company_id = private.get_current_user_company_id()
  and (
    recipient_user_id is null
    or recipient_user_id = auth.uid()
    or private.get_current_user_role() in ('owner', 'admin')
  )
);

drop policy if exists "notification receipts own read" on public.notification_read_receipts;
create policy "notification receipts own read" on public.notification_read_receipts
for select to authenticated
using (
  user_id = auth.uid()
  and company_id = private.get_current_user_company_id()
);

-- Receipt creation is kept behind mark_notification_read so callers cannot
-- manufacture a receipt for an inaccessible or cross-company notification.
revoke all on table public.notification_read_receipts from anon, authenticated;
grant select on table public.notification_read_receipts to authenticated;

-- A broadcast is shared company data. Ordinary recipients must never update
-- that shared row just to clear it from their own inbox.
drop policy if exists "notifications tenant update" on public.notifications;
create policy "notifications tenant update" on public.notifications
for update to authenticated
using (
  company_id = private.get_current_user_company_id()
  and (recipient_user_id = auth.uid() or private.get_current_user_role() in ('owner', 'admin'))
)
with check (
  company_id = private.get_current_user_company_id()
  and (recipient_user_id = auth.uid() or private.get_current_user_role() in ('owner', 'admin'))
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

  select recipient_user_id
  into v_recipient_user_id
  from public.notifications
  where id = p_notification_id
    and company_id = v_company_id
    and (recipient_user_id is null or recipient_user_id = v_user_id)
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
    update public.notifications
    set is_read = true,
        read_at = coalesce(read_at, v_read_at)
    where id = p_notification_id
      and company_id = v_company_id
      and recipient_user_id = v_user_id;
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
  where notification.company_id = v_company_id
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

comment on table public.notification_read_receipts is
  'Per-user read state for company-wide notification broadcasts. Targeted notifications retain their row-level is_read state.';

commit;
