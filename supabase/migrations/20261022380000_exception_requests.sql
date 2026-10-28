-- UPGRADE_EOS feature 45: approval requests at the point of restriction.
--
-- A company defines which restrictions may be lifted by exception (exception_policies):
--   * low_margin_quote  releasing a quotation below its minimum margin (today owners and admins
--                       only, through the existing guard). A quotation priced below cost, or short of
--                       the required margin by more than the policy allows, is never released by
--                       exception.
--   * overdue_dispatch  a new, opt-in hold: material is not dispatched to a customer with overdue
--                       receivables at or above the policy amount. Above the policy's hard limit the
--                       hold cannot be lifted by exception, only by collecting payment.
-- Beside the restriction, an eligible employee requests the exception with a reason. The request is
-- bound to a fingerprint of the record's content (quotation lines and totals; for a dispatch hold,
-- the order and its customer plus the weight to be dispatched) and appears to the policy's approver
-- roles. An approver other than the requester decides it against the version they saw; approval
-- lasts for the policy's validity period. The guards accept an approved, unexpired exception only
-- for that exact record and content: a dispatch hold exception covers one dispatch on that order of
-- at most the approved weight, while the overdue amount has not grown, and is used up by it.
-- Changed quantities, other records, an expired or withdrawn policy, and non-overridable limits are
-- all refused.
-- Additive: replaces private.guard_low_margin_quote_approval with an identical rule plus the
-- exception check, and adds one dispatch trigger that does nothing until a policy is enabled.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.exception_policies (
  company_id uuid not null references public.companies(id),
  exception_type text not null check (exception_type in ('low_margin_quote','overdue_dispatch')),
  is_active boolean not null default false,
  approver_roles text[] not null check (cardinality(approver_roles) between 1 and 4),
  validity_hours integer not null default 24 check (validity_hours between 1 and 168),
  overdue_days integer not null default 0 check (overdue_days between 0 and 365),
  min_overdue_amount numeric(14,2) not null default 1 check (min_overdue_amount > 0),
  hard_limit_amount numeric(14,2) check (hard_limit_amount is null or hard_limit_amount > 0),
  max_shortfall_points numeric(6,2) check (max_shortfall_points is null or max_shortfall_points between 0 and 100),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, exception_type),
  check (case exception_type when 'low_margin_quote' then approver_roles <@ array['owner','admin','sales_manager']
         else approver_roles <@ array['owner','admin','accounts','sales_manager'] end),
  check (hard_limit_amount is null or hard_limit_amount >= min_overdue_amount)
);
create index exception_policies_updated_by_idx on public.exception_policies(updated_by);

create table public.exception_requests (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  exception_type text not null check (exception_type in ('low_margin_quote','overdue_dispatch')),
  entity_type text not null check (entity_type in ('quote','order')),
  entity_id uuid not null,
  reference text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  detail jsonb not null,
  approved_exposure numeric(14,2),
  approved_weight_kg numeric(14,3) check (approved_weight_kg is null or approved_weight_kg > 0),
  consumed_at timestamptz,
  consumed_dispatch_id uuid,
  reason text not null check (length(btrim(reason)) between 10 and 500),
  return_path text not null check (return_path ~ '^/(quotes|orders)/[0-9a-f-]{36}$'),
  requested_by uuid not null references public.app_users(id),
  requested_by_name text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn','superseded')),
  decided_by uuid references public.app_users(id),
  decided_by_name text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  expires_at timestamptz,
  first_used_at timestamptz,
  check ((status = 'approved') = (expires_at is not null)),
  check ((status in ('approved','rejected')) = (decided_by is not null)),
  check ((exception_type = 'low_margin_quote') = (entity_type = 'quote')),
  check ((exception_type = 'overdue_dispatch') = (approved_weight_kg is not null))
);
create unique index exception_requests_one_pending on public.exception_requests(company_id, exception_type, entity_id) where status = 'pending';
create index exception_requests_entity_idx on public.exception_requests(company_id, entity_type, entity_id, requested_at desc);
create index exception_requests_status_idx on public.exception_requests(company_id, status, requested_at desc);
create index exception_requests_requested_by_idx on public.exception_requests(requested_by);
create index exception_requests_decided_by_idx on public.exception_requests(decided_by);

