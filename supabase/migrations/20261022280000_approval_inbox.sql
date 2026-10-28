-- UPGRADE_EOS feature 44: dedicated approval inbox.
--
-- One queue of the approval requests the signed-in employee may decide:
--   * quotations in internal review (low-margin ones only for owners and admins, as the existing
--     quote guard requires; others also for sales managers), approved only when every line's
--     costing is complete, exactly as the quote status action requires;
--   * expenses pending approval (accounts up to the existing threshold, owners and admins above
--     it), decided through private.transition_expense_approval so its rules are unchanged.
-- Each item carries a version fingerprint. A decision names the version it covers; if the record
-- changed (edited, re-costed, decided elsewhere) the decision is refused as superseded, and a
-- decided version can never be approved or rejected again. Request Clarification keeps the
-- request pending, records the question and notifies the requester. People cannot decide their
-- own requests unless they are the owner. Every decision is recorded. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  request_id uuid not null,
  source_type text not null check (source_type in ('quote','expense')),
  source_id uuid not null,
  source_reference text,
  version text not null check (version ~ '^[0-9a-f]{32}$'),
  decision text not null check (decision in ('approve','reject','clarify')),
  note text check (note is null or length(note) <= 1000),
  actor_id uuid not null references public.app_users(id),
  actor_name text not null,
  actor_role text not null,
  decided_at timestamptz not null default now()
);
create unique index approval_decisions_request_key on public.approval_decisions(company_id, request_id);
create unique index approval_decisions_final_key on public.approval_decisions(company_id, source_type, source_id, version) where decision in ('approve','reject');
create index approval_decisions_source_idx on public.approval_decisions(company_id, source_type, source_id, decided_at desc);
create index approval_decisions_actor_idx on public.approval_decisions(actor_id);
alter table public.approval_decisions enable row level security;
revoke all on public.approval_decisions from public, anon, authenticated;
grant select on public.approval_decisions to authenticated;
create policy approval_decisions_read on public.approval_decisions for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','accounts'));

create or replace function private.approval_quote_version(q public.quotes)
returns text language sql immutable set search_path = public, private as $$
  select md5(concat_ws('|', q.status, q.revision_number::text, q.grand_total::text, q.total_margin_amount::text, q.low_margin_approval_required::text, q.updated_at::text))
$$;
create or replace function private.approval_expense_version(e public.expense_ledger)
returns text language sql immutable set search_path = public, private as $$
  select md5(concat_ws('|', e.approval_status, e.total_amount::text, e.vendor_id::text, e.updated_at::text))
$$;
revoke all on function private.approval_quote_version(public.quotes) from public, anon, authenticated;
revoke all on function private.approval_expense_version(public.expense_ledger) from public, anon, authenticated;

-- Whether this role may decide the request at all (before the self-decision rule).
create or replace function private.approval_role_allowed(p_role text, p_type text, p_low_margin boolean, p_amount numeric)
returns boolean language sql stable set search_path = public, private as $$
  select case p_type
    when 'quote' then p_role in ('owner','admin') or (p_role = 'sales_manager' and not coalesce(p_low_margin, false))
    when 'expense' then p_role in ('owner','admin') or (p_role = 'accounts' and coalesce(p_amount, 0) <= private.expense_approval_threshold())
    else false end
$$;
revoke all on function private.approval_role_allowed(text, text, boolean, numeric) from public, anon, authenticated;

