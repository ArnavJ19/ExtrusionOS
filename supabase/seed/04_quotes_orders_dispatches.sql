-- Part 4: 70 Quotes with items, 150 Orders, 10 Dispatches
do $$
declare
  v_cid uuid; v_uid uuid; i int; j int;
  customer_ids uuid[]; profile_ids uuid[]; die_ids uuid[];
  q_id uuid; o_id uuid; d_id uuid;
  v_subtotal numeric; v_gst numeric; v_grand numeric;
  v_weight numeric; v_meters numeric; v_line numeric;
  statuses text[] := array['draft','internal_review','approved_for_sending','sent','customer_approved','converted_to_order'];
  stages text[] := array['order_confirmed','die_ready','billet_ready','extrusion_planned','extruded','cutting','aging','surface_treatment','finishing','packing','dispatched','delivered','closed'];
  priorities text[] := array['low','normal','normal','normal','high','urgent'];
begin
  select id into v_cid from public.companies limit 1;
  select id into v_uid from public.app_users where company_id = v_cid limit 1;
  select array_agg(id order by random()) into customer_ids from public.customers where company_id = v_cid and is_active limit 200;
  select array_agg(id order by random()) into profile_ids from public.aluminium_profiles where company_id = v_cid and is_active;
  select array_agg(id order by random()) into die_ids from public.dies where company_id = v_cid and die_status = 'active';

  -- 70 Quotes
  for i in 1..70 loop
    v_subtotal := round((5000 + random() * 500000)::numeric, 2);
    v_gst := round(v_subtotal * 0.18, 2);
    v_grand := v_subtotal + v_gst;

    insert into public.quotes (
      company_id, quote_number, customer_id, quote_date, valid_until,
      status, subtotal, total_margin_amount, total_before_gst,
      gst_percent, gst_amount, grand_total,
      estimated_profit_amount, estimated_profit_percent,
      revision_number, delivery_timeline, payment_terms, created_by
    ) values (
      v_cid,
      'Q-2026-' || lpad(i::text, 4, '0'),
      customer_ids[1 + (i % array_length(customer_ids,1))],
      current_date - (floor(random()*90))::int,
      current_date + (floor(random()*30))::int,
      statuses[1 + (i % 6)],
      v_subtotal, round(v_subtotal*0.12, 2), v_subtotal,
      18, v_gst, v_grand,
      round(v_subtotal*0.12, 2), 12.00,
      1, '10-15 working days', '50% advance',
      v_uid
    ) on conflict (company_id, quote_number) do nothing
    returning id into q_id;

    -- 1-4 items per quote (only if quote was inserted)
    if q_id is not null then
      for j in 1..(1 + (i % 4)) loop
        v_meters := round((10 + random()*200)::numeric, 2);
        v_weight := round((v_meters * (0.3 + random()*2))::numeric, 3);
        v_line := round((v_weight * (220 + random()*80))::numeric, 2);

        insert into public.quote_items (
          company_id, quote_id, profile_id, die_id, item_description,
          quantity_pieces, length_per_piece_m, total_meters,
          section_weight_kg_per_m, total_weight_kg,
          billet_rate_per_kg, raw_material_cost,
          conversion_charge_per_kg, conversion_cost,
          finishing_type, finishing_charge_type, finishing_charge, finishing_cost,
          die_charge, scrap_allowance_percent, effective_weight_kg,
          billing_weight_kg, margin_percent, margin_amount,
          line_subtotal, line_total_before_gst, price_per_kg, price_per_meter,
          estimated_profit_amount, estimated_profit_percent
        ) values (
          v_cid, q_id,
          profile_ids[1 + ((i*4+j) % array_length(profile_ids,1))],
          die_ids[1 + ((i*4+j) % array_length(die_ids,1))],
          'Extrusion item ' || j,
          (5 + floor(random()*200))::int,
          case when j%2=0 then 5.8 else 3.0 end,
          v_meters,
          round((0.3 + random()*2)::numeric, 3),
          v_weight,
          round((195 + random()*25)::numeric, 2),
          round(v_weight * 200, 2),
          28, round(v_weight*28, 2),
          (array['mill_finish','powder_coating','anodizing','wood_finish'])[1+(j%4)],
          'per_kg', round((0+random()*35)::numeric,2), round(v_weight*15,2),
          case when j%3=0 then round((15000+random()*25000)::numeric,0) else 0 end,
          5, round(v_weight*1.05,3),
          round(v_weight*1.05,3), 12, round(v_line*0.12,2),
          round(v_line*0.88,2), v_line,
          round(v_line/greatest(v_weight,0.1),2),
          round(v_line/greatest(v_meters,0.1),2),
          round(v_line*0.12,2), 12.00
        );
      end loop;
    end if;
  end loop;

  -- 150 Orders
  for i in 1..150 loop
    insert into public.orders (
      company_id, order_number, customer_id, order_date,
      expected_dispatch_date, priority, current_stage,
      order_value, created_by
    ) values (
      v_cid,
      'O-2026-' || lpad(i::text, 4, '0'),
      customer_ids[1 + (i % array_length(customer_ids,1))],
      current_date - (floor(random()*120))::int,
      current_date + (floor(random()*45))::int - 15,
      priorities[1 + (i % 6)],
      stages[1 + (i % 13)],
      round((10000 + random()*800000)::numeric, 2),
      v_uid
    ) on conflict (company_id, order_number) do nothing
    returning id into o_id;

    -- Stage history (only if order was inserted)
    if o_id is not null then
      insert into public.order_stage_history (company_id, order_id, stage, changed_by, remarks)
      values (v_cid, o_id, 'order_confirmed', v_uid, 'Order received');
    end if;
  end loop;

  -- 10 Dispatches (link to first 10 orders)
  for i in 1..10 loop
    select id into o_id from public.orders where company_id = v_cid
      order by created_at offset (i-1) limit 1;

    insert into public.dispatches (
      company_id, order_id, dispatch_number, dispatch_date,
      number_of_bundles, total_weight_kg,
      transporter_name, vehicle_number, driver_name, driver_phone,
      eway_bill_number, lr_number, delivery_status, created_by
    ) values (
      v_cid, o_id,
      'D-2026-' || lpad(i::text, 4, '0'),
      current_date - (floor(random()*30))::int,
      (2 + floor(random()*15))::int,
      round((500 + random()*5000)::numeric, 1),
      (array['Gati Transport','VRL Logistics','Delhivery','Rivigo','Safexpress','TCI','Blue Dart','DTDC','Maruti Transport','OM Logistics'])[i],
      'GJ-03-' || chr(65+i) || chr(65+(i*3)%26) || '-' || (1000+i*111),
      'Driver ' || i,
      '+91 98' || lpad((10000000 + i*1234)::text, 8, '0'),
      'EWB' || lpad(i::text, 12, '0'),
      'LR-' || lpad(i::text, 6, '0'),
      (array['pending','dispatched','in_transit','delivered','delivered','delivered','in_transit','dispatched','delivered','pending'])[i],
      v_uid
    ) on conflict (company_id, dispatch_number) do nothing;
  end loop;

  raise notice 'Inserted 70 quotes, 150 orders, 10 dispatches';
end $$;