alter table public.exception_policies enable row level security;
alter table public.exception_requests enable row level security;
revoke all on public.exception_policies, public.exception_requests from public, anon, authenticated;
grant select on public.exception_policies, public.exception_requests to authenticated;
create policy exception_policies_read on public.exception_policies for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null);
create policy exception_requests_read on public.exception_requests for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and (requested_by = auth.uid() or exists (select 1 from public.exception_policies p where p.company_id = exception_requests.company_id
      and p.exception_type = exception_requests.exception_type and private.get_current_user_role() = any(p.approver_roles))));

-- Who may request each exception (they perform the restricted step but cannot lift it themselves).
create or replace function private.exception_requester_roles(p_type text)
returns text[] language sql immutable set search_path = public, private as $$
  select case p_type when 'low_margin_quote' then array['sales_manager','sales']
    when 'overdue_dispatch' then array['owner','admin','factory_manager','dispatch_manager','dispatch'] else array[]::text[] end
$$;
revoke all on function private.exception_requester_roles(text) from public, anon, authenticated;

-- Content fingerprints: what an approval covers. Status and timestamps are excluded so moving the
-- same content forward keeps the approval; any change to lines, totals, weight or bundles breaks it.
create or replace function private.exception_quote_fingerprint(q public.quotes)
returns text language sql stable security definer set search_path = public, private as $$
  select md5(concat_ws('|', q.id::text, q.customer_id::text, q.revision_number::text, q.grand_total::text, q.total_margin_amount::text,
    q.estimated_profit_amount::text, q.estimated_profit_percent::text, q.low_margin_approval_required::text,
    (select md5(coalesce(string_agg((to_jsonb(i) - 'created_at' - 'updated_at')::text, '|' order by i.id), '')) from public.quote_items i where i.quote_id = q.id and i.company_id = q.company_id)))
$$;
create or replace function private.exception_order_fingerprint(p_order uuid, p_customer uuid)
returns text language sql immutable set search_path = public, private as $$
  select md5(concat_ws('|', 'order', p_order::text, p_customer::text))
$$;
revoke all on function private.exception_quote_fingerprint(public.quotes), private.exception_order_fingerprint(uuid, uuid) from public, anon, authenticated;

-- Balance overdue for more than p_days on a customer's invoices.
create or replace function private.customer_overdue_amount(p_company uuid, p_customer uuid, p_days integer)
returns numeric language sql stable security definer set search_path = public, private as $$
  select coalesce(sum(i.balance_due), 0) from public.invoices i
  where i.company_id = p_company and i.customer_id = p_customer and i.deleted_at is null and i.balance_due > 0
    and i.status not in ('draft','paid','cancelled','credited') and i.due_date is not null
    and i.due_date + p_days < (now() at time zone 'Asia/Kolkata')::date
$$;
revoke all on function private.customer_overdue_amount(uuid, uuid, integer) from public, anon, authenticated;