create or replace function public.approval_inbox_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_type text; v_source uuid; v_version text; v_decision text; v_note text; v_request uuid;
  v_existing public.approval_decisions%rowtype;
  v_quote public.quotes%rowtype; v_expense public.expense_ledger%rowtype;
  v_current text; v_requester uuid; v_reference text; v_page integer; v_total bigint; v_rows jsonb;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid approval request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found or p_command not in ('inbox.list','inbox.decide','inbox.history') or v_role not in ('owner','admin','sales_manager','accounts') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;

  if p_command = 'inbox.decide' then
    v_type := p_payload ->> 'source_type';
    v_source := (p_payload ->> 'source_id')::uuid;
    v_version := p_payload ->> 'version';
    v_decision := p_payload ->> 'decision';
    v_note := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
    v_request := (p_payload ->> 'request_id')::uuid;
    if v_type not in ('quote','expense') or v_source is null or v_version is null or v_version !~ '^[0-9a-f]{32}$'
       or v_decision not in ('approve','reject','clarify') or v_request is null then
      raise exception 'Choose a request, its version and a decision';
    end if;
    if v_note is not null and (length(v_note) > 1000 or v_note ~ '[[:cntrl:]]') then raise exception 'Keep the note under 1,000 characters'; end if;
    if v_decision in ('reject','clarify') and length(coalesce(v_note, '')) < 5 then
      raise exception 'Explain the rejection or the question for the requester';
    end if;

    -- Idempotent retry of the same decision.
    select * into v_existing from public.approval_decisions where company_id = v_company and request_id = v_request;
    if found then
      if v_existing.source_type <> v_type or v_existing.source_id <> v_source or v_existing.decision <> v_decision or v_existing.version <> v_version or v_existing.actor_id <> v_actor then
        raise exception 'The request identity was already used for different details';
      end if;
      return jsonb_build_object('id', v_existing.id, 'decision', v_existing.decision, 'replayed', true);
    end if;

    if v_type = 'quote' then
      select * into v_quote from public.quotes where id = v_source and company_id = v_company and deleted_at is null for update;
      if not found then raise exception 'Approval request is unavailable'; end if;
      if not private.approval_role_allowed(v_role, 'quote', v_quote.low_margin_approval_required, v_quote.grand_total) then
        raise exception 'Only owners and admins may decide low-margin quotations' using errcode = '42501';
      end if;
      v_current := private.approval_quote_version(v_quote);
      v_requester := v_quote.created_by;
      v_reference := v_quote.quote_number;
      if v_quote.status <> 'internal_review' then raise exception 'This request was already decided. Refresh the inbox'; end if;
    else
      select * into v_expense from public.expense_ledger where id = v_source and company_id = v_company and deleted_at is null for update;
      if not found then raise exception 'Approval request is unavailable'; end if;
      if not private.approval_role_allowed(v_role, 'expense', null, v_expense.total_amount) then
        raise exception 'Expenses above Rs 25,000 need owner or admin approval' using errcode = '42501';
      end if;
      v_current := private.approval_expense_version(v_expense);
      v_requester := v_expense.created_by;
      v_reference := v_expense.expense_number;
      if v_expense.approval_status <> 'pending_approval' then raise exception 'This request was already decided. Refresh the inbox'; end if;
    end if;
    if v_current <> v_version then raise exception 'This request changed since you opened it. Review the current version before deciding'; end if;
    if v_requester = v_actor and v_role <> 'owner' then raise exception 'You cannot decide your own request' using errcode = '42501'; end if;

    if v_decision = 'clarify' then
      if v_requester is not null and exists (select 1 from public.app_users where id = v_requester and company_id = v_company and is_active) then
        insert into public.notifications(company_id, recipient_user_id, notification_type, severity, title, body, related_entity_type, related_entity_id, is_read, created_by, action_link, entity_reference)
        values (v_company, v_requester, 'approval_clarification', 'warning', concat('Clarification needed: ', coalesce(v_reference, v_type)), v_note,
          v_type, v_source, false, v_actor, case v_type when 'quote' then '/quotes/' || v_source else '/expenses/' || v_source end, v_reference);
      end if;
    elsif v_type = 'quote' then
      if v_decision = 'approve' then
        if not exists (select 1 from public.quote_items where company_id = v_company and quote_id = v_source)
           or exists (select 1 from public.quote_items where company_id = v_company and quote_id = v_source and costing_complete is not true) then
          raise exception 'Complete the costing on every quotation line before approving';
        end if;
        update public.quotes set status = 'approved_for_sending', approved_by = v_actor, approved_at = now(), approval_notes = coalesce(v_note, approval_notes)
        where id = v_source and company_id = v_company;
      else
        update public.quotes set status = 'draft', approved_by = null, approved_at = null, approval_notes = v_note
        where id = v_source and company_id = v_company;
      end if;
    else
      perform private.transition_expense_approval(v_source, v_decision, v_note);
    end if;

    insert into public.approval_decisions(company_id, request_id, source_type, source_id, source_reference, version, decision, note, actor_id, actor_name, actor_role)
    values (v_company, v_request, v_type, v_source, v_reference, v_version, v_decision, v_note, v_actor, v_name, v_role)
    returning * into v_existing;
    return jsonb_build_object('id', v_existing.id, 'decision', v_decision, 'replayed', false);

  elsif p_command = 'inbox.history' then
    v_page := coalesce((p_payload ->> 'page')::integer, 1);
    if v_page < 1 or v_page > 100000 then raise exception 'Invalid page'; end if;
    select count(*) into v_total from public.approval_decisions where company_id = v_company and (v_role in ('owner','admin') or actor_id = v_actor);
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
      select id, source_type, source_id, source_reference, decision, note, actor_name, actor_role, decided_at
      from public.approval_decisions where company_id = v_company and (v_role in ('owner','admin') or actor_id = v_actor)
      order by decided_at desc, id limit 10 offset (v_page - 1) * 10) r;
    return jsonb_build_object('rows', v_rows, 'total_count', v_total);
  end if;

  -- inbox.list: pending requests this employee may decide, oldest first.
  v_type := nullif(p_payload ->> 'type', '');
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  if (v_type is not null and v_type not in ('quote','expense')) or v_page < 1 or v_page > 100000 then raise exception 'Invalid inbox request'; end if;
  with pending as (
    select 'quote'::text as source_type, q.id as source_id, q.quote_number as reference, q.updated_at as requested_at, q.created_by as requester_id,
      coalesce(nullif(c.company_name, ''), c.customer_name) as counterparty, q.grand_total as amount, q.low_margin_approval_required as low_margin,
      q.estimated_profit_percent as profit_percent, q.revision_number as revision, null::text as category, q.notes as detail,
      private.approval_quote_version(q) as version
    from public.quotes q left join public.customers c on c.id = q.customer_id and c.company_id = v_company
    where q.company_id = v_company and q.deleted_at is null and q.status = 'internal_review'
      and private.approval_role_allowed(v_role, 'quote', q.low_margin_approval_required, q.grand_total)
    union all
    select 'expense', e.id, e.expense_number, e.updated_at, e.created_by, coalesce(e.vendor_name_snapshot, v.vendor_name), e.total_amount, null, null, null,
      e.expense_category, e.description, private.approval_expense_version(e)
    from public.expense_ledger e left join public.vendors v on v.id = e.vendor_id and v.company_id = v_company
    where e.company_id = v_company and e.deleted_at is null and e.approval_status = 'pending_approval'
      and private.approval_role_allowed(v_role, 'expense', null, e.total_amount)
  ), filtered as (select * from pending where v_type is null or source_type = v_type)
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(jsonb_build_object(
        'source_type', f.source_type, 'source_id', f.source_id, 'reference', f.reference, 'requested_at', f.requested_at,
        'requester_name', u.full_name, 'counterparty', f.counterparty, 'amount', f.amount, 'low_margin', f.low_margin, 'profit_percent', f.profit_percent,
        'revision', f.revision, 'category', f.category, 'detail', left(f.detail, 300), 'version', f.version,
        'can_decide', not coalesce(f.requester_id = v_actor and v_role <> 'owner', false),
        'blocked_reason', case when coalesce(f.requester_id = v_actor and v_role <> 'owner', false) then 'Your own request' end,
        'clarifications', (select count(*) from public.approval_decisions d where d.company_id = v_company and d.source_type = f.source_type and d.source_id = f.source_id and d.decision = 'clarify'),
        'last_clarification', (select jsonb_build_object('note', d.note, 'by', d.actor_name, 'at', d.decided_at) from public.approval_decisions d
          where d.company_id = v_company and d.source_type = f.source_type and d.source_id = f.source_id and d.decision = 'clarify' order by d.decided_at desc, d.id limit 1)
      ) order by f.requested_at, f.source_id)
      from (select * from filtered order by requested_at, source_id limit 10 offset (v_page - 1) * 10) f
      left join public.app_users u on u.id = f.requester_id and u.company_id = v_company), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.approval_inbox_command(text, jsonb) from public, anon;
grant execute on function public.approval_inbox_command(text, jsonb) to authenticated;

commit;
