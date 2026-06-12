-- Part 5: 300 Inventory, Production Jobs, Quality, Invoices, Scrap, Billets
do $$
declare
  v_cid uuid; v_uid uuid; i int;
  order_ids uuid[]; profile_ids uuid[]; die_ids uuid[];
  machine_ids uuid[]; vendor_ids uuid[]; customer_ids uuid[];
  inv_id uuid; o_id uuid;
  cats text[] := array['billets','extruded_profiles','hardware','powder_coating_material','packing_material','scrap','finished_goods'];
  units text[] := array['kg','kg','pcs','kg','pcs','kg','kg'];
begin
  select id into v_cid from public.companies limit 1;
  select id into v_uid from public.app_users where company_id = v_cid limit 1;
  select array_agg(id order by random()) into order_ids from public.orders where company_id = v_cid limit 100;
  select array_agg(id order by random()) into profile_ids from public.aluminium_profiles where company_id = v_cid and is_active;
  select array_agg(id order by random()) into die_ids from public.dies where company_id = v_cid and die_status='active';
  select array_agg(id order by random()) into machine_ids from public.machines where company_id = v_cid;
  select array_agg(id order by random()) into vendor_ids from public.vendors where company_id = v_cid;
  select array_agg(id order by random()) into customer_ids from public.customers where company_id = v_cid limit 100;

  -- 300 Inventory Items
  for i in 1..300 loop
    insert into public.inventory_items (
      company_id, item_code, item_name, item_category, unit,
      current_stock, reorder_level, average_rate, location, is_active
    ) values (
      v_cid,
      'INV-' || lpad(i::text, 4, '0'),
      case
        when i<=50 then 'Billet 6063 T5 ' || (150+(i%5)*25) || 'mm'
        when i<=150 then 'Profile Stock ' || profile_ids[1+((i-50) % array_length(profile_ids,1))]::text
        when i<=200 then 'Powder ' || (array['RAL 9010 White','RAL 8014 Brown','RAL 7035 Grey','RAL 9005 Black','RAL 1015 Ivory'])[1+(i%5)]
        when i<=250 then 'Hardware Item ' || i
        else 'Packing Roll ' || i
      end,
      cats[1 + (i % 7)],
      units[1 + (i % 7)],
      round((10 + random()*5000)::numeric, 1),
      round((50 + random()*500)::numeric, 0),
      round((50 + random()*300)::numeric, 2),
      (array['Main Store','Bay 1','Bay 2','Finishing Store','Dispatch Area','Scrap Yard'])[1+(i%6)],
      i%20 != 0
    );
  end loop;

  -- 80 Production Jobs
  for i in 1..80 loop
    insert into public.production_jobs (
      company_id, order_id, machine_id, die_id, profile_id,
      planned_date, shift, planned_quantity_kg, actual_quantity_kg,
      planned_meters, actual_meters, status, operator_name, remarks
    ) values (
      v_cid,
      order_ids[1 + (i % array_length(order_ids,1))],
      machine_ids[1 + (i % array_length(machine_ids,1))],
      die_ids[1 + (i % array_length(die_ids,1))],
      profile_ids[1 + (i % array_length(profile_ids,1))],
      current_date - (floor(random()*60))::int + (floor(random()*30))::int,
      case when i%2=0 then 'day' else 'night' end,
      round((200 + random()*3000)::numeric, 1),
      case when i%4!=3 then round((180 + random()*2800)::numeric, 1) else 0 end,
      round((50 + random()*500)::numeric, 1),
      case when i%4!=3 then round((45 + random()*480)::numeric, 1) else 0 end,
      (array['planned','ready','in_progress','completed','completed','completed','on_hold','completed'])[1+(i%8)],
      (array['Ramesh','Suresh','Dinesh','Kamlesh','Jayesh','Prakash','Vijay','Ashok'])[1+(i%8)],
      case when i%10=0 then 'Die correction needed' when i%7=0 then 'Billet quality issue' else null end
    );
  end loop;

  -- 50 Quality Inspections
  for i in 1..50 loop
    insert into public.quality_inspections (
      company_id, profile_id, batch_number,
      quantity_checked_kg, dimensional_variance,
      hardness_webster, surface_finish_ok, weight_per_meter_actual,
      status, inspector_name
    ) values (
      v_cid,
      profile_ids[1 + (i % array_length(profile_ids,1))],
      'QC-' || lpad(i::text, 5, '0'),
      round((100 + random()*2000)::numeric, 1),
      case when i%5=0 then '+0.15mm on web' when i%7=0 then '-0.08mm flange' else 'Within tolerance' end,
      round((12 + random()*6)::numeric, 1),
      i%8 != 0,
      round((0.3 + random()*2.5)::numeric, 3),
      (array['pending','approved','approved','approved','rejected','rework','approved','approved'])[1+(i%8)],
      (array['QC Ramesh','QC Sunil','QC Prakash','QC Dinesh','QC Anil'])[1+(i%5)]
    );
  end loop;

  -- 40 Invoices with payments
  for i in 1..40 loop
    select id into o_id from public.orders where company_id = v_cid offset (i-1) limit 1;

    insert into public.invoices (
      company_id, customer_id, order_id,
      invoice_number, invoice_date, due_date,
      subtotal, tax_total, grand_total,
      amount_paid, status
    ) values (
      v_cid,
      customer_ids[1 + (i % array_length(customer_ids,1))],
      o_id,
      'INV-2026-' || lpad(i::text, 4, '0'),
      current_date - (floor(random()*60))::int,
      current_date + (floor(random()*30))::int,
      round((10000 + random()*300000)::numeric, 2),
      round((1800 + random()*54000)::numeric, 2),
      round((11800 + random()*354000)::numeric, 2),
      case when i%4=0 then round((11800 + random()*354000)::numeric, 2)
           when i%4=1 then round((5000 + random()*100000)::numeric, 2)
           else 0 end,
      (array['draft','generated','sent','partially_paid','paid','paid','overdue','sent'])[1+(i%8)]
    ) returning id into inv_id;

    -- Add payment for paid invoices
    if i%4 = 0 then
      insert into public.payments (company_id, invoice_id, payment_date, amount, payment_method, reference_number)
      values (v_cid, inv_id, current_date-(floor(random()*15))::int,
              round((10000+random()*200000)::numeric,2),
              (array['bank_transfer','upi','cheque','cash'])[1+(i%4)],
              'PAY-' || lpad(i::text, 6, '0'));
    end if;
  end loop;

  -- 30 Billet Batches
  for i in 1..30 loop
    insert into public.billet_batches (
      company_id, batch_number, supplier_id, alloy, temper,
      diameter_mm, length_mm, total_weight_kg, available_weight_kg,
      rate_per_kg, heat_number, received_date, status
    ) values (
      v_cid,
      'BLT-' || lpad(i::text, 4, '0'),
      vendor_ids[1 + (i % least(array_length(vendor_ids,1), 5))],
      (array['6063','6061','6082','6005','6463'])[1+(i%5)],
      (array['T5','T6','T4','T66'])[1+(i%4)],
      (array[152, 178, 203, 228, 254])[1+(i%5)],
      (array[500, 600, 700, 800])[1+(i%4)],
      round((2000 + random()*18000)::numeric, 1),
      round((500 + random()*15000)::numeric, 1),
      round((195 + random()*25)::numeric, 2),
      'HN-' || lpad(i::text, 6, '0'),
      current_date - (floor(random()*90))::int,
      (array['available','available','available','consumed','available'])[1+(i%5)]
    );
  end loop;

  -- 60 Scrap Records
  for i in 1..60 loop
    insert into public.scrap_records (
      company_id, order_id, profile_id, die_id,
      scrap_type, weight_kg, reason, recorded_date, recorded_by
    ) values (
      v_cid,
      order_ids[1 + (i % array_length(order_ids,1))],
      profile_ids[1 + (i % array_length(profile_ids,1))],
      die_ids[1 + (i % array_length(die_ids,1))],
      (array['butt_scrap','process_scrap','rejection','cutting_waste','coating_rejection','remelt_scrap'])[1+(i%6)],
      round((5 + random()*200)::numeric, 1),
      case when i%3=0 then 'Die run-out' when i%3=1 then 'Surface defect' else 'Cutting waste' end,
      current_date - (floor(random()*60))::int,
      v_uid
    );
  end loop;

  raise notice 'Inserted 300 inventory, 80 jobs, 50 QC, 40 invoices, 30 billets, 60 scrap';
end $$;
