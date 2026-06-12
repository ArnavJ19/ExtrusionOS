-- Part 3: 120 Profiles, 400 Dies, 8 Machines, 20 Vendors
do $$
declare
  v_cid uuid; v_uid uuid; i int;
  profile_ids uuid[];
  customer_ids uuid[];
  prof_codes text[] := array['SW','CW','DR','PRT','RL','SOL','HS','IND','EL','FRN','CUR','SLD'];
  prof_names text[] := array['Sliding Window','Casement Window','Door Section','Partition','Railing','Solar Frame','Heat Sink','Industrial','Electrical Channel','Furniture Trim','Curtain Wall','Sliding Door'];
  prof_cats text[] := array['sliding_window','casement_window','door','partition','railing','solar','heat_sink','industrial','electrical','furniture','curtain_wall','sliding_window'];
  alloys text[] := array['6063','6061','6082','6005','6463','6060'];
  tempers text[] := array['T5','T6','T4','T66','O'];
  die_statuses text[] := array['active','active','active','active','active','trial','correction','nitriding','inactive','dead'];
  racks text[] := array['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3'];
  mfrs text[] := array['Almax Italy','Technopress','Sapa Dies','Prashant Dies Rajkot','Bharat Die Works','National Die','ND Tools'];
begin
  select id into v_cid from public.companies limit 1;
  select id into v_uid from public.app_users where company_id = v_cid limit 1;
  select array_agg(id order by random()) into customer_ids from public.customers where company_id = v_cid;

  -- 120 Profiles
  for i in 1..120 loop
    insert into public.aluminium_profiles (
      company_id, profile_code, profile_name, application_category,
      section_weight_kg_per_m, alloy, temper, standard_length_m, is_active, created_by
    ) values (
      v_cid,
      prof_codes[1 + (i % 12)] || '-' || lpad(i::text, 3, '0'),
      prof_names[1 + (i % 12)] || ' ' || i,
      prof_cats[1 + (i % 12)],
      round((0.2 + random() * 3.5)::numeric, 3),
      alloys[1 + (i % 6)],
      tempers[1 + (i % 5)],
      case when i%3=0 then 5.8 when i%3=1 then 6.1 else 3.0 end,
      i % 15 != 0,
      v_uid
    ) on conflict (company_id, profile_code) do nothing;
  end loop;

  select array_agg(id order by profile_code) into profile_ids from public.aluminium_profiles where company_id = v_cid;

  -- 400 Dies
  for i in 1..400 loop
    insert into public.dies (
      company_id, die_number, profile_id, customer_id, ownership_type, die_status,
      rack_location, total_production_kg, total_runs, last_used_date,
      die_manufacturer, die_cost, purchase_date, notes, created_by
    ) values (
      v_cid,
      'D-' || lpad(i::text, 4, '0'),
      profile_ids[1 + (i % array_length(profile_ids,1))],
      case when i%5=0 then customer_ids[1 + (i % array_length(customer_ids,1))] else null end,
      case when i%5=0 then 'customer_owned' else 'company_owned' end,
      die_statuses[1 + (i % 10)],
      racks[1 + (i % 12)] || '-' || ((i/12)+1),
      round((random() * 50000)::numeric, 1),
      floor(random() * 200)::int,
      current_date - (floor(random() * 365))::int,
      mfrs[1 + (i % 7)],
      round((8000 + random() * 42000)::numeric, 0),
      current_date - (365 + floor(random() * 730))::int,
      case when i%10=0 then 'Needs nitriding soon' when i%15=0 then '2nd correction done' else null end,
      v_uid
    ) on conflict (company_id, die_number) do nothing;
  end loop;

  -- 8 Machines
  insert into public.machines (company_id, machine_name, machine_type, press_capacity_ton, status, location) values
    (v_cid, '1800T Extrusion Press #1', 'extrusion_press', 1800, 'active', 'Bay 1'),
    (v_cid, '1200T Extrusion Press #2', 'extrusion_press', 1200, 'active', 'Bay 2'),
    (v_cid, '800T Extrusion Press #3', 'extrusion_press', 800, 'maintenance', 'Bay 3'),
    (v_cid, 'Aging Oven #1', 'aging_oven', null, 'active', 'Heat Treatment'),
    (v_cid, 'Aging Oven #2', 'aging_oven', null, 'active', 'Heat Treatment'),
    (v_cid, 'Powder Coating Line', 'powder_coating_line', null, 'active', 'Finishing Bay'),
    (v_cid, 'Anodizing Line', 'anodizing_line', null, 'active', 'Finishing Bay'),
    (v_cid, 'Auto Cutting Machine', 'cutting_machine', null, 'active', 'Cutting Area');

  -- 20 Vendors
  for i in 1..20 loop
    insert into public.vendors (
      company_id, vendor_name, vendor_type, contact_person, phone, gst_number, city, state, is_active
    ) values (
      v_cid,
      (array['Hindalco','Vedanta','Balco','National','Bharat','Gujarat','Rajkot','Modern','Prime','Supreme',
             'Excel','Star','Diamond','Shree','Jai','Royal','Classic','Metro','Global','Apex'])[i] ||
        ' ' || (array['Billets','Metals','Dies','Coating','Anodizing','Transport','Hardware','Packing',
                       'Aluminium','Suppliers','Industries','Works','Enterprises','Trading','Services',
                       'Engineering','Chemicals','Solutions','Logistics','Materials'])[i],
      (array['aluminum_billets','aluminum_ingot','aluminum_sows','die_maker','die_maker',
             'powder_coating','anodizing','transporter','hardware_supplier','packing_supplier',
             'aluminum_t_ingots','die_maker','powder_coating','anodizing','transporter',
             'maintenance','hardware_supplier','packing_supplier','aluminum_wire_rods','other'])[i],
      'Contact ' || i, '+91 9' || lpad((800000000 + i*111)::text, 9, '0'),
      '24BBB' || lpad(i::text, 4, '0') || 'G1Z' || chr(65+i),
      (array['Ahmedabad','Rajkot','Surat','Vadodara','Mumbai','Pune','Jaipur','Delhi','Hyderabad','Bangalore','Chennai','Indore','Ludhiana','Kolkata','Nagpur','Nashik','Coimbatore','Bhopal','Kochi','Chandigarh'])[1+(i%20)],
      (array['Gujarat','Gujarat','Gujarat','Gujarat','Maharashtra','Maharashtra','Rajasthan','Delhi','Telangana','Karnataka','Tamil Nadu','Madhya Pradesh','Punjab','West Bengal','Maharashtra','Maharashtra','Tamil Nadu','Madhya Pradesh','Kerala','Chandigarh'])[1+(i%20)],
      true
    );
  end loop;

  raise notice 'Inserted 120 profiles, 400 dies, 8 machines, 20 vendors';
end $$;
