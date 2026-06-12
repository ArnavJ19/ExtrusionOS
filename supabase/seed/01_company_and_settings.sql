-- Part 1: Company + Settings (run first)
-- Uses your EXISTING company_id and user_id from app_users table.
-- Replace the placeholder below after running: SELECT id FROM companies LIMIT 1;

do $$
declare
  v_company_id uuid;
  v_user_id uuid;
begin
  select id into v_company_id from public.companies limit 1;
  select id into v_user_id from public.app_users where company_id = v_company_id limit 1;

  if v_company_id is null then
    raise exception 'No company found. Sign up first via the app.';
  end if;

  -- Update company details
  update public.companies set
    name = 'Shree Balaji Extrusions Pvt. Ltd.',
    legal_name = 'Shree Balaji Extrusions Private Limited',
    gst_number = '24AABCS1234F1ZP',
    phone = '+91 79 2583 4567',
    email = 'info@shreebalaji-extrusions.com',
    billing_address = 'Plot No. 42, GIDC Industrial Estate, Phase-II',
    city = 'Rajkot', state = 'Gujarat', pincode = '360003'
  where id = v_company_id;

  -- Upsert company settings
  insert into public.company_settings (company_id, default_gst_percent, default_margin_percent,
    default_conversion_charge_per_kg, default_packing_charge, default_transport_charge,
    default_quote_validity_days, minimum_margin_percent, default_payment_terms,
    default_delivery_terms, default_bank_details, default_terms_and_conditions)
  values (v_company_id, 18, 12, 28, 500, 1500, 15, 8,
    '50% advance with order, balance before dispatch',
    '10-15 working days after die readiness and billet availability',
    'Bank: HDFC Bank, Rajkot Branch | A/c: 50100123456789 | IFSC: HDFC0001234',
    E'1. Prices valid until validity date.\n2. GST extra as applicable.\n3. Delivery depends on die/billet availability.\n4. Transport extra unless mentioned.\n5. No cancellation after production starts.')
  on conflict (company_id) do update set
    default_gst_percent = 18, default_margin_percent = 12,
    default_conversion_charge_per_kg = 28, default_packing_charge = 500,
    default_transport_charge = 1500, default_quote_validity_days = 15,
    minimum_margin_percent = 8,
    default_payment_terms = excluded.default_payment_terms,
    default_delivery_terms = excluded.default_delivery_terms,
    default_bank_details = excluded.default_bank_details,
    default_terms_and_conditions = excluded.default_terms_and_conditions;

  raise notice 'Company: % | User: %', v_company_id, v_user_id;
end $$;
