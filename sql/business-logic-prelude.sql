alter table public.aluminium_profiles add column if not exists hsn_code text;
alter table public.quote_items
  add column if not exists perimeter_mm numeric,
  add column if not exists surface_area_sqft numeric,
  add column if not exists billet_input_kg numeric(14,3),
  add column if not exists costing_complete boolean not null default false,
  add column if not exists hsn_code text;
alter table public.order_items add column if not exists hsn_code text;
alter table public.packing_list_items add column if not exists hsn_code text;
alter table public.invoice_items add column if not exists hsn_code text;
alter table public.companies add column if not exists gst_state_code text;
alter table public.invoices
  add column if not exists supplier_state_code text,
  add column if not exists place_of_supply_state_code text,
  add column if not exists cgst_amount numeric(14,2) not null default 0,
  add column if not exists sgst_amount numeric(14,2) not null default 0,
  add column if not exists utgst_amount numeric(14,2) not null default 0,
  add column if not exists igst_amount numeric(14,2) not null default 0;

-- All inserts allocate the identifier under the same transaction as the row.
-- RLS remains in force on the table operation; this function has no callable RPC.
create or replace function private.assign_business_number()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_prefix text := tg_argv[1];
  v_number text;
  v_date date := coalesce(nullif(to_jsonb(new) ->> tg_argv[2], '')::date, (now() at time zone 'Asia/Kolkata')::date);
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) ->> tg_argv[0] is distinct from to_jsonb(old) ->> tg_argv[0] then
      raise exception 'Business numbers are immutable after allocation';
    end if;
    return new;
  end if;
  if tg_table_name in ('quotes','orders','dispatches','invoices') then
    select coalesce(nullif(to_jsonb(s) ->> case tg_table_name when 'quotes' then 'quote_prefix' when 'orders' then 'order_prefix' when 'dispatches' then 'dispatch_prefix' else 'invoice_prefix' end, ''), tg_argv[1])
    into v_prefix from public.company_settings s where company_id = new.company_id;
    v_prefix := coalesce(v_prefix, tg_argv[1]);
  end if;
  v_number := private.next_business_number_locked(tg_relid::regclass, tg_argv[0], new.company_id, v_prefix, v_date);
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_number));
  return new;
end;
$$;
revoke all on function private.assign_business_number() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('quotes','quote_number','Q','quote_date'), ('orders','order_number','O','order_date'),
    ('dispatches','dispatch_number','D','dispatch_date'), ('invoices','invoice_number','INV','invoice_date'),
    ('production_jobs','job_number','J','planned_date'), ('foundry_batches','batch_number','FB','production_date'),
    ('foundry_external_aluminium_sources','source_number','EAS','received_date'),
    ('outsourced_billet_batches','batch_number','OBB','received_date'),
    ('foundry_aluminium_scrap','scrap_number','SCR','received_date'),
    ('packaging_jobs','packaging_number','PKG','packaging_date'),
    ('packaging_materials','material_code','PM',''),
    ('packaging_material_purchases','purchase_number','PKP','purchase_date'),
    ('machines','machine_code','MACH','purchase_date')
  ) as specs(tab, col, prefix, date_col) loop
    execute format('create trigger aa_assign_business_number before insert on public.%I for each row execute function private.assign_business_number(%L,%L,%L)', r.tab, r.col, r.prefix, r.date_col);
    execute format('create trigger aa_lock_business_number before update of %I on public.%I for each row execute function private.assign_business_number(%L,%L,%L)', r.col, r.tab, r.col, r.prefix, r.date_col);
  end loop;
end;
$$;
