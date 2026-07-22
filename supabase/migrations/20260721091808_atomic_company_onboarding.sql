alter table public.feature_flags
  drop constraint if exists feature_flags_module_check;

alter table public.feature_flags
  add constraint feature_flags_module_check check (module_name = any (array[
    'ai_assistant', 'whatsapp_automation', 'dealer_portal', 'advanced_inventory',
    'production_planning', 'quality_compliance', 'export_docs', 'tender_management',
    'energy_monitoring', 'machine_maintenance', 'bis_compliance',
    'profitability_intelligence', 'barcode_tracking', 'accounting_integrations',
    'mobile_floor_app', 'multi_plant', 'systems_configurator',
    'document_intelligence', 'die_intelligence', 'crm', 'report_builder',
    'automation', 'command_center'
  ]));

create or replace function private.onboard_company_atomic(
  p_company jsonb,
  p_profile jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_company_id uuid;
  v_company_name text := nullif(trim(p_company ->> 'name'), '');
  v_full_name text := nullif(trim(p_profile ->> 'full_name'), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_company_name is null or v_full_name is null then
    raise exception 'Company name and user name are required';
  end if;

  if exists (select 1 from public.app_users where id = v_user_id) then
    raise exception 'This user already belongs to a company';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  insert into public.companies (
    name, legal_name, gst_number, phone, email, city, state,
    billing_address, created_by
  ) values (
    v_company_name,
    nullif(trim(p_company ->> 'legal_name'), ''),
    nullif(trim(p_company ->> 'gst_number'), ''),
    nullif(trim(p_profile ->> 'phone'), ''),
    v_email,
    nullif(trim(p_company ->> 'city'), ''),
    nullif(trim(p_company ->> 'state'), ''),
    nullif(trim(p_company ->> 'billing_address'), ''),
    v_user_id
  ) returning id into v_company_id;

  insert into public.app_users (
    id, company_id, full_name, email, phone, role, is_active, status
  ) values (
    v_user_id,
    v_company_id,
    v_full_name,
    v_email,
    nullif(trim(p_profile ->> 'phone'), ''),
    'owner',
    true,
    'active'
  );

  insert into public.company_settings (company_id, default_quote_terms)
  values (
    v_company_id,
    'Prices are valid until the mentioned date. GST and transport as mentioned. Delivery depends on die, billet, and finishing availability.'
  );

  insert into public.feature_flags (company_id, module_name, is_enabled, enabled_by, enabled_at)
  select
    v_company_id,
    module_name,
    module_name = any (array[
      'production_planning', 'advanced_inventory', 'quality_compliance',
      'command_center', 'energy_monitoring', 'machine_maintenance',
      'tender_management', 'export_docs', 'bis_compliance',
      'profitability_intelligence'
    ]),
    case when module_name = any (array[
      'production_planning', 'advanced_inventory', 'quality_compliance',
      'command_center', 'energy_monitoring', 'machine_maintenance',
      'tender_management', 'export_docs', 'bis_compliance',
      'profitability_intelligence'
    ]) then v_user_id end,
    case when module_name = any (array[
      'production_planning', 'advanced_inventory', 'quality_compliance',
      'command_center', 'energy_monitoring', 'machine_maintenance',
      'tender_management', 'export_docs', 'bis_compliance',
      'profitability_intelligence'
    ]) then now() end
  from unnest(array[
    'ai_assistant', 'whatsapp_automation', 'dealer_portal', 'advanced_inventory',
    'production_planning', 'quality_compliance', 'export_docs', 'tender_management',
    'energy_monitoring', 'machine_maintenance', 'bis_compliance',
    'profitability_intelligence', 'barcode_tracking', 'accounting_integrations',
    'mobile_floor_app', 'multi_plant', 'systems_configurator',
    'document_intelligence', 'die_intelligence', 'crm', 'report_builder',
    'automation', 'command_center'
  ]) as module_list(module_name);

  return v_company_id;
end;
$$;

create or replace function public.onboard_company_atomic(
  p_company jsonb,
  p_profile jsonb
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.onboard_company_atomic(p_company, p_profile)
$$;

revoke all on function private.onboard_company_atomic(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.onboard_company_atomic(jsonb, jsonb)
  from public, anon;
grant execute on function public.onboard_company_atomic(jsonb, jsonb)
  to authenticated;
