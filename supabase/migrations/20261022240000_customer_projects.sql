-- UPGRADE_EOS feature 43: project and site grouping.
--
-- A project belongs to one customer and records the delivery site. Quotations, orders and
-- dispatches are grouped under it by explicit links only (never by matching names), each
-- transaction can belong to at most one project, and a link is accepted only when the record
-- belongs to the same company and the same customer. Transaction identities are unchanged.
-- Project totals have fixed definitions: order value and ordered kg from linked non-cancelled
-- orders, dispatched kg from linked dispatches that have left the factory and were not returned.
-- Commercial values are returned only to roles that may see them. Additive only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.customer_projects (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  project_code text not null,
  name text not null check (length(btrim(name)) between 2 and 120),
  site_name text check (site_name is null or length(site_name) <= 120),
  site_address text check (site_address is null or length(site_address) <= 500),
  city text check (city is null or length(city) <= 80),
  state text check (state is null or length(state) <= 80),
  pincode text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or contact_phone ~ '^(\+91)?[6-9][0-9]{9}$'),
  status text not null default 'active' check (status in ('active','on_hold','completed','cancelled')),
  notes text check (notes is null or length(notes) <= 2000),
  version integer not null default 1 check (version >= 1),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.app_users(id),
  updated_at timestamptz not null default now()
);
create unique index customer_projects_code_key on public.customer_projects(company_id, project_code);
create unique index customer_projects_customer_name_key on public.customer_projects(company_id, customer_id, lower(btrim(name)));
create index customer_projects_list_idx on public.customer_projects(company_id, status, updated_at desc);
create index customer_projects_customer_idx on public.customer_projects(customer_id);
create index customer_projects_created_by_idx on public.customer_projects(created_by);
create index customer_projects_updated_by_idx on public.customer_projects(updated_by);

create table public.customer_project_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.customer_projects(id),
  entity_type text not null check (entity_type in ('quote','order','dispatch')),
  entity_id uuid not null,
  linked_by uuid not null references public.app_users(id),
  linked_by_name text not null,
  linked_at timestamptz not null default now()
);
create unique index customer_project_links_entity_key on public.customer_project_links(company_id, entity_type, entity_id);
create index customer_project_links_project_idx on public.customer_project_links(company_id, project_id, entity_type);
create index customer_project_links_project_fk_idx on public.customer_project_links(project_id);
create index customer_project_links_linked_by_idx on public.customer_project_links(linked_by);

-- Unlinks are kept as history so a project's past grouping can be explained.
create table public.customer_project_link_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.customer_projects(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('linked','unlinked')),
  reason text check (reason is null or length(reason) <= 500),
  actor_id uuid not null references public.app_users(id),
  actor_name text not null,
  created_at timestamptz not null default now()
);
create index customer_project_link_events_project_idx on public.customer_project_link_events(company_id, project_id, created_at desc);
create index customer_project_link_events_project_fk_idx on public.customer_project_link_events(project_id);
create index customer_project_link_events_actor_idx on public.customer_project_link_events(actor_id);

