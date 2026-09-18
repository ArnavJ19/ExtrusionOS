begin;

alter table public.packing_list_items
  add column if not exists operator_verified_at timestamptz,
  add column if not exists operator_verified_by uuid references auth.users(id);

-- net_weight_kg depends on gross/tare, so rebuild the generated column before
-- widening those source measurements to factory-scale, gram-level precision.
alter table public.packing_list_items drop column if exists net_weight_kg;
alter table public.packing_list_items
  alter column gross_weight_kg type numeric(14,3),
  alter column tare_weight_kg type numeric(14,3);
alter table public.packing_list_items
  add column net_weight_kg numeric(14,3)
    generated always as (gross_weight_kg - tare_weight_kg) stored;

update public.packing_list_items
set operator_verified_at = coalesce(operator_verified_at, created_at),
    operator_verified_by = coalesce(
      operator_verified_by,
      (select dispatch.created_by from public.dispatches dispatch where dispatch.id = packing_list_items.dispatch_id)
    )
where operator_verified_at is null;

create unique index if not exists packing_list_items_company_bundle_unique
  on public.packing_list_items(company_id, lower(trim(bundle_number)));

create or replace function public.validate_operator_dispatch_bundle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(trim(new.bundle_number), '') is null then
    raise exception 'Scan or enter the physical bundle identifier';
  end if;
  if new.source_line_id is null or new.profile_id is null or new.source_kind is null then
    raise exception 'Every bundle must select its exact production, reservation, or dealer-stock source';
  end if;
  if new.operator_verified_at is null or new.operator_verified_by is null then
    raise exception 'Every dispatch bundle requires operator verification';
  end if;
  if coalesce(new.number_of_pieces, 0) <= 0 then
    raise exception 'Every physical bundle must record its actual piece count';
  end if;
  if coalesce(new.gross_weight_kg, 0) <= 0
     or coalesce(new.tare_weight_kg, 0) < 0
     or new.gross_weight_kg <= new.tare_weight_kg then
    raise exception 'Bundle gross weight must be greater than its non-negative tare weight';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_operator_dispatch_bundle on public.packing_list_items;
create trigger validate_operator_dispatch_bundle
before insert or update of bundle_number, source_line_id, profile_id, source_kind,
  number_of_pieces, gross_weight_kg, tare_weight_kg, operator_verified_at, operator_verified_by
on public.packing_list_items
for each row execute function public.validate_operator_dispatch_bundle();

