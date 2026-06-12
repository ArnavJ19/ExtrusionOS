-- Development-only seed. Replace the UUID below with an existing auth.users.id.
do $$
declare
  demo_user uuid := '00000000-0000-0000-0000-000000000000';
  demo_company uuid := gen_random_uuid();
  abc_customer uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  p3 uuid := gen_random_uuid();
  p4 uuid := gen_random_uuid();
  q1 uuid := gen_random_uuid();
begin
  if demo_user = '00000000-0000-0000-0000-000000000000' then
    raise notice 'Replace demo_user with a real auth.users.id before running seed.sql';
    return;
  end if;

  insert into public.companies (id, name, legal_name, gst_number, city, state, phone, email)
  values (demo_company, 'Omalco Extrusions', 'Omalco Extrusions Private Limited', '08ABCDE1234F1Z5', 'Jaipur', 'Rajasthan', '+919876543210', 'sales@omalco.example');

  insert into public.app_users (id, company_id, full_name, email, role)
  values (demo_user, demo_company, 'Demo Owner', 'owner@omalco.example', 'owner')
  on conflict (id) do update set company_id = excluded.company_id, role = excluded.role;

  insert into public.company_settings (company_id, default_gst_percent, default_margin_percent, default_conversion_charge_per_kg, default_quote_terms)
  values (demo_company, 18, 10, 22, 'Prices are valid until the validity date mentioned. Delivery depends on die, billet, and finishing availability.');

  insert into public.customers (id, company_id, customer_name, company_name, customer_type, phone, whatsapp_number, gst_number, city, state, created_by) values
    (abc_customer, demo_company, 'ABC Fabricators', 'ABC Fabricators', 'fabricator', '+919811111111', '+919811111111', '08AAACA1234A1Z5', 'Jaipur', 'Rajasthan', demo_user),
    (gen_random_uuid(), demo_company, 'Sunrise Solar Structures', 'Sunrise Solar Structures', 'solar', '+919822222222', '+919822222222', null, 'Ahmedabad', 'Gujarat', demo_user),
    (gen_random_uuid(), demo_company, 'Modern Aluminium Systems', 'Modern Aluminium Systems', 'dealer', '+919833333333', '+919833333333', null, 'Delhi', 'Delhi', demo_user),
    (gen_random_uuid(), demo_company, 'Jaipur Facade Works', 'Jaipur Facade Works', 'architect', '+919844444444', '+919844444444', null, 'Jaipur', 'Rajasthan', demo_user);

  insert into public.aluminium_profiles (id, company_id, profile_code, profile_name, application_category, section_weight_kg_per_m, alloy, temper, standard_length_m, created_by) values
    (p1, demo_company, 'SL-2001', '2 Track Sliding Window Bottom', 'sliding_window', 0.850, '6063', 'T6', 5.8, demo_user),
    (p2, demo_company, 'SL-2002', '2 Track Sliding Window Top', 'sliding_window', 0.720, '6063', 'T6', 5.8, demo_user),
    (p3, demo_company, 'SF-1001', 'Solar Frame Profile', 'solar', 0.650, '6063', 'T6', 6.0, demo_user),
    (p4, demo_company, 'HS-3001', 'Industrial Heat Sink', 'heat_sink', 1.250, '6061', 'T6', 3.66, demo_user);

  insert into public.dies (company_id, die_number, profile_id, customer_id, ownership_type, die_status, rack_location, created_by) values
    (demo_company, 'D-1001', p1, null, 'company_owned', 'active', 'A-01', demo_user),
    (demo_company, 'D-1002', p2, null, 'company_owned', 'correction', 'A-02', demo_user),
    (demo_company, 'D-1003', p3, null, 'company_owned', 'trial', 'B-04', demo_user),
    (demo_company, 'D-1004', p4, abc_customer, 'customer_owned', 'active', 'C-02', demo_user);

  insert into public.quotes (id, company_id, quote_number, customer_id, quote_date, valid_until, status, revision_number, subtotal, total_margin_amount, total_before_gst, gst_percent, gst_amount, grand_total, estimated_profit_amount, estimated_profit_percent, delivery_timeline, payment_terms, created_by)
  values (q1, demo_company, 'Q-2026-0001', abc_customer, current_date, current_date + 15, 'sent', 1, 156355.50, 11580.84, 156355.50, 18, 28143.99, 184499.49, 11580.84, 7.41, '10-12 working days after approval', '50% advance, balance before dispatch', demo_user);

  insert into public.quote_items (company_id, quote_id, profile_id, item_description, quantity_pieces, length_per_piece_m, total_meters, section_weight_kg_per_m, total_weight_kg, scrap_allowance_percent, expected_recovery_percent, effective_weight_kg, minimum_billing_weight_kg, billing_weight_kg, billet_rate_per_kg, raw_material_cost, conversion_charge_per_kg, conversion_cost, finishing_type, finishing_charge_type, finishing_charge, finishing_cost, die_amortization_type, die_amortization_amount, margin_percent, margin_amount, minimum_margin_percent, approval_required, estimated_profit_amount, estimated_profit_percent, line_subtotal, line_total_before_gst, price_per_kg, price_per_meter)
  values (demo_company, q1, p1, 'Sliding window bottom profile', 106, 5.8, 614.8, 0.850, 522.58, 0, 100, 522.58, 0, 522.58, 255, 133257.90, 22, 11496.76, 'mill_finish', 'per_kg', 0, 0, 'full_die_charge', 0, 8, 11580.84, 8, true, 11580.84, 7.41, 144754.66, 156335.50, 299.16, 254.28);
end $$;