alter table public.customer_projects enable row level security;
alter table public.customer_project_links enable row level security;
alter table public.customer_project_link_events enable row level security;
revoke all on public.customer_projects, public.customer_project_links, public.customer_project_link_events from public, anon, authenticated;
grant select on public.customer_projects, public.customer_project_links, public.customer_project_link_events to authenticated;
create policy customer_projects_read on public.customer_projects for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','accounts','viewer'));
create policy customer_project_links_read on public.customer_project_links for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','accounts','viewer'));
create policy customer_project_link_events_read on public.customer_project_link_events for select to authenticated
  using (company_id = private.get_current_user_company_id() and private.get_current_user_dealer_id() is null
    and private.get_current_user_role() in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','accounts','viewer'));

-- The customer a transaction belongs to, within one company; null when it does not exist there.
create or replace function private.project_entity_customer(p_company uuid, p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public, private as $$
  select case p_type
    when 'quote' then (select q.customer_id from public.quotes q where q.id = p_id and q.company_id = p_company and q.deleted_at is null)
    when 'order' then (select o.customer_id from public.orders o where o.id = p_id and o.company_id = p_company and o.deleted_at is null)
    when 'dispatch' then (select o.customer_id from public.dispatches d join public.orders o on o.id = d.order_id and o.company_id = p_company
                          where d.id = p_id and d.company_id = p_company and o.deleted_at is null)
  end
$$;
revoke all on function private.project_entity_customer(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.project_text(p_payload jsonb, p_key text, p_max integer)
returns text language plpgsql immutable set search_path = public, private as $$
declare v text := nullif(btrim(coalesce(p_payload ->> p_key, '')), '');
begin
  if v is not null and (length(v) > p_max or v ~ '[[:cntrl:]]') then raise exception 'Check the % field', replace(p_key, '_', ' '); end if;
  return v;
end;
$$;
revoke all on function private.project_text(jsonb, text, integer) from public, anon, authenticated;

-- Field rules with messages an employee can act on (the table checks remain the final guard).
create or replace function private.project_validate(p_payload jsonb)
returns void language plpgsql immutable set search_path = public, private as $$
declare
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_pin text := nullif(btrim(coalesce(p_payload ->> 'pincode', '')), '');
  v_phone text := nullif(replace(btrim(coalesce(p_payload ->> 'contact_phone', '')), ' ', ''), '');
begin
  if length(v_name) not between 2 and 120 or v_name ~ '[[:cntrl:]]' then raise exception 'Enter a project name of 2 to 120 characters'; end if;
  if v_pin is not null and v_pin !~ '^[1-9][0-9]{5}$' then raise exception 'Enter a valid 6-digit PIN code'; end if;
  if v_phone is not null and v_phone !~ '^(\+91)?[6-9][0-9]{9}$' then raise exception 'Enter a valid Indian mobile number'; end if;
end;
$$;
revoke all on function private.project_validate(jsonb) from public, anon, authenticated;

create or replace function public.customer_project_command(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_name text;
  v_values boolean;
  v_project public.customer_projects%rowtype;
  v_id uuid; v_customer uuid; v_entity uuid; v_type text; v_owner uuid; v_existing uuid;
  v_code text; v_page integer; v_total bigint; v_rows jsonb; v_search text; v_status text;
  v_results jsonb := '[]'::jsonb; v_target record; v_reason text;
begin
  if v_actor is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid project request'; end if;
  select coalesce(nullif(full_name, ''), 'Employee') into v_name from public.app_users
  where id = v_actor and company_id = v_company and role = v_role and is_active and dealer_id is null;
  if not found
     or p_command not in ('project.create','project.update','project.link','project.unlink','project.list','project.load','project.candidates')
     or (p_command in ('project.create','project.update','project.link','project.unlink') and v_role not in ('owner','admin','sales_manager','sales'))
     or v_role not in ('owner','admin','sales_manager','sales','production_manager','factory_manager','dispatch_manager','dispatch','accounts','viewer') then
    raise exception 'This action is not permitted for your role' using errcode = '42501';
  end if;
  v_values := v_role in ('owner','admin','sales_manager','sales','accounts');

  if p_command = 'project.create' then
    v_id := (p_payload ->> 'request_id')::uuid;
    v_customer := (p_payload ->> 'customer_id')::uuid;
    if v_id is null or v_customer is null then raise exception 'A request identity and customer are required'; end if;
    select * into v_project from public.customer_projects where id = v_id;
    if found then
      if v_project.company_id <> v_company or v_project.customer_id <> v_customer or lower(v_project.name) <> lower(btrim(coalesce(p_payload ->> 'name', ''))) then
        raise exception 'The request identity was already used for different details';
      end if;
      return jsonb_build_object('id', v_project.id, 'project_code', v_project.project_code);
    end if;
    perform private.project_validate(p_payload);
    if not exists (select 1 from public.customers where id = v_customer and company_id = v_company and is_active and deleted_at is null) then raise exception 'Choose an active customer'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text || ':customer-project-code', 0));
    if exists (select 1 from public.customer_projects where company_id = v_company and customer_id = v_customer and lower(btrim(name)) = lower(btrim(coalesce(p_payload ->> 'name', '')))) then
      raise exception 'This customer already has a project with that name';
    end if;
    select 'PRJ-' || lpad((coalesce(max(substring(project_code from '^PRJ-([0-9]+)$')::integer), 0) + 1)::text, 4, '0') into v_code
    from public.customer_projects where company_id = v_company;
    insert into public.customer_projects(id, company_id, customer_id, project_code, name, site_name, site_address, city, state, pincode, contact_name, contact_phone, notes, created_by, updated_by)
    values (v_id, v_company, v_customer, v_code, btrim(coalesce(p_payload ->> 'name', '')), private.project_text(p_payload, 'site_name', 120), private.project_text(p_payload, 'site_address', 500),
      private.project_text(p_payload, 'city', 80), private.project_text(p_payload, 'state', 80), private.project_text(p_payload, 'pincode', 6),
      private.project_text(p_payload, 'contact_name', 120), replace(private.project_text(p_payload, 'contact_phone', 20), ' ', ''), private.project_text(p_payload, 'notes', 2000), v_actor, v_actor);
    return jsonb_build_object('id', v_id, 'project_code', v_code);

  elsif p_command = 'project.update' then
    select * into v_project from public.customer_projects where id = (p_payload ->> 'project_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Project is unavailable'; end if;
    if v_project.version <> (p_payload ->> 'expected_version')::integer then raise exception 'The project changed since you opened it. Refresh and review it'; end if;
    perform private.project_validate(p_payload);
    v_status := coalesce(p_payload ->> 'status', v_project.status);
    if v_status not in ('active','on_hold','completed','cancelled') then raise exception 'Choose a valid project status'; end if;
    if exists (select 1 from public.customer_projects where company_id = v_company and customer_id = v_project.customer_id and id <> v_project.id and lower(btrim(name)) = lower(btrim(coalesce(p_payload ->> 'name', '')))) then
      raise exception 'This customer already has a project with that name';
    end if;
    update public.customer_projects set name = btrim(coalesce(p_payload ->> 'name', '')), site_name = private.project_text(p_payload, 'site_name', 120),
      site_address = private.project_text(p_payload, 'site_address', 500), city = private.project_text(p_payload, 'city', 80), state = private.project_text(p_payload, 'state', 80),
      pincode = private.project_text(p_payload, 'pincode', 6), contact_name = private.project_text(p_payload, 'contact_name', 120),
      contact_phone = replace(private.project_text(p_payload, 'contact_phone', 20), ' ', ''), notes = private.project_text(p_payload, 'notes', 2000),
      status = v_status, version = version + 1, updated_by = v_actor, updated_at = now()
    where id = v_project.id;
    return jsonb_build_object('id', v_project.id, 'version', v_project.version + 1);

  elsif p_command = 'project.link' then
    select * into v_project from public.customer_projects where id = (p_payload ->> 'project_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Project is unavailable'; end if;
    if v_project.status not in ('active','on_hold') then raise exception 'Reopen the project before linking more transactions'; end if;
    v_type := p_payload ->> 'entity_type';
    v_entity := (p_payload ->> 'entity_id')::uuid;
    if v_type not in ('quote','order','dispatch') or v_entity is null then raise exception 'Choose a quotation, order or dispatch to link'; end if;
    -- The chosen record, plus (optionally) the order's source quotation and its dispatches.
    for v_target in
      select v_type as t, v_entity as e, true as primary_target
      union all
      select 'quote', o.quote_id, false from public.orders o
      where coalesce((p_payload ->> 'include_related')::boolean, false) and v_type = 'order' and o.id = v_entity and o.company_id = v_company and o.quote_id is not null
      union all
      select 'dispatch', d.id, false from public.dispatches d
      where coalesce((p_payload ->> 'include_related')::boolean, false) and v_type = 'order' and d.order_id = v_entity and d.company_id = v_company
    loop
      v_owner := private.project_entity_customer(v_company, v_target.t, v_target.e);
      if v_owner is null then
        if v_target.primary_target then raise exception 'The selected record is unavailable'; end if;
        v_results := v_results || jsonb_build_object('entity_type', v_target.t, 'entity_id', v_target.e, 'outcome', 'unavailable');
        continue;
      end if;
      if v_owner <> v_project.customer_id then
        if v_target.primary_target then raise exception 'Only transactions for this project''s customer can be linked'; end if;
        v_results := v_results || jsonb_build_object('entity_type', v_target.t, 'entity_id', v_target.e, 'outcome', 'other_customer');
        continue;
      end if;
      select project_id into v_existing from public.customer_project_links where company_id = v_company and entity_type = v_target.t and entity_id = v_target.e;
      if found then
        if v_existing = v_project.id then
          v_results := v_results || jsonb_build_object('entity_type', v_target.t, 'entity_id', v_target.e, 'outcome', 'already_linked');
        elsif v_target.primary_target then
          raise exception 'This record is already grouped under another project. Unlink it there first';
        else
          v_results := v_results || jsonb_build_object('entity_type', v_target.t, 'entity_id', v_target.e, 'outcome', 'other_project');
        end if;
        continue;
      end if;
      insert into public.customer_project_links(company_id, project_id, entity_type, entity_id, linked_by, linked_by_name)
      values (v_company, v_project.id, v_target.t, v_target.e, v_actor, v_name);
      insert into public.customer_project_link_events(company_id, project_id, entity_type, entity_id, action, actor_id, actor_name)
      values (v_company, v_project.id, v_target.t, v_target.e, 'linked', v_actor, v_name);
      v_results := v_results || jsonb_build_object('entity_type', v_target.t, 'entity_id', v_target.e, 'outcome', 'linked');
    end loop;
    return jsonb_build_object('results', v_results);

  elsif p_command = 'project.unlink' then
    select * into v_project from public.customer_projects where id = (p_payload ->> 'project_id')::uuid and company_id = v_company for update;
    if not found then raise exception 'Project is unavailable'; end if;
    v_reason := private.project_text(p_payload, 'reason', 500);
    if v_reason is null then raise exception 'Record why the record is being removed from the project'; end if;
    delete from public.customer_project_links
    where company_id = v_company and project_id = v_project.id and entity_type = p_payload ->> 'entity_type' and entity_id = (p_payload ->> 'entity_id')::uuid
    returning entity_type, entity_id into v_type, v_entity;
    if not found then raise exception 'That record is not linked to this project'; end if;
    insert into public.customer_project_link_events(company_id, project_id, entity_type, entity_id, action, reason, actor_id, actor_name)
    values (v_company, v_project.id, v_type, v_entity, 'unlinked', v_reason, v_actor, v_name);
    return jsonb_build_object('id', v_project.id);

  elsif p_command = 'project.load' then
    select * into v_project from public.customer_projects where id = (p_payload ->> 'project_id')::uuid and company_id = v_company;
    if not found then raise exception 'Project is unavailable'; end if;
    return jsonb_build_object(
      'project', to_jsonb(v_project) - 'company_id' || jsonb_build_object('customer_name', (select coalesce(company_name, customer_name) from public.customers where id = v_project.customer_id and company_id = v_company)),
      'can_see_values', v_values,
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'number', q.quote_number, 'date', q.quote_date, 'status', q.status,
          'value', case when v_values then q.grand_total end, 'linked_at', l.linked_at, 'linked_by_name', l.linked_by_name) order by q.quote_date desc, q.id)
        from public.customer_project_links l join public.quotes q on q.id = l.entity_id and q.company_id = v_company and q.deleted_at is null
        where l.company_id = v_company and l.project_id = v_project.id and l.entity_type = 'quote'), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.order_number, 'date', o.order_date, 'stage', o.current_stage,
          'expected_dispatch_date', o.expected_dispatch_date, 'ordered_kg', o.requested_weight_kg, 'value', case when v_values then o.order_value end,
          'linked_at', l.linked_at, 'linked_by_name', l.linked_by_name) order by o.order_date desc, o.id)
        from public.customer_project_links l join public.orders o on o.id = l.entity_id and o.company_id = v_company and o.deleted_at is null
        where l.company_id = v_company and l.project_id = v_project.id and l.entity_type = 'order'), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'number', d.dispatch_number, 'date', d.dispatch_date, 'status', d.delivery_status,
          'weight_kg', d.total_weight_kg, 'order_number', o.order_number, 'vehicle_number', d.vehicle_number, 'linked_at', l.linked_at, 'linked_by_name', l.linked_by_name) order by d.dispatch_date desc, d.id)
        from public.customer_project_links l join public.dispatches d on d.id = l.entity_id and d.company_id = v_company
        left join public.orders o on o.id = d.order_id and o.company_id = v_company
        where l.company_id = v_company and l.project_id = v_project.id and l.entity_type = 'dispatch'), '[]'::jsonb),
      'totals', (select jsonb_build_object(
          'order_count', count(*) filter (where o.current_stage <> 'cancelled'),
          'ordered_kg', coalesce(sum(o.requested_weight_kg) filter (where o.current_stage <> 'cancelled'), 0),
          'order_value', case when v_values then coalesce(sum(o.order_value) filter (where o.current_stage <> 'cancelled'), 0) end)
        from public.customer_project_links l join public.orders o on o.id = l.entity_id and o.company_id = v_company and o.deleted_at is null
        where l.company_id = v_company and l.project_id = v_project.id and l.entity_type = 'order')
        || (select jsonb_build_object('dispatched_kg', coalesce(sum(d.total_weight_kg) filter (where d.delivery_status in ('dispatched','in_transit','delivered','delayed','damaged')), 0),
              'delivered_kg', coalesce(sum(d.total_weight_kg) filter (where d.delivery_status = 'delivered'), 0))
            from public.customer_project_links l join public.dispatches d on d.id = l.entity_id and d.company_id = v_company
            where l.company_id = v_company and l.project_id = v_project.id and l.entity_type = 'dispatch')
        || (select jsonb_build_object('open_quote_count', count(*) filter (where q.status in ('draft','internal_review','approved_for_sending','sent')))
            from public.customer_project_links l join public.quotes q on q.id = l.entity_id and q.company_id = v_company and q.deleted_at is null
            where l.company_id = v_company and l.project_id = v_project.id and l.entity_type = 'quote'),
      'history', coalesce((select jsonb_agg(to_jsonb(e) - 'company_id' - 'project_id' - 'actor_id' order by e.created_at desc, e.id) from (
          select * from public.customer_project_link_events where company_id = v_company and project_id = v_project.id order by created_at desc, id limit 10) e), '[]'::jsonb));

  elsif p_command = 'project.candidates' then
    select * into v_project from public.customer_projects where id = (p_payload ->> 'project_id')::uuid and company_id = v_company;
    if not found then raise exception 'Project is unavailable'; end if;
    v_type := p_payload ->> 'entity_type';
    v_search := lower(btrim(coalesce(p_payload ->> 'search', '')));
    if v_type not in ('quote','order','dispatch') or length(v_search) > 60 then raise exception 'Invalid candidate request'; end if;
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_rows from (
      select x.id, x.number, x.date, x.status from (
        select q.id, q.quote_number as number, q.quote_date as date, q.status from public.quotes q
        where v_type = 'quote' and q.company_id = v_company and q.customer_id = v_project.customer_id and q.deleted_at is null
        union all
        select o.id, o.order_number, o.order_date, o.current_stage from public.orders o
        where v_type = 'order' and o.company_id = v_company and o.customer_id = v_project.customer_id and o.deleted_at is null
        union all
        select d.id, coalesce(d.dispatch_number, 'Dispatch'), d.dispatch_date, d.delivery_status from public.dispatches d
        join public.orders o on o.id = d.order_id and o.company_id = v_company and o.deleted_at is null
        where v_type = 'dispatch' and d.company_id = v_company and o.customer_id = v_project.customer_id
      ) x
      where not exists (select 1 from public.customer_project_links l where l.company_id = v_company and l.entity_type = v_type and l.entity_id = x.id)
        and (v_search = '' or position(v_search in lower(x.number)) > 0)
      order by x.date desc nulls last, x.id limit 10) c;
    return jsonb_build_object('rows', v_rows);
  end if;

  -- project.list: literal (not pattern) search over code, name, site, city and customer.
  v_page := coalesce((p_payload ->> 'page')::integer, 1);
  v_search := lower(btrim(coalesce(p_payload ->> 'search', '')));
  v_status := nullif(p_payload ->> 'status', '');
  if v_page < 1 or v_page > 100000 or length(v_search) > 80 or (v_status is not null and v_status not in ('active','on_hold','completed','cancelled')) then raise exception 'Invalid project search'; end if;
  with matches as (
    select p.*, coalesce(c.company_name, c.customer_name) as customer_name
    from public.customer_projects p left join public.customers c on c.id = p.customer_id and c.company_id = v_company
    where p.company_id = v_company
      and (v_status is null or p.status = v_status)
      and (p_payload ->> 'customer_id' is null or p.customer_id = (p_payload ->> 'customer_id')::uuid)
      and (v_search = '' or position(v_search in lower(p.project_code || ' ' || p.name || ' ' || coalesce(p.site_name, '') || ' ' || coalesce(p.city, '') || ' ' || coalesce(c.company_name, '') || ' ' || coalesce(c.customer_name, ''))) > 0)
  )
  select (select count(*) from matches),
    coalesce((select jsonb_agg(to_jsonb(r)) from (
      select m.id, m.project_code, m.name, m.site_name, m.city, m.status, m.customer_id, m.customer_name, m.updated_at,
        (select count(*) from public.customer_project_links l where l.company_id = v_company and l.project_id = m.id and l.entity_type = 'order') as order_count,
        (select count(*) from public.customer_project_links l where l.company_id = v_company and l.project_id = m.id) as link_count
      from matches m order by m.updated_at desc, m.id limit 10 offset (v_page - 1) * 10) r), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;
revoke all on function public.customer_project_command(text, jsonb) from public, anon;
grant execute on function public.customer_project_command(text, jsonb) to authenticated;

commit;