-- Preserve the bundle identifier scanned by the operator. The previous helper
-- replaced every entered identifier with a generated even-allocation number.
create or replace function private.save_dispatch_atomic(
  p_dispatch_id uuid,
  p_dispatch jsonb,
  p_items jsonb,
  p_order_stage text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_dispatch ->> 'order_id', '')::uuid;
  v_dispatch_id uuid;
  v_payload jsonb;
  v_item jsonb;
  v_bundle_number text;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','factory_manager','inventory_manager','dispatch_manager','dispatch') then
    raise exception 'Permission denied for dispatches' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = v_order_id and company_id = v_company_id for update;
  if not found then raise exception 'Selected order is not available for this company'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Enter at least one operator-verified physical bundle';
  end if;

  v_payload := private.keep_jsonb_keys(p_dispatch, array[
      'order_id','dispatch_date','number_of_bundles','total_weight_kg',
      'transporter_name','vehicle_number','driver_name','driver_phone','eway_bill_number',
      'lr_number','delivery_status','proof_of_delivery_url','packing_list_url','remarks'
    ]) || jsonb_build_object('company_id', v_company_id, 'order_id', v_order_id);

  if p_dispatch_id is null then
    v_payload := v_payload || jsonb_build_object(
      'dispatch_number', private.next_business_number_locked(
        'public.dispatches'::regclass, 'dispatch_number', v_company_id, 'D',
        coalesce(nullif(v_payload ->> 'dispatch_date', '')::date, (now() at time zone 'Asia/Kolkata')::date)
      )
    );
    v_dispatch_id := private.insert_jsonb_row(
      'public.dispatches'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    perform 1 from public.dispatches where id = p_dispatch_id and company_id = v_company_id for update;
    if not found then raise exception 'Dispatch not found for this company'; end if;
    v_dispatch_id := private.update_jsonb_row(
      'public.dispatches'::regclass, p_dispatch_id, v_company_id,
      v_payload || jsonb_build_object('updated_at', now())
    );
  end if;

  delete from public.packing_list_items
  where dispatch_id = v_dispatch_id and company_id = v_company_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_bundle_number := nullif(trim(v_item ->> 'bundle_number'), '');
    if v_bundle_number is null then raise exception 'Scan or enter every physical bundle identifier'; end if;
    perform private.insert_jsonb_row(
      'public.packing_list_items'::regclass,
      (v_item - array['id','company_id','dispatch_id','created_at','updated_at','net_weight_kg','operator_verified_at','operator_verified_by'])
      || jsonb_build_object(
        'company_id', v_company_id,
        'dispatch_id', v_dispatch_id,
        'bundle_number', v_bundle_number,
        'operator_verified_at', now(),
        'operator_verified_by', auth.uid(),
        'created_at', now()
      )
    );
  end loop;

  if p_order_stage in ('dispatched', 'delivered') then
    update public.orders set current_stage = p_order_stage, updated_at = now()
    where id = v_order_id and company_id = v_company_id;
  end if;
  return v_dispatch_id;
end;
$$;

create table if not exists public.factory_load_consolidations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  manufacturing_weight_kg numeric(14,3) not null check (manufacturing_weight_kg > 0),
  minimum_weight_kg numeric(14,3) not null default 700 check (minimum_weight_kg > 0),
  compatibility_signature text not null,
  compatibility_label text not null,
  status text not null default 'pending' check (status in ('pending','consolidated','overridden','cancelled')),
  consolidation_group text,
  release_reason text,
  released_by uuid references auth.users(id),
  released_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, order_id)
);

create index if not exists factory_load_consolidations_queue_idx
  on public.factory_load_consolidations(company_id, status, created_at)
  where status = 'pending';

alter table public.factory_load_consolidations enable row level security;
drop policy if exists "factory consolidation tenant read" on public.factory_load_consolidations;
create policy "factory consolidation tenant read"
on public.factory_load_consolidations for select to authenticated
using (company_id = private.get_current_user_company_id());
revoke insert, update, delete on public.factory_load_consolidations from anon, authenticated;
grant select on public.factory_load_consolidations to authenticated;

create or replace function private.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid,
  p_order_number text,
  p_order_date date,
  p_expected_dispatch_date date,
  p_priority text,
  p_dealer_fulfilled_weight_kg numeric,
  p_notes text,
  p_minimum_handling text,
  p_override_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_order_id uuid;
  v_manufacturing_weight numeric(14,3);
  v_status text;
  v_compatibility_signature text;
  v_compatibility_label text;
