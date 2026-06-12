-- Part 2: 1000 Customers
do $$
declare
  v_cid uuid;
  v_uid uuid;
  i int;
  cities text[] := array['Ahmedabad','Rajkot','Surat','Vadodara','Mumbai','Pune','Jaipur','Delhi','Hyderabad','Bangalore','Chennai','Indore','Ludhiana','Kolkata','Nagpur','Nashik','Coimbatore','Bhopal','Kochi','Chandigarh'];
  states text[] := array['Gujarat','Gujarat','Gujarat','Gujarat','Maharashtra','Maharashtra','Rajasthan','Delhi','Telangana','Karnataka','Tamil Nadu','Madhya Pradesh','Punjab','West Bengal','Maharashtra','Maharashtra','Tamil Nadu','Madhya Pradesh','Kerala','Chandigarh'];
  types text[] := array['fabricator','dealer','architect','industrial','solar','government','export','contractor','other'];
  prefixes text[] := array['Shree','Sri','Jai','Royal','National','Modern','Supreme','Prime','Star','Golden','Silver','Diamond','Classic','Elite','Global','Metro','Omega','Alpha','Zenith','Apex'];
  names text[] := array['Aluminium','Fenestra','Buildtech','Industries','Fabricators','Enterprises','Systems','Solutions','Infra','Engineering','Traders','Hardware','Glazing','Metals','Works','Corporation','Products','Associates','Structures','Interiors'];
  contact_names text[] := array['Rajesh Patel','Amit Shah','Suresh Kumar','Vikram Singh','Mahesh Joshi','Dinesh Agarwal','Ramesh Mehta','Prakash Verma','Kamlesh Desai','Sunil Sharma','Anil Gupta','Mukesh Jain','Nilesh Patel','Hitesh Modi','Jayesh Thakkar','Paresh Chauhan','Ketan Dave','Manish Parikh','Brijesh Tiwari','Gaurav Saxena'];
begin
  select id into v_cid from public.companies limit 1;
  select id into v_uid from public.app_users where company_id = v_cid limit 1;

  for i in 1..1000 loop
    insert into public.customers (
      company_id, customer_name, company_name, customer_type,
      phone, whatsapp_number, email, gst_number,
      billing_address, shipping_address, city, state, pincode,
      contact_person, payment_terms, is_active, created_by
    ) values (
      v_cid,
      contact_names[1 + (i % 20)],
      prefixes[1 + (i % 20)] || ' ' || names[1 + ((i/20) % 20)] || ' ' ||
        case when i % 3 = 0 then 'Pvt. Ltd.' when i % 3 = 1 then 'LLP' else '' end,
      types[1 + (i % 9)],
      '+91 ' || (7000000000 + i * 97)::text,
      '+91 ' || (7000000000 + i * 97)::text,
      'customer' || i || '@example.com',
      case when i % 4 != 0 then '24AAB' || lpad(i::text, 4, '0') || 'F1Z' || chr(65 + (i%26)) else null end,
      'Plot ' || (i*3) || ', ' || case when i%3=0 then 'GIDC' when i%3=1 then 'Industrial Area' else 'Market Yard' end,
      case when i%2=0 then 'Same as billing' else 'Warehouse ' || i end,
      cities[1 + (i % 20)],
      states[1 + (i % 20)],
      lpad((360001 + i % 5000)::text, 6, '0'),
      contact_names[1 + ((i+7) % 20)],
      case when i%3=0 then '30 days' when i%3=1 then '50% advance' else '100% advance' end,
      i % 25 != 0,
      v_uid
    );
  end loop;

  raise notice 'Inserted 1000 customers';
end $$;