-- The restriction on one record now: whether it applies, why, and whether an exception may lift it.
create or replace function private.exception_restriction(p_company uuid, p_type text, p_entity uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare p public.exception_policies%rowtype; q public.quotes%rowtype; v_order record; v_required numeric; v_shortfall numeric; v_overdue numeric;
begin
  select * into p from public.exception_policies where company_id = p_company and exception_type = p_type;
  if p_type = 'low_margin_quote' then
    select * into q from public.quotes where id = p_entity and company_id = p_company and deleted_at is null;
    if not found then return null; end if;
    select max(minimum_margin_percent) into v_required from public.quote_items where quote_id = q.id and company_id = p_company;
    v_shortfall := round(greatest(coalesce(v_required, 0) - coalesce(q.estimated_profit_percent, 0), 0), 2);
    return jsonb_build_object('entity_type', 'quote', 'reference', q.quote_number, 'restricted', coalesce(q.low_margin_approval_required, false),
      'reason', format('Margin %s%% is below the required %s%% (%s points short). Only owners and admins may release it.', trim_scale(coalesce(q.estimated_profit_percent, 0)), trim_scale(coalesce(v_required, 0)), trim_scale(v_shortfall)),
      'policy_active', coalesce(p.is_active, false),
      'blocker', case when not coalesce(p.is_active, false) then 'Your company has not enabled exceptions for low-margin quotations'
        when coalesce(q.estimated_profit_amount, 0) < 0 then 'A quotation priced below cost cannot be released by exception'
        when p.max_shortfall_points is not null and v_shortfall > p.max_shortfall_points then format('The margin is %s points short, more than the %s points an exception may cover', trim_scale(v_shortfall), trim_scale(p.max_shortfall_points)) end,
      'fingerprint', private.exception_quote_fingerprint(q), 'exposure', null,
      'detail', jsonb_build_object('quote_number', q.quote_number, 'revision', q.revision_number, 'grand_total', q.grand_total, 'margin_percent', q.estimated_profit_percent, 'required_percent', v_required, 'shortfall_points', v_shortfall));
  end if;
  select o.id, o.order_number, o.customer_id, coalesce(c.company_name, c.customer_name) customer_name into v_order
  from public.orders o left join public.customers c on c.id = o.customer_id and c.company_id = o.company_id where o.id = p_entity and o.company_id = p_company;
  if v_order.id is null then return null; end if;
  v_overdue := case when coalesce(p.is_active, false) then private.customer_overdue_amount(p_company, v_order.customer_id, p.overdue_days) else 0 end;
  return jsonb_build_object('entity_type', 'order', 'reference', v_order.order_number,
    'restricted', coalesce(p.is_active, false) and v_overdue >= p.min_overdue_amount,
    'reason', format('%s has INR %s overdue for more than %s days. Dispatches on this order are held until it is collected or an exception is approved.', coalesce(v_order.customer_name, 'The customer'), to_char(v_overdue, 'FM99999999990.00'), coalesce(p.overdue_days, 0)),
    'policy_active', coalesce(p.is_active, false),
    'blocker', case when p.hard_limit_amount is not null and v_overdue > p.hard_limit_amount
      then format('INR %s overdue is above the INR %s hard limit: collect payment before dispatching', to_char(v_overdue, 'FM99999999990.00'), to_char(p.hard_limit_amount, 'FM99999999990.00')) end,
    'fingerprint', private.exception_order_fingerprint(v_order.id, v_order.customer_id), 'exposure', v_overdue,
    'detail', jsonb_build_object('order_number', v_order.order_number, 'customer', v_order.customer_name, 'overdue_amount', v_overdue));
end;
$$;
revoke all on function private.exception_restriction(uuid, text, uuid) from public, anon, authenticated;

-- Whether an approved, unexpired exception covers this exact content: 'ok', 'none', 'changed'
-- (approved for different content), 'exposure_grown' or 'weight_exceeded'. A dispatch hold
-- exception (p_dispatch given) is used up by the dispatch it lets through; a quotation exception
-- keeps covering the same version as it moves forward. Records first use.
create or replace function private.exception_check(p_company uuid, p_type text, p_entity uuid, p_fingerprint text, p_exposure numeric, p_weight numeric, p_dispatch uuid)
returns text language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_live boolean;
begin
  if not exists (select 1 from public.exception_policies where company_id = p_company and exception_type = p_type and is_active) then return 'none'; end if;
  select id into v_id from public.exception_requests
  where company_id = p_company and exception_type = p_type and entity_id = p_entity and status = 'approved' and expires_at > now() and consumed_at is null
    and fingerprint = p_fingerprint and (p_exposure is null or p_exposure <= approved_exposure) and (p_weight is null or p_weight <= approved_weight_kg)
  order by decided_at desc limit 1;
  if v_id is not null then
    update public.exception_requests set first_used_at = coalesce(first_used_at, now()),
      consumed_at = case when p_dispatch is not null then now() end, consumed_dispatch_id = p_dispatch where id = v_id;
    return 'ok';
  end if;
  select true into v_live from public.exception_requests
  where company_id = p_company and exception_type = p_type and entity_id = p_entity and status = 'approved' and expires_at > now() and consumed_at is null limit 1;
  if not coalesce(v_live, false) then return 'none'; end if;
  if not exists (select 1 from public.exception_requests where company_id = p_company and exception_type = p_type and entity_id = p_entity and status = 'approved'
                 and expires_at > now() and consumed_at is null and fingerprint = p_fingerprint) then return 'changed'; end if;
  if p_exposure is not null and not exists (select 1 from public.exception_requests where company_id = p_company and exception_type = p_type and entity_id = p_entity
                 and status = 'approved' and expires_at > now() and consumed_at is null and fingerprint = p_fingerprint and p_exposure <= approved_exposure) then return 'exposure_grown'; end if;
  return 'weight_exceeded';
end;
$$;
revoke all on function private.exception_check(uuid, text, uuid, text, numeric, numeric, uuid) from public, anon, authenticated;

-- The existing low-margin rule, unchanged, plus an approved exception for this exact version.
create or replace function private.guard_low_margin_quote_approval()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_required numeric; p public.exception_policies%rowtype; v_check text;
begin
  if auth.uid() is not null and old.low_margin_approval_required and new.status in ('approved_for_sending','sent','customer_approved')
    and private.get_current_user_role() not in ('owner','admin') then
    select * into p from public.exception_policies where company_id = new.company_id and exception_type = 'low_margin_quote' and is_active;
    select max(minimum_margin_percent) into v_required from public.quote_items where quote_id = new.id and company_id = new.company_id;
    -- Non-overridable limits are rechecked at use, not only when the request was approved.
    if p.company_id is not null and coalesce(new.estimated_profit_amount, 0) >= 0
       and (p.max_shortfall_points is null or greatest(coalesce(v_required, 0) - coalesce(new.estimated_profit_percent, 0), 0) <= p.max_shortfall_points) then
      v_check := private.exception_check(new.company_id, 'low_margin_quote', new.id, private.exception_quote_fingerprint(new), null, null, null);
      if v_check = 'ok' then return new; end if;
      if v_check = 'changed' then raise exception 'The quotation changed after its exception was approved. Request an exception for this version' using errcode='42501'; end if;
    end if;
    raise exception 'Only owners and admins may approve low-margin quotations' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_low_margin_quote_approval() from public, anon, authenticated;

-- Opt-in dispatch hold for overdue receivables, evaluated from the row being saved (new dispatches
-- are inserted already dispatched).
create or replace function private.guard_overdue_dispatch()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare p public.exception_policies%rowtype; v_customer uuid; v_overdue numeric; v_check text; v_weight numeric;
begin
  if new.delivery_status in ('dispatched','in_transit','delivered') and (tg_op = 'INSERT' or old.delivery_status not in ('dispatched','in_transit','delivered')) then
    select * into p from public.exception_policies where company_id = new.company_id and exception_type = 'overdue_dispatch' and is_active;
    if not found then return new; end if;
    select customer_id into v_customer from public.orders where id = new.order_id and company_id = new.company_id;
    v_overdue := private.customer_overdue_amount(new.company_id, v_customer, p.overdue_days);
    if v_overdue < p.min_overdue_amount then return new; end if;
    if p.hard_limit_amount is not null and v_overdue > p.hard_limit_amount then
      raise exception 'Dispatch held: INR % overdue is above the INR % hard limit. Collect payment before dispatching',
        to_char(v_overdue, 'FM99999999990.00'), to_char(p.hard_limit_amount, 'FM99999999990.00') using errcode = '23514';
    end if;
    v_check := private.exception_check(new.company_id, 'overdue_dispatch', new.order_id, private.exception_order_fingerprint(new.order_id, v_customer), v_overdue, coalesce(new.total_weight_kg, 0), new.id);
    if v_check = 'ok' then return new; end if;
    if v_check = 'changed' then raise exception 'The order changed after its exception was approved. Request an exception again' using errcode = '23514'; end if;
    if v_check = 'exposure_grown' then raise exception 'More has fallen overdue since the exception was approved (now INR %). Request a new exception', to_char(v_overdue, 'FM99999999990.00') using errcode = '23514'; end if;
    if v_check = 'weight_exceeded' then
      select approved_weight_kg into v_weight from public.exception_requests where company_id = new.company_id and exception_type = 'overdue_dispatch' and entity_id = new.order_id
        and status = 'approved' and expires_at > now() and consumed_at is null order by decided_at desc limit 1;
      raise exception 'This dispatch (% kg) is more than the % kg the exception approved', trim_scale(new.total_weight_kg), trim_scale(v_weight) using errcode = '23514';
    end if;
    raise exception 'Dispatch held: INR % is overdue for more than % days. Collect payment or request an exception', to_char(v_overdue, 'FM99999999990.00'), p.overdue_days using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_overdue_dispatch() from public, anon, authenticated;
drop trigger if exists b_guard_overdue_dispatch on public.dispatches;
create trigger b_guard_overdue_dispatch before insert or update of delivery_status on public.dispatches for each row execute function private.guard_overdue_dispatch();

create or replace function public.exception_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text; v_type text; v_entity uuid; v_restriction jsonb; r public.exception_requests%rowtype; p public.exception_policies%rowtype;
  v_roles text[]; v_text text; v_superseded text; v_page integer; v_total bigint; v_rows jsonb; v_role_target text; v_weight numeric;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid exception request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if v_name is null or p_command not in ('policy.list','policy.set','restriction.check','request.create','request.list','request.decide','request.withdraw')
     or (p_command = 'policy.set' and v_role not in ('owner','admin')) then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  v_type := p_payload ->> 'exception_type';
  begin
    v_entity := nullif(p_payload ->> 'entity_id', '')::uuid;
    v_page := coalesce((p_payload ->> 'page')::integer, 1);
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid exception request'; end;

  if p_command = 'policy.list' then
    return coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' order by x.exception_type) from public.exception_policies x where x.company_id = v_company), '[]'::jsonb);

  elsif p_command = 'policy.set' then
    if v_type not in ('low_margin_quote','overdue_dispatch') then raise exception 'Choose a supported exception'; end if;
    if jsonb_typeof(p_payload -> 'approver_roles') is distinct from 'array' then raise exception 'Choose who approves these exceptions'; end if;
    select coalesce(array_agg(distinct value), '{}') into v_roles from jsonb_array_elements_text(p_payload -> 'approver_roles');
    begin
      insert into public.exception_policies(company_id, exception_type, is_active, approver_roles, validity_hours, overdue_days, min_overdue_amount, hard_limit_amount, max_shortfall_points, updated_by)
      values (v_company, v_type, coalesce((p_payload ->> 'is_active')::boolean, false), v_roles, coalesce((p_payload ->> 'validity_hours')::integer, 24),
        coalesce((p_payload ->> 'overdue_days')::integer, 0), coalesce((p_payload ->> 'min_overdue_amount')::numeric, 1), nullif(p_payload ->> 'hard_limit_amount', '')::numeric,
        nullif(p_payload ->> 'max_shortfall_points', '')::numeric, v_actor)
      on conflict (company_id, exception_type) do update set is_active = excluded.is_active, approver_roles = excluded.approver_roles, validity_hours = excluded.validity_hours,
        overdue_days = excluded.overdue_days, min_overdue_amount = excluded.min_overdue_amount, hard_limit_amount = excluded.hard_limit_amount,
        max_shortfall_points = excluded.max_shortfall_points, updated_by = v_actor, updated_at = now();
    exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Choose approvers allowed for this exception, a validity of 1 to 168 hours, and limits that are positive (the hard limit at or above the minimum)';
    end;
    return (select to_jsonb(x) - 'company_id' from public.exception_policies x where x.company_id = v_company and x.exception_type = v_type);

  elsif p_command in ('restriction.check','request.create') then
    if v_type not in ('low_margin_quote','overdue_dispatch') or v_entity is null then raise exception 'Invalid exception request'; end if;
    v_restriction := private.exception_restriction(v_company, v_type, v_entity);
    if v_restriction is null then raise exception 'Record is unavailable'; end if;
    select * into p from public.exception_policies where company_id = v_company and exception_type = v_type;
    if p_command = 'restriction.check' then
      return v_restriction - 'fingerprint' || jsonb_build_object('can_request', (v_restriction ->> 'restricted')::boolean and v_restriction ->> 'blocker' is null and v_role = any(private.exception_requester_roles(v_type)),
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'status', case when x.consumed_at is not null then 'used' when x.status = 'approved' and x.expires_at <= now() then 'expired' else x.status end, 'weight_kg', x.approved_weight_kg,
            'requested_by_name', x.requested_by_name, 'requested_at', x.requested_at, 'decided_by_name', x.decided_by_name, 'decision_note', x.decision_note, 'expires_at', x.expires_at,
            'covers_current', x.fingerprint = v_restriction ->> 'fingerprint') order by x.requested_at desc)
          from (select * from public.exception_requests where company_id = v_company and exception_type = v_type and entity_id = v_entity order by requested_at desc limit 5) x), '[]'::jsonb));
    end if;
    if not (v_role = any(private.exception_requester_roles(v_type))) then raise exception 'Your role does not perform this step, so it cannot request this exception' using errcode = '42501'; end if;
    begin r.id := (p_payload ->> 'id')::uuid; exception when invalid_text_representation then raise exception 'Invalid exception request'; end;
    if r.id is null then raise exception 'Invalid exception request'; end if;
    if exists (select 1 from public.exception_requests where id = r.id) then
      if exists (select 1 from public.exception_requests where id = r.id and requested_by = v_actor and entity_id = v_entity) then return jsonb_build_object('id', r.id, 'replayed', true); end if;
      raise exception 'Invalid exception request';
    end if;
    if not (v_restriction ->> 'restricted')::boolean then raise exception 'This record is not restricted, so no exception is needed'; end if;
    if v_restriction ->> 'blocker' is not null then raise exception '%', v_restriction ->> 'blocker'; end if;
    v_text := btrim(coalesce(p_payload ->> 'reason', ''));
    if length(v_text) not between 10 and 500 then raise exception 'Explain why the exception is needed (10 to 500 characters)'; end if;
    if v_type = 'overdue_dispatch' then
      begin v_weight := (p_payload ->> 'weight_kg')::numeric; exception when invalid_text_representation then v_weight := null; end;
      if v_weight is null or v_weight <= 0 or v_weight > 1000000 then raise exception 'Enter the weight to dispatch in kg'; end if;
    end if;
    if exists (select 1 from public.exception_requests where company_id = v_company and exception_type = v_type and entity_id = v_entity and status = 'approved'
               and expires_at > now() and consumed_at is null and fingerprint = v_restriction ->> 'fingerprint') then
      raise exception 'An approved exception already covers this version';
    end if;
    begin
      insert into public.exception_requests(id, company_id, exception_type, entity_type, entity_id, reference, fingerprint, detail, approved_exposure, approved_weight_kg, reason, return_path, requested_by, requested_by_name)
      values (r.id, v_company, v_type, v_restriction ->> 'entity_type', v_entity, coalesce(v_restriction ->> 'reference', 'record'), v_restriction ->> 'fingerprint',
        v_restriction -> 'detail' || case when v_weight is null then '{}'::jsonb else jsonb_build_object('weight_kg', v_weight) end,
        (v_restriction ->> 'exposure')::numeric, v_weight, v_text, case when v_type = 'low_margin_quote' then '/quotes/' else '/orders/' end || v_entity, v_actor, v_name);
    exception when unique_violation then raise exception 'An exception request for this record is already waiting for a decision'; end;
    foreach v_role_target in array p.approver_roles loop
      insert into public.notifications(company_id, recipient_role, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
      values (v_company, v_role_target, 'exception_request', 'warning',
        left(format('Exception requested: %s %s', case when v_type = 'low_margin_quote' then 'low-margin quotation' else 'dispatch hold on order' end, coalesce(v_restriction ->> 'reference', '')), 200),
        concat(v_name, ': ', v_text), v_restriction ->> 'entity_type', v_entity, v_actor, '/tasks/approvals#exceptions');
    end loop;
    return jsonb_build_object('id', r.id, 'replayed', false);

  elsif p_command = 'request.list' then
    if v_page < 1 or v_page > 100000 or coalesce(p_payload ->> 'view', 'to_decide') not in ('to_decide','mine','decided') then raise exception 'Invalid page'; end if;
    with visible as (
      select x.*, private.exception_restriction(x.company_id, x.exception_type, x.entity_id) now_state from public.exception_requests x
      where x.company_id = v_company and case coalesce(p_payload ->> 'view', 'to_decide')
        when 'to_decide' then x.status = 'pending' and x.requested_by <> v_actor and v_role = any(coalesce((select approver_roles from public.exception_policies where company_id = v_company and exception_type = x.exception_type), '{}'::text[]))
        when 'mine' then x.requested_by = v_actor
        else x.status <> 'pending' and v_role = any(coalesce((select approver_roles from public.exception_policies where company_id = v_company and exception_type = x.exception_type), '{}'::text[])) end
    )
    select (select count(*) from visible),
      coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'exception_type', v.exception_type, 'entity_type', v.entity_type, 'entity_id', v.entity_id, 'reference', v.reference,
          'detail', v.detail, 'reason', v.reason, 'return_path', v.return_path, 'requested_by_name', v.requested_by_name, 'requested_at', v.requested_at,
          'status', case when v.consumed_at is not null then 'used' when v.status = 'approved' and v.expires_at <= now() then 'expired' else v.status end, 'decided_by_name', v.decided_by_name, 'decided_at', v.decided_at, 'weight_kg', v.approved_weight_kg,
          'decision_note', v.decision_note, 'expires_at', v.expires_at, 'first_used_at', v.first_used_at, 'version', v.fingerprint,
          'current', v.now_state is not null and v.now_state ->> 'fingerprint' = v.fingerprint, 'blocker', v.now_state ->> 'blocker',
          'current_detail', case when v.now_state is not null and v.now_state ->> 'fingerprint' <> v.fingerprint then v.now_state -> 'detail' end) order by v.requested_at desc, v.id)
        from (select * from visible order by requested_at desc, id limit 10 offset (v_page - 1) * 10) v), '[]'::jsonb)
    into v_total, v_rows;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);
  end if;

  -- request.decide / request.withdraw
  select * into r from public.exception_requests where id = nullif(p_payload ->> 'id', '')::uuid and company_id = v_company for update;
  if not found then raise exception 'Exception request is unavailable'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided or withdrawn'; end if;
  if p_command = 'request.withdraw' then
    if r.requested_by <> v_actor then raise exception 'Only the requester can withdraw this request' using errcode = '42501'; end if;
    update public.exception_requests set status = 'withdrawn' where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'withdrawn');
  end if;
  select * into p from public.exception_policies where company_id = v_company and exception_type = r.exception_type;
  if not coalesce(p.is_active, false) or not (v_role = any(p.approver_roles)) then raise exception 'Your role cannot decide this exception' using errcode = '42501'; end if;
  if r.requested_by = v_actor then raise exception 'Another person must decide an exception you requested' using errcode = '42501'; end if;
  if coalesce(p_payload ->> 'decision', '') not in ('approve','reject') then raise exception 'Choose approve or reject'; end if;
  v_text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  if p_payload ->> 'decision' = 'reject' and length(coalesce(v_text, '')) < 3 then raise exception 'Say why the exception is rejected (3 to 500 characters)'; end if;
  if length(coalesce(v_text, '')) > 500 then raise exception 'Say why the exception is rejected (3 to 500 characters)'; end if;
  if coalesce(p_payload ->> 'version', '') <> r.fingerprint then raise exception 'You are deciding a different version than the one requested. Reload the request'; end if;
  v_restriction := private.exception_restriction(v_company, r.exception_type, r.entity_id);
  if p_payload ->> 'decision' = 'approve' then
    -- A request whose record moved on is closed as superseded (not approved) and the requester is told.
    v_superseded := case when v_restriction is null or v_restriction ->> 'fingerprint' <> r.fingerprint then 'The record changed after the request'
      when r.exception_type = 'overdue_dispatch' and (v_restriction ->> 'exposure')::numeric > r.approved_exposure then 'More fell overdue after the request' end;
    if v_superseded is not null then
      update public.exception_requests set status = 'superseded', decision_note = v_superseded where id = r.id;
      insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
      values (v_company, r.requested_by, 'exception_decided', 'warning', left('Exception needs a new request: ' || r.reference, 200), concat(v_superseded, '. Request again for the current version.'),
        r.entity_type, r.entity_id, v_actor, r.return_path);
      return jsonb_build_object('id', r.id, 'status', 'superseded', 'message', v_superseded || '. The requester must ask again for the current version.');
    end if;
    if v_restriction ->> 'blocker' is not null then raise exception '%', v_restriction ->> 'blocker'; end if;
  end if;
  update public.exception_requests set status = case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, decided_by = v_actor, decided_by_name = v_name,
    decided_at = now(), decision_note = v_text, expires_at = case when p_payload ->> 'decision' = 'approve' then now() + make_interval(hours => p.validity_hours) end
  where id = r.id;
  insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, created_by, action_link)
  values (v_company, r.requested_by, 'exception_decided', case when p_payload ->> 'decision' = 'approve' then 'success' else 'warning' end,
    left(format('Exception %s: %s', case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, r.reference), 200),
    concat(v_name, case when p_payload ->> 'decision' = 'approve' then format(' approved it for %s hours. Continue the paused work.', p.validity_hours) else ': ' || v_text end),
    r.entity_type, r.entity_id, v_actor, r.return_path);
  return jsonb_build_object('id', r.id, 'status', case when p_payload ->> 'decision' = 'approve' then 'approved' else 'rejected' end, 'message', null);
end;
$$;
revoke all on function public.exception_command(text, jsonb) from public, anon;
grant execute on function public.exception_command(text, jsonb) to authenticated;

commit;