begin
  if coalesce(p_minimum_handling, 'queue') not in ('queue', 'override') then
    raise exception 'Minimum handling must be queue or override';
  end if;
  v_order_id := private.create_order_from_quote_with_dealer_stock(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes
  );

  if private.get_current_user_dealer_id() is not null then
    perform private.create_dealer_order_from_order_atomic(v_order_id);
  end if;

  select round(coalesce(manufacturing_weight_kg, 0), 3)
  into v_manufacturing_weight
  from public.orders
  where id = v_order_id and company_id = v_company_id;

  select
    string_agg(requirement.signature_part, ',' order by requirement.signature_part),
    string_agg(requirement.label_part, ', ' order by requirement.signature_part)
  into v_compatibility_signature, v_compatibility_label
  from (
    select distinct
      concat_ws('|', upper(coalesce(source.alloy, 'UNKNOWN')), upper(coalesce(source.temper, 'UNKNOWN')), coalesce(source.billet_diameter_inch::text, 'UNKNOWN')) as signature_part,
      concat_ws(' / ', coalesce(source.alloy, 'Unknown alloy'), coalesce(source.temper, 'Unknown temper'), coalesce(source.billet_diameter_inch::text || ' in', 'Unknown diameter')) as label_part
    from public.order_billet_requirements source
    where source.company_id = v_company_id
      and source.order_id = v_order_id
      and source.required_weight_kg > 0
  ) requirement;

  -- Missing material requirements are never silently treated as compatible.
  v_compatibility_signature := coalesce(v_compatibility_signature, 'ORDER:' || v_order_id::text);
  v_compatibility_label := coalesce(v_compatibility_label, 'Material requirement not captured');

  if v_manufacturing_weight > 0 and v_manufacturing_weight < 700 then
    if coalesce(p_minimum_handling, 'queue') = 'override' then
      if v_role not in ('owner','admin','factory_manager','production_manager') then
        raise exception 'Only an owner or factory/production manager can override the factory minimum' using errcode = '42501';
      end if;
      if length(trim(coalesce(p_override_reason, ''))) < 8 then
        raise exception 'Enter a clear reason for the below-minimum production release';
      end if;
      v_status := 'overridden';
    else
      v_status := 'pending';
    end if;

    insert into public.factory_load_consolidations(
      company_id, order_id, manufacturing_weight_kg, compatibility_signature, compatibility_label, status,
      release_reason, released_by, released_at, created_by
    ) values (
      v_company_id, v_order_id, v_manufacturing_weight, v_compatibility_signature, v_compatibility_label, v_status,
      case when v_status = 'overridden' then trim(p_override_reason) else null end,
      case when v_status = 'overridden' then auth.uid() else null end,
      case when v_status = 'overridden' then now() else null end,
      auth.uid()
    )
    on conflict (company_id, order_id) do update set
      manufacturing_weight_kg = excluded.manufacturing_weight_kg,
      compatibility_signature = excluded.compatibility_signature,
      compatibility_label = excluded.compatibility_label,
      status = excluded.status,
      release_reason = excluded.release_reason,
      released_by = excluded.released_by,
      released_at = excluded.released_at,
      updated_at = now();

    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (
      v_company_id,
      auth.uid(),
      case when v_status = 'overridden' then 'factory_minimum_overridden' else 'factory_load_queued' end,
      'order',
      v_order_id,
      jsonb_build_object(
        'manufacturing_weight_kg', v_manufacturing_weight,
        'minimum_weight_kg', 700,
        'reason', case when v_status = 'overridden' then trim(p_override_reason) else null end
      )
    );
  end if;

  return v_order_id;
end;
$$;

create or replace function private.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid, p_order_number text, p_order_date date,
  p_expected_dispatch_date date, p_priority text,
  p_dealer_fulfilled_weight_kg numeric, p_notes text
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes, 'queue', null
  )
$$;

create or replace function public.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid, p_order_number text, p_order_date date,
  p_expected_dispatch_date date, p_priority text,
  p_dealer_fulfilled_weight_kg numeric, p_notes text,
  p_minimum_handling text, p_override_reason text
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes,
    p_minimum_handling, p_override_reason
  )
$$;

create or replace function public.create_order_from_quote_with_dealer_workflow_atomic(
  p_quote_id uuid, p_order_number text, p_order_date date,
  p_expected_dispatch_date date, p_priority text,
  p_dealer_fulfilled_weight_kg numeric, p_notes text
)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.create_order_from_quote_with_dealer_workflow_atomic(
    p_quote_id, p_order_number, p_order_date, p_expected_dispatch_date,
    p_priority, p_dealer_fulfilled_weight_kg, p_notes
  )
$$;

