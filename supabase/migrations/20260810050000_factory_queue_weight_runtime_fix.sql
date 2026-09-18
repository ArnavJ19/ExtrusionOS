begin;

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
      v_company_id, auth.uid(),
      case when v_status = 'overridden' then 'factory_minimum_overridden' else 'factory_load_queued' end,
      'order', v_order_id,
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

revoke all on function private.create_order_from_quote_with_dealer_workflow_atomic(uuid, text, date, date, text, numeric, text, text, text) from public, anon, authenticated;

commit;
