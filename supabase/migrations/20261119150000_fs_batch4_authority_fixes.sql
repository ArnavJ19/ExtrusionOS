-- FS-75 follow-up (PR #11 review). Three fixes to the delegation-of-authority matrix in 20261119140000:
--  1. save_rule / delegate: JSON null in a role or type list (the screen sends second_approver_roles: null for a
--     single-approver rule) is treated as an empty list instead of failing with "cannot extract elements from a scalar".
--  2. The second approval is authorised against the rule's second-approver roles, not the first-approver roles. With
--     first = sales_manager and second = owner, the owner can now see and complete a held request.
--  3. Quotation and expense approvals (the types the matrix enforces today) are decided in the approval inbox, which
--     only owner, admin, sales_manager and accounts can open. Rules and delegations for those types are limited to
--     those roles, so no request can end up with an approver who cannot reach it.
-- Additive: replaces function bodies only; no table or data changes.

-- Whether p_actor may give approval step p_step (1 = first or only approval, 2 = second approval) for a p_type
-- transaction of p_amount raised by p_requester, today.
create or replace function private.authority_check_step(p_company uuid, p_type text, p_amount numeric, p_actor uuid, p_requester uuid, p_step integer)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare r public.authority_rules%rowtype; v_role text; v_delegation uuid; v_today date := private.business_today(); v_roles text[]; v_requires boolean;
begin
  if not exists (select 1 from public.authority_rules where company_id = p_company and transaction_type = p_type and retired_at is null) then
    return jsonb_build_object('configured', false);
  end if;
  select * into r from public.authority_rules
  where company_id = p_company and transaction_type = p_type and retired_at is null
    and coalesce(p_amount, 0) >= min_amount and (max_amount is null or coalesce(p_amount, 0) < max_amount)
  order by min_amount desc limit 1;
  if r.id is null then
    return jsonb_build_object('configured', true, 'allowed', false, 'reason', 'No approval band covers INR ' || to_char(coalesce(p_amount, 0), 'FM999999999990.00') || ' for this transaction type.');
  end if;
  v_requires := r.second_approver_from is not null and coalesce(p_amount, 0) >= r.second_approver_from;
  v_roles := case when p_step = 2 then coalesce(r.second_approver_roles, r.approver_roles) else r.approver_roles end;
  if p_requester is not null and p_requester = p_actor then
    return jsonb_build_object('configured', true, 'allowed', false, 'rule_id', r.id, 'requires_second', v_requires, 'reason', 'Nobody approves their own entry.');
  end if;
  select role into v_role from public.app_users where id = p_actor and company_id = p_company and is_active;
  if v_role = any(v_roles) then
    return jsonb_build_object('configured', true, 'allowed', true, 'rule_id', r.id, 'role', v_role, 'step', p_step,
      'requires_second', v_requires, 'second_roles', to_jsonb(coalesce(r.second_approver_roles, r.approver_roles)));
  end if;
  -- Standing in for someone on leave: the delegator's role counts, for the dates and types delegated.
  select d.id, u.role into v_delegation, v_role from public.authority_delegations d join public.app_users u on u.id = d.from_user and u.company_id = p_company and u.is_active
  where d.company_id = p_company and d.to_user = p_actor and d.revoked_at is null and v_today between d.starts_on and d.ends_on
    and (d.transaction_types is null or p_type = any(d.transaction_types)) and u.role = any(v_roles) and d.from_user is distinct from p_requester
  order by d.created_at limit 1;
  if v_delegation is not null then
    return jsonb_build_object('configured', true, 'allowed', true, 'rule_id', r.id, 'role', v_role, 'via_delegation', v_delegation, 'step', p_step,
      'requires_second', v_requires, 'second_roles', to_jsonb(coalesce(r.second_approver_roles, r.approver_roles)));
  end if;
  return jsonb_build_object('configured', true, 'allowed', false, 'rule_id', r.id, 'requires_second', v_requires,
    'reason', case when p_step = 2 then 'The second approval must come from: ' || array_to_string(v_roles, ', ') || '.'
      else 'Your role does not approve this amount: ' || array_to_string(v_roles, ', ') || ' do.' end);
end;
$$;
revoke all on function private.authority_check_step(uuid, text, numeric, uuid, uuid, integer) from public, anon, authenticated;

-- Kept for any caller of the original signature: the first (or only) approval.
create or replace function private.authority_check(p_company uuid, p_type text, p_amount numeric, p_actor uuid, p_requester uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select private.authority_check_step(p_company, p_type, p_amount, p_actor, p_requester, 1);
$$;
revoke all on function private.authority_check(uuid, text, numeric, uuid, uuid) from public, anon, authenticated;

-- The approval inbox lists a request for anyone who may give either step. Which step is due is checked when the
-- decision is applied (private.authority_enforce), where the pending first approval is known.
create or replace function private.approval_role_allowed(p_role text, p_type text, p_low_margin boolean, p_amount numeric)
returns boolean language plpgsql stable security definer set search_path = public, private as $$
declare v jsonb; v_type text := case when p_type = 'quote' and coalesce(p_low_margin, false) then 'low_margin_quote' else p_type end; v_company uuid := private.get_current_user_company_id();
begin
  v := private.authority_check_step(v_company, v_type, p_amount, auth.uid(), null, 1);
  if coalesce((v ->> 'configured')::boolean, false) then
    if coalesce((v ->> 'allowed')::boolean, false) then return true; end if;
    if not coalesce((v ->> 'requires_second')::boolean, false) then return false; end if;
    return coalesce((private.authority_check_step(v_company, v_type, p_amount, auth.uid(), null, 2) ->> 'allowed')::boolean, false);
  end if;
  return case p_type
    when 'quote' then p_role in ('owner','admin') or (p_role = 'sales_manager' and not coalesce(p_low_margin, false))
    when 'expense' then p_role in ('owner','admin') or (p_role = 'accounts' and coalesce(p_amount, 0) <= private.expense_approval_threshold())
    else false end;
end;
$$;
revoke all on function private.approval_role_allowed(text, text, boolean, numeric) from public, anon, authenticated;

-- Enforcement at the record. When a first approval is already held on this version and the rule needs a second
-- approver, the actor is checked against the second-approver roles; otherwise against the first-approver roles.
create or replace function private.authority_enforce(p_company uuid, p_type text, p_source_type text, p_source uuid, p_version text, p_hold_version text, p_amount numeric, p_requester uuid)
returns boolean language plpgsql security definer set search_path = public, private as $$
declare v jsonb; v_actor uuid := auth.uid(); v_first public.authority_approvals%rowtype; v_name text; v_role text;
begin
  if v_actor is null then return true; end if;
  v := private.authority_check_step(p_company, p_type, p_amount, v_actor, p_requester, 1);
  if not coalesce((v ->> 'configured')::boolean, false) then return true; end if;
  select * into v_first from public.authority_approvals where company_id = p_company and source_type = p_source_type and source_id = p_source
    and source_version = p_version and step = 1 and not completes order by approved_at desc limit 1;
  if v_first.id is not null and coalesce((v ->> 'requires_second')::boolean, false) then
    if v_first.approver_id = v_actor then raise exception 'AP: A second, different person must approve this amount.' using errcode = '42501'; end if;
    v := private.authority_check_step(p_company, p_type, p_amount, v_actor, p_requester, 2);
  end if;
  if not coalesce((v ->> 'allowed')::boolean, false) then raise exception 'AP: %', v ->> 'reason' using errcode = '42501'; end if;
  select coalesce(nullif(btrim(full_name), ''), email), role into v_name, v_role from public.app_users where id = v_actor;
  if not coalesce((v ->> 'requires_second')::boolean, false) then
    insert into public.authority_approvals(company_id, transaction_type, source_type, source_id, source_version, amount, rule_id, step, completes, approver_id, approver_name, approver_role, via_delegation, requester_id)
    values (p_company, p_type, p_source_type, p_source, p_version, p_amount, (v ->> 'rule_id')::uuid, 1, true, v_actor, v_name, v_role, (v ->> 'via_delegation')::uuid, p_requester);
    return true;
  end if;
  if v_first.id is null then
    insert into public.authority_approvals(company_id, transaction_type, source_type, source_id, source_version, amount, rule_id, step, completes, approver_id, approver_name, approver_role, via_delegation, requester_id)
    values (p_company, p_type, p_source_type, p_source, p_hold_version, p_amount, (v ->> 'rule_id')::uuid, 1, false, v_actor, v_name, v_role, (v ->> 'via_delegation')::uuid, p_requester);
    return false;
  end if;
  insert into public.authority_approvals(company_id, transaction_type, source_type, source_id, source_version, amount, rule_id, step, completes, approver_id, approver_name, approver_role, via_delegation, requester_id)
  values (p_company, p_type, p_source_type, p_source, p_version, p_amount, (v ->> 'rule_id')::uuid, 2, true, v_actor, v_name, v_role, (v ->> 'via_delegation')::uuid, p_requester);
  return true;
end;
$$;
revoke all on function private.authority_enforce(uuid, text, text, uuid, text, text, numeric, uuid) from public, anon, authenticated;

-- JSON array or nothing: null, a missing key or a scalar all read as an empty list.
create or replace function private.ap_json_list(p_value jsonb)
returns text[] language sql immutable set search_path = public, private as $$
  select case when jsonb_typeof(p_value) = 'array' then (select array_agg(distinct x) from jsonb_array_elements_text(p_value) x) end;
$$;
revoke all on function private.ap_json_list(jsonb) from public, anon, authenticated;

create or replace function public.fs_authority(p_command text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  c record; v_type text; v_min numeric; v_max numeric; v_roles text[]; v_second numeric; v_second_roles text[]; v_reason text; v_id uuid;
  v_from uuid; v_to uuid; v_start date; v_end date; v_types text[]; v_month date; v_valid text[];
  v_allowed constant text[] := array['owner','admin','sales_manager','accounts','factory_manager','production_manager','inventory_manager','dispatch_manager','quality'];
  -- Types whose approvals are decided in the approval inbox today, and the roles that can open it (approval_inbox_command).
  v_enforced constant text[] := array['quote','low_margin_quote','expense'];
  v_inbox constant text[] := array['owner','admin','sales_manager','accounts'];
begin
  if p_command = 'overview' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    return jsonb_build_object(
      'rules', coalesce((select jsonb_agg(to_jsonb(r) - 'company_id' order by r.transaction_type, r.min_amount) from public.authority_rules r where r.company_id = c.company_id and r.retired_at is null), '[]'::jsonb),
      'retired', coalesce((select jsonb_agg(to_jsonb(r) - 'company_id' order by r.retired_at desc) from (select * from public.authority_rules where company_id = c.company_id and retired_at is not null order by retired_at desc limit 10) r), '[]'::jsonb),
      'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'from', fu.full_name, 'to', tu.full_name, 'types', d.transaction_types, 'starts_on', d.starts_on,
          'ends_on', d.ends_on, 'reason', d.reason, 'revoked_at', d.revoked_at, 'active', d.revoked_at is null and private.business_today() between d.starts_on and d.ends_on) order by d.starts_on desc)
        from public.authority_delegations d left join public.app_users fu on fu.id = d.from_user left join public.app_users tu on tu.id = d.to_user
        where d.company_id = c.company_id and (d.revoked_at is null and d.ends_on >= private.business_today() - 30)), '[]'::jsonb),
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(u.full_name, u.email), 'role', u.role) order by u.full_name)
        from public.app_users u where u.company_id = c.company_id and u.is_active and u.dealer_id is null and u.role = any(v_allowed)), '[]'::jsonb),
      'can_edit_rules', c.role = 'owner',
      'enforced_types', to_jsonb(v_enforced),
      'inbox_roles', to_jsonb(v_inbox));

  elsif p_command = 'save_rule' then
    select * into c from private.ap_ctx(array['owner']);
    v_type := p_payload ->> 'transaction_type';
    if v_type is null or not (v_type = any(array['quote', 'low_margin_quote', 'expense', 'discount', 'credit_limit_override', 'stock_adjustment', 'write_off', 'purchase_order', 'payment', 'concession', 'price_override'])) then
      raise exception 'AP: Choose a transaction type.';
    end if;
    begin
      v_min := coalesce(nullif(p_payload ->> 'min_amount', '')::numeric, 0);
      v_max := nullif(p_payload ->> 'max_amount', '')::numeric;
      v_second := nullif(p_payload ->> 'second_approver_from', '')::numeric;
    exception when others then raise exception 'AP: Enter amounts as numbers.';
    end;
    if v_min < 0 or (v_max is not null and v_max <= v_min) then raise exception 'AP: The band must start at 0 or more and end above where it starts.'; end if;
    if v_second is not null and (v_second < v_min or (v_max is not null and v_second >= v_max)) then raise exception 'AP: The second-approver amount must fall inside the band.'; end if;
    v_roles := private.ap_json_list(p_payload -> 'approver_roles');
    v_second_roles := private.ap_json_list(p_payload -> 'second_approver_roles');
    if v_roles is null then raise exception 'AP: Choose at least one approving role.'; end if;
    v_valid := case when v_type = any(v_enforced) then v_inbox else v_allowed end;
    if not (v_roles <@ v_valid) or (v_second_roles is not null and not (v_second_roles <@ v_valid)) then
      if v_type = any(v_enforced) then
        raise exception 'AP: Quotation and expense approvals are decided in the approval inbox, so choose from owner, admin, sales_manager and accounts.';
      end if;
      raise exception 'AP: Choose valid approving roles.';
    end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    v_id := private.ap_uuid(p_payload, 'replaces', false);
    if v_id is not null then
      update public.authority_rules set retired_at = now(), retired_by = c.actor_id, retired_reason = 'Replaced: ' || v_reason
      where id = v_id and company_id = c.company_id and retired_at is null;
      if not found then raise exception 'AP: The rule being replaced was already changed. Reload.'; end if;
    end if;
    if exists (select 1 from public.authority_rules where company_id = c.company_id and transaction_type = v_type and retired_at is null
      and numrange(min_amount, max_amount, '[)') && numrange(v_min, v_max, '[)')) then
      raise exception 'AP: This band overlaps an active band for the same transaction type. Replace or retire that rule first.';
    end if;
    insert into public.authority_rules(company_id, transaction_type, min_amount, max_amount, approver_roles, second_approver_from, second_approver_roles, reason, created_by, created_by_name)
    values (c.company_id, v_type, v_min, v_max, v_roles, v_second, v_second_roles, v_reason, c.actor_id, c.full_name) returning id into v_id;
    return jsonb_build_object('id', v_id);

  elsif p_command = 'retire_rule' then
    select * into c from private.ap_ctx(array['owner']);
    v_id := private.ap_uuid(p_payload, 'id');
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    update public.authority_rules set retired_at = now(), retired_by = c.actor_id, retired_reason = v_reason where id = v_id and company_id = c.company_id and retired_at is null;
    if not found then raise exception 'AP: This rule was already retired. Reload.'; end if;
    return jsonb_build_object('retired', true);

  elsif p_command = 'delegate' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    v_from := private.ap_uuid(p_payload, 'from_user'); v_to := private.ap_uuid(p_payload, 'to_user');
    if v_from = v_to then raise exception 'AP: Choose two different people.'; end if;
    if (select count(*) from public.app_users where id in (v_from, v_to) and company_id = c.company_id and is_active and dealer_id is null) <> 2 then raise exception 'Not permitted' using errcode = '42501'; end if;
    if c.role = 'admin' and exists (select 1 from public.app_users where id = v_from and role = 'owner') then raise exception 'AP: Only the owner can delegate the owner''s authority.' using errcode = '42501'; end if;
    begin v_start := (p_payload ->> 'starts_on')::date; v_end := (p_payload ->> 'ends_on')::date; exception when others then raise exception 'AP: Use dates as YYYY-MM-DD.'; end;
    if v_start is null or v_end is null or v_end < v_start or v_end - v_start > 90 or v_end < private.business_today() then raise exception 'AP: Choose a leave period of up to 90 days that has not ended.'; end if;
    v_types := private.ap_json_list(p_payload -> 'transaction_types');
    if (v_types is null or v_types && v_enforced)
      and not exists (select 1 from public.app_users where id = v_to and company_id = c.company_id and role = any(v_inbox)) then
      raise exception 'AP: Quotation and expense approvals are decided in the approval inbox, which this person''s role cannot open. Delegate only other transaction types, or choose an owner, admin, sales manager or accounts user.';
    end if;
    v_reason := private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300);
    insert into public.authority_delegations(company_id, from_user, to_user, transaction_types, starts_on, ends_on, reason, created_by)
    values (c.company_id, v_from, v_to, v_types, v_start, v_end, v_reason, c.actor_id) returning id into v_id;
    return jsonb_build_object('id', v_id);

  elsif p_command = 'revoke_delegation' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    v_id := private.ap_uuid(p_payload, 'id');
    update public.authority_delegations set revoked_at = now(), revoked_by = c.actor_id where id = v_id and company_id = c.company_id and revoked_at is null;
    if not found then raise exception 'AP: This delegation was already ended. Reload.'; end if;
    return jsonb_build_object('revoked', true);

  elsif p_command = 'report' then
    select * into c from private.ap_ctx(array['owner', 'admin']);
    begin v_month := date_trunc('month', coalesce(nullif(p_payload ->> 'month', '')::date, private.business_today()))::date; exception when others then raise exception 'AP: Use a month as YYYY-MM-01.'; end;
    return jsonb_build_object('month', v_month,
      'approvals', coalesce((select jsonb_agg(jsonb_build_object('at', a.approved_at, 'type', a.transaction_type, 'source_type', a.source_type, 'source_id', a.source_id,
          'reference', coalesce(q.quote_number, e.expense_number), 'amount', a.amount, 'step', a.step, 'completes', a.completes, 'approver', a.approver_name, 'role', a.approver_role,
          'delegated', a.via_delegation is not null, 'requester', ru.full_name) order by a.approved_at desc)
        from public.authority_approvals a
        left join public.quotes q on a.source_type = 'quote' and q.id = a.source_id
        left join public.expense_ledger e on a.source_type = 'expense' and e.id = a.source_id
        left join public.app_users ru on ru.id = a.requester_id
        where a.company_id = c.company_id and (a.approved_at at time zone 'Asia/Kolkata')::date >= v_month and (a.approved_at at time zone 'Asia/Kolkata')::date < (v_month + interval '1 month')::date), '[]'::jsonb),
      'delegated_count', (select count(*) from public.authority_approvals a where a.company_id = c.company_id and a.via_delegation is not null
        and (a.approved_at at time zone 'Asia/Kolkata')::date >= v_month and (a.approved_at at time zone 'Asia/Kolkata')::date < (v_month + interval '1 month')::date));

  elsif p_command = 'awaiting' then
    select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'accounts']);
    return coalesce((select jsonb_agg(jsonb_build_object('source_type', a.source_type, 'source_id', a.source_id, 'first_approver', a.approver_name, 'at', a.approved_at))
      from public.authority_approvals a
      where a.company_id = c.company_id and a.step = 1 and not a.completes
        and not exists (select 1 from public.authority_approvals b where b.company_id = a.company_id and b.source_id = a.source_id and b.source_version = a.source_version and b.step = 2)
        and ((a.source_type = 'quote' and exists (select 1 from public.quotes q where q.id = a.source_id and q.status = 'internal_review' and private.approval_quote_version(q) = a.source_version))
          or (a.source_type = 'expense' and exists (select 1 from public.expense_ledger e where e.id = a.source_id and e.approval_status = 'pending_approval' and private.approval_expense_version(e) = a.source_version)))), '[]'::jsonb);
  end if;
  raise exception 'AP: Unknown authority request.';
end;
$$;
revoke all on function public.fs_authority(text, jsonb) from public, anon;
grant execute on function public.fs_authority(text, jsonb) to authenticated;