create or replace function private.release_factory_loads_atomic(
  p_queue_ids uuid[],
  p_group_code text,
  p_override boolean,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_count integer;
  v_weight numeric(14,3);
  v_minimum numeric(14,3);
  v_compatibility_count integer;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','factory_manager','production_manager') then
    raise exception 'Permission denied for factory load release' using errcode = '42501';
  end if;
  if coalesce(array_length(p_queue_ids, 1), 0) = 0 then raise exception 'Select at least one queued order'; end if;

  perform 1 from public.factory_load_consolidations
  where company_id = v_company_id and id = any(p_queue_ids)
  order by id for update;

  select count(*), round(sum(manufacturing_weight_kg), 3), max(minimum_weight_kg), count(distinct compatibility_signature)
  into v_count, v_weight, v_minimum, v_compatibility_count
  from public.factory_load_consolidations
  where company_id = v_company_id and id = any(p_queue_ids) and status = 'pending';

  if v_count <> cardinality(p_queue_ids) then raise exception 'Every selected load must be pending in this company'; end if;
  if p_override then
    if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear manager override reason'; end if;
  elsif v_compatibility_count <> 1 then
    raise exception 'Selected orders have incompatible alloy, temper, or billet-diameter requirements';
  elsif v_weight < v_minimum then
    raise exception 'Combined load is % kg; at least % kg is required', v_weight, v_minimum;
  elsif nullif(trim(coalesce(p_group_code, '')), '') is null then
    raise exception 'Enter the combined load or furnace group reference';
  end if;

  update public.factory_load_consolidations
  set status = case when p_override then 'overridden' else 'consolidated' end,
      consolidation_group = case when p_override then null else nullif(trim(p_group_code), '') end,
      release_reason = case when p_override then trim(p_reason) else 'Released as combined factory load' end,
      released_by = auth.uid(), released_at = now(), updated_at = now()
  where company_id = v_company_id and id = any(p_queue_ids) and status = 'pending';
  get diagnostics v_count = row_count;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  select
    v_company_id,
    auth.uid(),
    case when p_override then 'factory_minimum_overridden' else 'factory_load_consolidated' end,
    'factory_load_consolidation',
    queue.id,
    jsonb_build_object(
      'order_id', queue.order_id,
      'manufacturing_weight_kg', queue.manufacturing_weight_kg,
      'combined_weight_kg', v_weight,
      'compatibility_signature', queue.compatibility_signature,
      'group_code', nullif(trim(p_group_code), ''),
      'reason', case when p_override then trim(p_reason) else 'Released as combined factory load' end
    )
  from public.factory_load_consolidations queue
  where queue.company_id = v_company_id and queue.id = any(p_queue_ids);
  return v_count;
end;
$$;

create or replace function public.release_factory_loads_atomic(
  p_queue_ids uuid[], p_group_code text, p_override boolean, p_reason text
)
returns integer
language sql
security invoker
set search_path = public, private
as $$ select private.release_factory_loads_atomic(p_queue_ids, p_group_code, p_override, p_reason) $$;

create or replace function public.guard_pending_factory_load()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_id is not null
     and new.status in ('ready','in_progress','completed')
     and exists (
       select 1 from public.factory_load_consolidations queue
       where queue.company_id = new.company_id
         and queue.order_id = new.order_id
         and queue.status = 'pending'
     ) then
    raise exception 'This order is waiting in the sub-700 kg consolidation queue';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_pending_factory_load on public.production_jobs;
create trigger guard_pending_factory_load
before insert or update of order_id, status on public.production_jobs
for each row execute function public.guard_pending_factory_load();

revoke all on function private.create_order_from_quote_with_dealer_workflow_atomic(uuid,text,date,date,text,numeric,text,text,text) from public, anon;
revoke all on function private.release_factory_loads_atomic(uuid[],text,boolean,text) from public, anon, authenticated;
revoke all on function public.validate_operator_dispatch_bundle() from public, anon, authenticated;
revoke all on function public.guard_pending_factory_load() from public, anon, authenticated;
revoke all on function public.create_order_from_quote_with_dealer_workflow_atomic(uuid,text,date,date,text,numeric,text,text,text) from public, anon;
revoke all on function public.release_factory_loads_atomic(uuid[],text,boolean,text) from public, anon;
grant execute on function private.create_order_from_quote_with_dealer_workflow_atomic(uuid,text,date,date,text,numeric,text,text,text) to authenticated;
grant execute on function public.create_order_from_quote_with_dealer_workflow_atomic(uuid,text,date,date,text,numeric,text,text,text) to authenticated;
grant execute on function public.release_factory_loads_atomic(uuid[],text,boolean,text) to authenticated;

commit;
