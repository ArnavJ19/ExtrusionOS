begin;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  vendor_id uuid not null references public.vendors(id),
  vendor_name_snapshot text not null,
  po_number text not null,
  order_date date not null,
  status text not null default 'draft' check (status in ('draft','open')),
  expected_freight_amount numeric(14,2) not null default 0 check (expected_freight_amount >= 0),
  expected_discount_amount numeric(14,2) not null default 0 check (expected_discount_amount >= 0),
  freight_tolerance numeric(14,2) not null default 0.01 check (freight_tolerance between 0 and 1000),
  discount_tolerance numeric(14,2) not null default 0.01 check (discount_tolerance between 0 and 1000),
  total_tolerance numeric(14,2) not null default 0.01 check (total_tolerance between 0 and 1000),
  idempotency_key uuid not null,
  request_hash text not null,
  created_by uuid not null references public.app_users(id),
  updated_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, po_number),
  unique (company_id, idempotency_key)
);
create index purchase_orders_company_status_idx on public.purchase_orders(company_id, status, order_date desc, id);
create index purchase_orders_vendor_idx on public.purchase_orders(company_id, vendor_id, order_date desc, id);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_order_id uuid not null,
  line_number integer not null check (line_number between 1 and 100),
  description text not null check (length(btrim(description)) between 3 and 240),
  specification text not null check (length(btrim(specification)) between 3 and 1000),
  unit text not null check (unit in ('kg','m','piece','set','box','lot')),
  ordered_quantity numeric(14,3) not null check (ordered_quantity > 0 and ordered_quantity <= 100000000),
  unit_rate numeric(14,2) not null check (unit_rate >= 0 and unit_rate <= 1000000000),
  gst_percent numeric(5,2) not null check (gst_percent between 0 and 100),
  rate_tolerance numeric(14,2) not null default 0.01 check (rate_tolerance between 0 and 1000),
  tax_tolerance numeric(14,2) not null default 0.01 check (tax_tolerance between 0 and 1000),
  created_at timestamptz not null default now(),
  unique (id, purchase_order_id, company_id),
  unique (purchase_order_id, line_number),
  foreign key (purchase_order_id, company_id) references public.purchase_orders(id, company_id)
);
create index purchase_order_lines_company_po_idx on public.purchase_order_lines(company_id, purchase_order_id, line_number);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_order_id uuid not null,
  receipt_date date not null,
  reference text,
  idempotency_key uuid not null,
  request_hash text not null,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (id, purchase_order_id, company_id),
  unique (company_id, idempotency_key),
  foreign key (purchase_order_id, company_id) references public.purchase_orders(id, company_id)
);
create index purchase_receipts_company_po_idx on public.purchase_receipts(company_id, purchase_order_id, receipt_date desc, id);

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  receipt_id uuid not null,
  purchase_order_id uuid not null,
  purchase_order_line_id uuid not null,
  received_quantity numeric(14,3) not null check (received_quantity > 0 and received_quantity <= 100000000),
  accepted_quantity numeric(14,3) not null check (accepted_quantity >= 0),
  rejected_quantity numeric(14,3) not null check (rejected_quantity >= 0),
  held_quantity numeric(14,3) not null check (held_quantity >= 0),
  note text,
  created_at timestamptz not null default now(),
  check (received_quantity = accepted_quantity + rejected_quantity + held_quantity),
  foreign key (receipt_id, purchase_order_id, company_id) references public.purchase_receipts(id, purchase_order_id, company_id),
  foreign key (purchase_order_line_id, purchase_order_id, company_id) references public.purchase_order_lines(id, purchase_order_id, company_id)
);
create index purchase_receipt_lines_company_line_idx on public.purchase_receipt_lines(company_id, purchase_order_line_id, created_at);

create table public.supplier_purchase_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_name text not null check (length(btrim(source_name)) between 1 and 180),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  uncertain_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(uncertain_fields) = 'array'),
  review_revision integer not null default 0 check (review_revision >= 0),
  review_hash text,
  reviewed_payload jsonb,
  reviewed_by uuid references public.app_users(id),
  reviewed_at timestamptz,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, source_hash)
);
create index supplier_purchase_documents_company_created_idx on public.supplier_purchase_documents(company_id, created_at desc, id);

create table public.supplier_purchase_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_order_id uuid not null,
  vendor_id uuid not null references public.vendors(id),
  vendor_name_snapshot text not null,
  source_document_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  review_revision integer not null check (review_revision > 0),
  review_hash text not null,
  invoice_number text not null check (length(btrim(invoice_number)) between 1 and 120),
  normalized_invoice_number text not null check (length(normalized_invoice_number) between 3 and 120),
  invoice_date date not null,
  due_date date,
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  freight_amount numeric(14,2) not null check (freight_amount >= 0),
  discount_amount numeric(14,2) not null check (discount_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  status text not null default 'draft' check (status in ('draft','posted')),
  match_status text not null default 'unmatched' check (match_status in ('unmatched','matched')),
  match_snapshot jsonb not null default '{}'::jsonb,
  matched_review_hash text,
  matched_at timestamptz,
  expense_ledger_id uuid references public.expense_ledger(id),
  posted_by uuid references public.app_users(id),
  posted_at timestamptz,
  created_by uuid not null references public.app_users(id),
  updated_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, purchase_order_id, company_id),
  unique (source_document_id),
  unique (company_id, vendor_id, normalized_invoice_number, invoice_date),
  foreign key (purchase_order_id, company_id) references public.purchase_orders(id, company_id),
  foreign key (source_document_id, company_id) references public.supplier_purchase_documents(id, company_id)
);
create index supplier_purchase_bills_company_created_idx on public.supplier_purchase_bills(company_id, status, created_at desc, id);
create index supplier_purchase_bills_company_order_idx on public.supplier_purchase_bills(company_id, purchase_order_id, status);
create index supplier_purchase_bills_company_vendor_idx on public.supplier_purchase_bills(company_id, vendor_id, invoice_date desc);

create table public.supplier_purchase_bill_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  supplier_bill_id uuid not null,
  purchase_order_id uuid not null,
  purchase_order_line_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 100000000),
  unit text not null check (unit in ('kg','m','piece','set','box','lot')),
  rate numeric(14,2) not null check (rate >= 0 and rate <= 1000000000),
  base_amount numeric(14,2) not null check (base_amount > 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  created_at timestamptz not null default now(),
  foreign key (supplier_bill_id, purchase_order_id, company_id) references public.supplier_purchase_bills(id, purchase_order_id, company_id),
  foreign key (purchase_order_line_id, purchase_order_id, company_id) references public.purchase_order_lines(id, purchase_order_id, company_id)
);
create index supplier_purchase_bill_lines_company_order_line_idx on public.supplier_purchase_bill_lines(company_id, purchase_order_line_id);
create index supplier_purchase_bill_lines_bill_idx on public.supplier_purchase_bill_lines(supplier_bill_id, purchase_order_line_id);
create unique index supplier_purchase_bill_one_order_line on public.supplier_purchase_bill_lines(supplier_bill_id,purchase_order_line_id);

create table public.purchase_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_id uuid not null references public.app_users(id),
  command text not null,
  entity_type text not null,
  entity_id uuid not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index purchase_lifecycle_events_company_entity_idx on public.purchase_lifecycle_events(company_id, entity_type, entity_id, created_at, id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;
alter table public.supplier_purchase_documents enable row level security;
alter table public.supplier_purchase_bills enable row level security;
alter table public.supplier_purchase_bill_lines enable row level security;
alter table public.purchase_lifecycle_events enable row level security;
revoke all on public.purchase_orders, public.purchase_order_lines, public.purchase_receipts, public.purchase_receipt_lines,
  public.supplier_purchase_documents, public.supplier_purchase_bills, public.supplier_purchase_bill_lines,
  public.purchase_lifecycle_events from public, anon, authenticated;

create function private.purchase_lifecycle_event(p_company_id uuid, p_command text, p_entity_type text, p_entity_id uuid, p_data jsonb)
returns void language sql security definer set search_path = public, private as $$
  insert into public.purchase_lifecycle_events(company_id, actor_id, command, entity_type, entity_id, event_data)
  values (p_company_id, auth.uid(), p_command, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;
revoke all on function private.purchase_lifecycle_event(uuid,text,text,uuid,jsonb) from public, anon, authenticated;

create function private.guard_supplier_invoice_identity() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare v_normalized text; v_duplicate text;
begin
  v_normalized := regexp_replace(upper(btrim(coalesce(new.invoice_number, ''))), '[^A-Z0-9]', '', 'g');
  if new.vendor_id is null or new.invoice_date is null or length(v_normalized) < 3 or new.deleted_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || ':' || new.vendor_id::text || ':' || v_normalized || ':' || new.invoice_date::text, 0));
  select e.expense_number into v_duplicate from public.expense_ledger e
  where e.company_id = new.company_id and e.vendor_id = new.vendor_id and e.id is distinct from new.id
    and e.deleted_at is null and e.approval_status not in ('cancelled','rejected','reversed')
    and regexp_replace(upper(btrim(coalesce(e.invoice_number, ''))), '[^A-Z0-9]', '', 'g') = v_normalized
    and e.invoice_date = new.invoice_date
  order by e.created_at, e.id limit 1;
  if v_duplicate is not null then raise exception 'Supplier invoice % is already recorded as expense %', new.invoice_number, v_duplicate using errcode = '23505'; end if;
  return new;
end;
$$;
revoke all on function private.guard_supplier_invoice_identity() from public, anon, authenticated;
create trigger guard_supplier_invoice_identity before insert or update of company_id, vendor_id, invoice_number, invoice_date, deleted_at
on public.expense_ledger for each row execute function private.guard_supplier_invoice_identity();

create function private.purchase_bill_match(p_bill_id uuid, p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  v_bill public.supplier_purchase_bills%rowtype; v_order public.purchase_orders%rowtype; v_line public.purchase_order_lines%rowtype;
  v_item record; v_exceptions jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb;
  v_base numeric := 0; v_line_tax numeric := 0; v_expected_tax numeric := 0; v_received numeric; v_previously_billed numeric;
  v_order_base numeric; v_previously_posted_base numeric; v_previously_posted_freight numeric; v_previously_posted_discount numeric;
  v_expected_freight numeric; v_expected_discount numeric; v_expected_total numeric; v_computed_total numeric;
begin
  select * into v_bill from public.supplier_purchase_bills where id=p_bill_id and company_id=p_company_id;
  if not found then raise exception 'Supplier bill is unavailable for this company'; end if;
  select * into v_order from public.purchase_orders where id=v_bill.purchase_order_id and company_id=p_company_id;
  if not found or v_order.status <> 'open' then v_exceptions := v_exceptions || jsonb_build_array('Purchase order is not open.'); end if;

  select coalesce(sum(l.ordered_quantity*l.unit_rate),0) into v_order_base from public.purchase_order_lines l
    where l.purchase_order_id=v_bill.purchase_order_id and l.company_id=p_company_id;
  select coalesce(sum(bl.base_amount),0) into v_previously_posted_base
    from public.supplier_purchase_bills b join public.supplier_purchase_bill_lines bl on bl.supplier_bill_id=b.id and bl.company_id=b.company_id
    where b.purchase_order_id=v_bill.purchase_order_id and b.company_id=p_company_id and b.status='posted' and b.id<>v_bill.id;
  select coalesce(sum(b.freight_amount),0),coalesce(sum(b.discount_amount),0)
    into v_previously_posted_freight,v_previously_posted_discount from public.supplier_purchase_bills b
    where b.purchase_order_id=v_bill.purchase_order_id and b.company_id=p_company_id and b.status='posted' and b.id<>v_bill.id;

  for v_item in select bl.*, l.ordered_quantity, l.unit as po_unit, l.unit_rate as po_rate, l.gst_percent,
      l.rate_tolerance, l.tax_tolerance, l.description as po_description
    from public.supplier_purchase_bill_lines bl
    join public.purchase_order_lines l on l.id=bl.purchase_order_line_id and l.purchase_order_id=bl.purchase_order_id and l.company_id=bl.company_id
    where bl.supplier_bill_id=v_bill.id and bl.company_id=p_company_id order by bl.purchase_order_line_id
  loop
    select coalesce(sum(rl.accepted_quantity),0) into v_received from public.purchase_receipt_lines rl
      where rl.purchase_order_line_id=v_item.purchase_order_line_id and rl.purchase_order_id=v_bill.purchase_order_id and rl.company_id=p_company_id;
    select coalesce(sum(bl.quantity),0) into v_previously_billed
      from public.supplier_purchase_bill_lines bl join public.supplier_purchase_bills b on b.id=bl.supplier_bill_id and b.company_id=bl.company_id
      where bl.purchase_order_line_id=v_item.purchase_order_line_id and bl.purchase_order_id=v_bill.purchase_order_id
        and bl.company_id=p_company_id and b.status='posted' and b.id<>v_bill.id;
    v_base := v_base + v_item.base_amount;
    v_line_tax := v_line_tax + v_item.tax_amount;
    v_expected_tax := v_expected_tax + round(round(v_item.quantity*v_item.po_rate,2)*v_item.gst_percent/100,2);
    if v_item.unit is distinct from v_item.po_unit then v_exceptions := v_exceptions || jsonb_build_array('Unit differs from purchase order for '||v_item.po_description||'.'); end if;
    if abs(v_item.rate-v_item.po_rate)>v_item.rate_tolerance then v_exceptions := v_exceptions || jsonb_build_array('Rate is outside the approved tolerance for '||v_item.po_description||'.'); end if;
    if v_item.base_amount<>round(v_item.quantity*v_item.rate,2) then v_exceptions := v_exceptions || jsonb_build_array('Line base does not equal quantity x rate for '||v_item.po_description||'.'); end if;
    if abs(v_item.tax_amount-round(v_item.base_amount*v_item.gst_percent/100,2))>v_item.tax_tolerance then v_exceptions := v_exceptions || jsonb_build_array('Tax differs from the PO tax rate for '||v_item.po_description||'.'); end if;
    if v_received < v_previously_billed+v_item.quantity then v_exceptions := v_exceptions || jsonb_build_array('Accepted receipt quantity is short for '||v_item.po_description||'.'); end if;
    if v_previously_billed+v_item.quantity > v_item.ordered_quantity then v_exceptions := v_exceptions || jsonb_build_array('Billed quantity exceeds the ordered quantity for '||v_item.po_description||'.'); end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('description',v_item.po_description,'unit',v_item.unit,
      'quantity',v_item.quantity,'accepted_received',v_received,'previously_billed',v_previously_billed,'rate',v_item.rate,
      'po_rate',v_item.po_rate,'base_amount',v_item.base_amount,'tax_amount',v_item.tax_amount));
  end loop;
  if jsonb_array_length(v_lines)=0 then v_exceptions := v_exceptions || jsonb_build_array('Bill has no PO lines.'); end if;
  if abs(v_line_tax-v_bill.tax_amount)>0.01 then v_exceptions := v_exceptions || jsonb_build_array('Bill tax total does not equal its line tax amounts.'); end if;
  if abs(v_line_tax-v_expected_tax)>0.01 then v_exceptions := v_exceptions || jsonb_build_array('Bill tax total differs from the PO tax calculation.'); end if;
  if v_order_base<=v_previously_posted_base then
    v_expected_freight := 0; v_expected_discount := 0;
  else
    v_expected_freight := round(greatest(v_order.expected_freight_amount-v_previously_posted_freight,0)*v_base/(v_order_base-v_previously_posted_base),2);
    v_expected_discount := round(greatest(v_order.expected_discount_amount-v_previously_posted_discount,0)*v_base/(v_order_base-v_previously_posted_base),2);
  end if;
  if abs(v_bill.freight_amount-v_expected_freight)>v_order.freight_tolerance then v_exceptions := v_exceptions || jsonb_build_array('Freight differs from the PO allocation.'); end if;
  if abs(v_bill.discount_amount-v_expected_discount)>v_order.discount_tolerance then v_exceptions := v_exceptions || jsonb_build_array('Discount differs from the PO allocation.'); end if;
  v_computed_total := round(v_base+v_line_tax+v_bill.freight_amount-v_bill.discount_amount,2);
  v_expected_total := round(v_base+v_expected_tax+v_expected_freight-v_expected_discount,2);
  if abs(v_bill.total_amount-v_computed_total)>0.01 then v_exceptions := v_exceptions || jsonb_build_array('Bill total does not equal base + tax + freight - discount.'); end if;
  if abs(v_bill.total_amount-v_expected_total)>v_order.total_tolerance then v_exceptions := v_exceptions || jsonb_build_array('Bill total differs from the PO value within its approved tolerance.'); end if;
  return jsonb_build_object('matched',jsonb_array_length(v_exceptions)=0,'exceptions',v_exceptions,'lines',v_lines,
    'expected',jsonb_build_object('base_amount',v_base,'tax_amount',v_expected_tax,'freight_amount',v_expected_freight,
      'discount_amount',v_expected_discount,'total_amount',v_expected_total),
    'actual',jsonb_build_object('base_amount',v_base,'tax_amount',v_line_tax,'freight_amount',v_bill.freight_amount,
      'discount_amount',v_bill.discount_amount,'total_amount',v_bill.total_amount));
end;
$$;
revoke all on function private.purchase_bill_match(uuid,uuid) from public, anon, authenticated;

create function private.purchase_order_view(p_order_id uuid, p_company_id uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'id',p.id,'po_number',p.po_number,'vendor_id',p.vendor_id,'vendor_name',p.vendor_name_snapshot,
    'order_date',p.order_date,'status',p.status,'expected_freight_amount',p.expected_freight_amount,
    'expected_discount_amount',p.expected_discount_amount,'created_at',p.created_at,
    'lines',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.id,'line_number',l.line_number,'description',l.description,'specification',l.specification,'unit',l.unit,
      'ordered_quantity',l.ordered_quantity,'unit_rate',l.unit_rate,'gst_percent',l.gst_percent,
      'received_quantity',coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl where rl.company_id=p_company_id and rl.purchase_order_line_id=l.id),0),
      'accepted_quantity',coalesce((select sum(rl.accepted_quantity) from public.purchase_receipt_lines rl where rl.company_id=p_company_id and rl.purchase_order_line_id=l.id),0),
      'rejected_quantity',coalesce((select sum(rl.rejected_quantity) from public.purchase_receipt_lines rl where rl.company_id=p_company_id and rl.purchase_order_line_id=l.id),0),
      'held_quantity',coalesce((select sum(rl.held_quantity) from public.purchase_receipt_lines rl where rl.company_id=p_company_id and rl.purchase_order_line_id=l.id),0),
      'billed_quantity',coalesce((select sum(bl.quantity) from public.supplier_purchase_bill_lines bl
        join public.supplier_purchase_bills b on b.id=bl.supplier_bill_id and b.company_id=bl.company_id
        where b.company_id=p_company_id and b.status='posted' and bl.purchase_order_line_id=l.id),0)
    ) order by l.line_number),'[]'::jsonb) from public.purchase_order_lines l where l.company_id=p_company_id and l.purchase_order_id=p.id)
  )
  from public.purchase_orders p where p.id=p_order_id and p.company_id=p_company_id;
$$;
revoke all on function private.purchase_order_view(uuid,uuid) from public, anon, authenticated;

create function public.purchase_lifecycle_command(p_command text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid; v_role text:=private.get_current_user_role(); v_actor uuid:=auth.uid(); v_id uuid; v_hash text; v_saved_hash text;
  v_order public.purchase_orders%rowtype; v_line public.purchase_order_lines%rowtype; v_receipt public.purchase_receipts%rowtype;
  v_doc public.supplier_purchase_documents%rowtype; v_bill public.supplier_purchase_bills%rowtype; v_existing public.purchase_orders%rowtype;
  v_source uuid; v_source_hash text; v_reviewed jsonb; v_review_hash text; v_lines jsonb; v_json jsonb; v_result jsonb;
  v_vendor uuid; v_vendor_name text; v_po_id uuid; v_date date; v_due_date date; v_number text; v_norm text;
  v_quantity numeric; v_accepted numeric; v_rejected numeric; v_held numeric; v_total numeric; v_base numeric; v_tax numeric;
  v_freight numeric; v_discount numeric; v_rate numeric; v_gst numeric; v_tolerance numeric; v_count integer; v_page integer;
  v_sort text; v_direction text;
  v_match jsonb; v_expense uuid; v_expected_revision integer; v_current_bill uuid; v_line_id uuid; v_received_total numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload?'company_id' then raise exception 'Invalid purchase lifecycle request'; end if;
  if p_command in ('dashboard.load','orders.list','bills.list','order.load','bill.load','document.load') then
    v_company:=private.commercial_actor(array['owner','admin','accounts','inventory_manager','viewer']);
  elsif p_command='receipt.record' then
    v_company:=private.commercial_actor(array['owner','admin','inventory_manager']);
  elsif p_command in ('order.create','order.issue','document.create','document.review','bill.create','bill.match','bill.post') then
    v_company:=private.commercial_actor(array['owner','admin','accounts']);
  else raise exception 'Unknown purchase lifecycle command'; end if;

  if p_command='dashboard.load' then
    if p_payload-'search'<>'{}' or length(coalesce(p_payload->>'search',''))>80 then raise exception 'Invalid purchase dashboard request'; end if;
    v_json := jsonb_build_object('kind','dashboard',
      'vendors',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'vendor_name',v.vendor_name) order by v.vendor_name,v.id),'[]') from (select id,vendor_name from public.vendors where company_id=v_company and is_active order by vendor_name,id limit 100) v),
      'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'po_number',p.po_number,'vendor_id',p.vendor_id,'vendor_name',p.vendor_name_snapshot,
        'order_date',p.order_date,'status',p.status,'expected_freight_amount',p.expected_freight_amount,'expected_discount_amount',p.expected_discount_amount,
        'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'line_number',l.line_number,'description',l.description,'specification',l.specification,
          'unit',l.unit,'ordered_quantity',l.ordered_quantity,'unit_rate',l.unit_rate,'gst_percent',l.gst_percent,
          'received_quantity',coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl where rl.company_id=v_company and rl.purchase_order_line_id=l.id),0),
          'accepted_quantity',coalesce((select sum(rl.accepted_quantity) from public.purchase_receipt_lines rl where rl.company_id=v_company and rl.purchase_order_line_id=l.id),0),
          'rejected_quantity',coalesce((select sum(rl.rejected_quantity) from public.purchase_receipt_lines rl where rl.company_id=v_company and rl.purchase_order_line_id=l.id),0),
          'held_quantity',coalesce((select sum(rl.held_quantity) from public.purchase_receipt_lines rl where rl.company_id=v_company and rl.purchase_order_line_id=l.id),0),
          'billed_quantity',coalesce((select sum(bl.quantity) from public.supplier_purchase_bill_lines bl join public.supplier_purchase_bills b on b.id=bl.supplier_bill_id where b.company_id=v_company and b.status='posted' and bl.purchase_order_line_id=l.id),0)) order by l.line_number),'[]')
          from public.purchase_order_lines l where l.company_id=v_company and l.purchase_order_id=p.id)) order by p.created_at desc,p.id),'[]')
        from (select * from public.purchase_orders where company_id=v_company order by created_at desc,id limit 10) p),
      'bills',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'invoice_number',b.invoice_number,'invoice_date',b.invoice_date,'vendor_name',b.vendor_name_snapshot,
        'po_number',p.po_number,'total_amount',b.total_amount,'status',b.status,'match_status',b.match_status,'match_snapshot',b.match_snapshot,
        'expense_ledger_id',b.expense_ledger_id,'source_name',d.source_name) order by b.created_at desc,b.id),'[]') from
        (select * from public.supplier_purchase_bills where company_id=v_company order by created_at desc,id limit 10) b
        join public.purchase_orders p on p.id=b.purchase_order_id and p.company_id=v_company
        join public.supplier_purchase_documents d on d.id=b.source_document_id and d.company_id=v_company));
    return v_json;
  elsif p_command='order.load' then
    if p_payload-array['purchase_order_id']<>'{}' then raise exception 'Invalid purchase order load request'; end if;
    v_result:=private.purchase_order_view((p_payload->>'purchase_order_id')::uuid,v_company);
    if v_result is null then raise exception 'Purchase order is unavailable for this company'; end if;
    return jsonb_build_object('kind','order_loaded','order',v_result);
  elsif p_command='bill.load' then
    if p_payload-array['bill_id']<>'{}' then raise exception 'Invalid supplier bill load request'; end if;
    select * into v_bill from public.supplier_purchase_bills where id=(p_payload->>'bill_id')::uuid and company_id=v_company;
    if not found then raise exception 'Supplier bill is unavailable for this company'; end if;
    select * into v_doc from public.supplier_purchase_documents where id=v_bill.source_document_id and company_id=v_company;
    if not found then raise exception 'Supplier source document is unavailable for this company'; end if;
    v_match:=private.purchase_bill_match(v_bill.id,v_company);
    return jsonb_build_object('kind','bill_loaded','bill',jsonb_build_object(
      'id',v_bill.id,'vendor_id',v_bill.vendor_id,'purchase_order_id',v_bill.purchase_order_id,
      'invoice_number',v_bill.invoice_number,'invoice_date',v_bill.invoice_date,'due_date',v_bill.due_date,
      'tax_amount',v_bill.tax_amount,'freight_amount',v_bill.freight_amount,'discount_amount',v_bill.discount_amount,'total_amount',v_bill.total_amount,
      'status',v_bill.status,'match_status',case when (v_match->>'matched')::boolean then 'matched' else 'unmatched' end,
      'match_snapshot',v_match,'source_hash',v_bill.source_hash,'review_revision',v_bill.review_revision,'review_hash',v_bill.review_hash,
      'expense_ledger_id',v_bill.expense_ledger_id,
      'lines',(select coalesce(jsonb_agg(jsonb_build_object('purchase_order_line_id',bl.purchase_order_line_id,'quantity',bl.quantity,
        'unit',bl.unit,'rate',bl.rate,'base_amount',bl.base_amount,'tax_amount',bl.tax_amount) order by bl.purchase_order_line_id),'[]'::jsonb)
        from public.supplier_purchase_bill_lines bl where bl.supplier_bill_id=v_bill.id and bl.company_id=v_company),
      'source',jsonb_build_object('kind','document','id',v_doc.id,'source_hash',v_doc.source_hash,'source_name',v_doc.source_name,
        'proposal',v_doc.proposal,'uncertain_fields',v_doc.uncertain_fields,'review_revision',v_doc.review_revision,
        'review_hash',v_doc.review_hash,'reviewed_payload',v_doc.reviewed_payload,'idempotent_replay',true),
      'order',private.purchase_order_view(v_bill.purchase_order_id,v_company)
    ));
  elsif p_command='orders.list' then
    if p_payload-array['page','search','status','sort','direction']<>'{}' then raise exception 'Invalid purchase order list request'; end if;
    v_page:=coalesce(nullif(p_payload->>'page','')::integer,1); v_sort:=coalesce(p_payload->>'sort','date'); v_direction:=coalesce(p_payload->>'direction','desc');
    if v_page<1 or v_page>10000 or length(coalesce(p_payload->>'search',''))>80 or coalesce(p_payload->>'status','all') not in ('all','draft','open') or
      v_sort not in ('date','supplier','number','status') or v_direction not in ('asc','desc') then raise exception 'Invalid purchase order list request'; end if;
    select count(*) into v_count from public.purchase_orders p
      where p.company_id=v_company and (p_payload->>'status' is null or p_payload->>'status'='all' or p.status=p_payload->>'status')
        and (coalesce(p_payload->>'search','')='' or strpos(lower(p.po_number||' '||p.vendor_name_snapshot),lower(p_payload->>'search'))>0);
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_json from (select p.id,p.po_number,p.vendor_id,p.vendor_name_snapshot as vendor_name,p.order_date,p.status,
      p.expected_freight_amount,p.expected_discount_amount,p.created_at from public.purchase_orders p
      where p.company_id=v_company and (p_payload->>'status' is null or p_payload->>'status'='all' or p.status=p_payload->>'status')
        and (coalesce(p_payload->>'search','')='' or strpos(lower(p.po_number||' '||p.vendor_name_snapshot),lower(p_payload->>'search'))>0)
      order by
        case when v_sort='date' and v_direction='asc' then p.order_date end asc,
        case when v_sort='date' and v_direction='desc' then p.order_date end desc,
        case when v_sort='supplier' and v_direction='asc' then p.vendor_name_snapshot end asc,
        case when v_sort='supplier' and v_direction='desc' then p.vendor_name_snapshot end desc,
        case when v_sort='number' and v_direction='asc' then p.po_number end asc,
        case when v_sort='number' and v_direction='desc' then p.po_number end desc,
        case when v_sort='status' and v_direction='asc' then p.status end asc,
        case when v_sort='status' and v_direction='desc' then p.status end desc,
        p.id asc offset ((v_page-1)*10) limit 10) r;
    return jsonb_build_object('kind','orders','items',v_json,'page',v_page,'total',v_count);
  elsif p_command='bills.list' then
    if p_payload-array['page','search','status','sort','direction']<>'{}' then raise exception 'Invalid supplier bill list request'; end if;
    v_page:=coalesce(nullif(p_payload->>'page','')::integer,1); v_sort:=coalesce(p_payload->>'sort','date'); v_direction:=coalesce(p_payload->>'direction','desc');
    if v_page<1 or v_page>10000 or length(coalesce(p_payload->>'search',''))>80 or coalesce(p_payload->>'status','all') not in ('all','draft','posted') or
      v_sort not in ('date','supplier','invoice','amount','status') or v_direction not in ('asc','desc') then raise exception 'Invalid supplier bill list request'; end if;
    select count(*) into v_count from public.supplier_purchase_bills b
      where b.company_id=v_company and (p_payload->>'status' is null or p_payload->>'status'='all' or b.status=p_payload->>'status')
        and (coalesce(p_payload->>'search','')='' or strpos(lower(b.invoice_number||' '||b.vendor_name_snapshot),lower(p_payload->>'search'))>0);
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_json from (select b.id,b.invoice_number,b.invoice_date,b.vendor_id,b.vendor_name_snapshot as vendor_name,
      p.po_number,b.total_amount,b.status,b.match_status,b.match_snapshot,b.expense_ledger_id,b.created_at from public.supplier_purchase_bills b
      join public.purchase_orders p on p.id=b.purchase_order_id and p.company_id=v_company
      where b.company_id=v_company and (p_payload->>'status' is null or p_payload->>'status'='all' or b.status=p_payload->>'status')
        and (coalesce(p_payload->>'search','')='' or strpos(lower(b.invoice_number||' '||b.vendor_name_snapshot),lower(p_payload->>'search'))>0)
      order by
        case when v_sort='date' and v_direction='asc' then b.invoice_date end asc,
        case when v_sort='date' and v_direction='desc' then b.invoice_date end desc,
        case when v_sort='supplier' and v_direction='asc' then b.vendor_name_snapshot end asc,
        case when v_sort='supplier' and v_direction='desc' then b.vendor_name_snapshot end desc,
        case when v_sort='invoice' and v_direction='asc' then b.invoice_number end asc,
        case when v_sort='invoice' and v_direction='desc' then b.invoice_number end desc,
        case when v_sort='amount' and v_direction='asc' then b.total_amount end asc,
        case when v_sort='amount' and v_direction='desc' then b.total_amount end desc,
        case when v_sort='status' and v_direction='asc' then b.status end asc,
        case when v_sort='status' and v_direction='desc' then b.status end desc,
        b.id asc offset ((v_page-1)*10) limit 10) r;
    return jsonb_build_object('kind','bills','items',v_json,'page',v_page,'total',v_count);
  elsif p_command='order.create' then
    if p_payload-array['idempotency_key','vendor_id','order_date','expected_freight_amount','expected_discount_amount','freight_tolerance','discount_tolerance','total_tolerance','lines']<>'{}' then raise exception 'Invalid purchase order request'; end if;
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise exception 'A purchase order needs between 1 and 100 lines'; end if;
    v_id:=coalesce(nullif(p_payload->>'idempotency_key','')::uuid,null); if v_id is null then raise exception 'Purchase order retry key is required'; end if;
    v_hash:=md5((p_payload-'idempotency_key')::text);
    perform pg_advisory_xact_lock(hashtextextended(v_company::text||':purchase-order:'||v_id::text,0));
    select * into v_existing from public.purchase_orders where company_id=v_company and idempotency_key=v_id;
    if found then if v_existing.request_hash<>v_hash then raise exception 'This purchase order retry key was used for different details'; end if; return jsonb_build_object('kind','order_created','id',v_existing.id,'po_number',v_existing.po_number,'status',v_existing.status,'idempotent_replay',true); end if;
    v_vendor:=nullif(p_payload->>'vendor_id','')::uuid; select vendor_name into v_vendor_name from public.vendors where id=v_vendor and company_id=v_company and is_active;
    if not found then raise exception 'Select an active supplier from this company'; end if;
    v_date:=nullif(p_payload->>'order_date','')::date; if v_date is null or not isfinite(v_date) then raise exception 'Enter a valid finite order date'; end if;
    v_freight:=coalesce(nullif(p_payload->>'expected_freight_amount','')::numeric,0); v_discount:=coalesce(nullif(p_payload->>'expected_discount_amount','')::numeric,0);
    if least(v_freight,v_discount)<0 or greatest(v_freight,v_discount)>1000000000 or 'NaN'::numeric in (v_freight,v_discount) then raise exception 'Expected freight and discount must be finite nonnegative INR amounts'; end if;
    v_tolerance:=coalesce(nullif(p_payload->>'freight_tolerance','')::numeric,0.01);
    if v_tolerance<0.01 or v_tolerance>1000 then raise exception 'Freight tolerance must be between INR 0.01 and INR 1,000'; end if;
    v_total:=coalesce(nullif(p_payload->>'discount_tolerance','')::numeric,0.01); if v_total<0.01 or v_total>1000 then raise exception 'Discount tolerance must be between INR 0.01 and INR 1,000'; end if;
    v_tax:=coalesce(nullif(p_payload->>'total_tolerance','')::numeric,0.01); if v_tax<0.01 or v_tax>1000 then raise exception 'Total tolerance must be between INR 0.01 and INR 1,000'; end if;
    if v_role not in ('owner','admin') and greatest(v_tolerance,v_total,v_tax)>0.01 then raise exception 'Only an owner or admin may approve tolerance above INR 0.01'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_company::text||':purchase-order-number:'||extract(year from v_date)::text,0));
    v_number:='PO-'||extract(year from v_date)::integer::text||'-'||lpad((coalesce((select max(split_part(po_number,'-',3)::integer) from public.purchase_orders where company_id=v_company and po_number like 'PO-'||extract(year from v_date)::integer::text||'-%'),0)+1)::text,5,'0');
    v_source:=gen_random_uuid();
    insert into public.purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,expected_freight_amount,expected_discount_amount,
      freight_tolerance,discount_tolerance,total_tolerance,idempotency_key,request_hash,created_by,updated_by)
      values(v_source,v_company,v_vendor,v_vendor_name,v_number,v_date,round(v_freight,2),round(v_discount,2),round(v_tolerance,2),round(v_total,2),round(v_tax,2),v_id,v_hash,v_actor,v_actor);
    v_count:=0;
    for v_json in select value from jsonb_array_elements(p_payload->'lines') loop
      v_count:=v_count+1;
      if jsonb_typeof(v_json)<>'object' or v_json-array['description','specification','unit','quantity','rate','gst_percent','rate_tolerance','tax_tolerance']<>'{}' then raise exception 'Invalid purchase order line'; end if;
      v_quantity:=(v_json->>'quantity')::numeric; v_rate:=(v_json->>'rate')::numeric; v_gst:=(v_json->>'gst_percent')::numeric;
      v_tolerance:=coalesce(nullif(v_json->>'rate_tolerance','')::numeric,0.01); v_total:=coalesce(nullif(v_json->>'tax_tolerance','')::numeric,0.01);
      if v_quantity<=0 or v_quantity>100000000 or v_quantity<>round(v_quantity,3) or v_rate<0 or v_rate>1000000000 or v_rate<>round(v_rate,2) or v_gst<0 or v_gst>100 or v_gst<>round(v_gst,2) or
        v_tolerance<0.01 or v_tolerance>1000 or v_total<0.01 or v_total>1000 or
        (v_json->>'unit') not in ('kg','m','piece','set','box','lot') or
        length(btrim(coalesce(v_json->>'description','')))<3 or length(v_json->>'description')>240 or
        length(btrim(coalesce(v_json->>'specification','')))<3 or length(v_json->>'specification')>1000 then raise exception 'Check the purchase line quantity, unit, specification, rate and GST'; end if;
      if v_role not in ('owner','admin') and greatest(v_tolerance,v_total)>0.01 then raise exception 'Only an owner or admin may approve line tolerance above INR 0.01'; end if;
      insert into public.purchase_order_lines(company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent,rate_tolerance,tax_tolerance)
        values(v_company,v_source,v_count,btrim(v_json->>'description'),btrim(v_json->>'specification'),v_json->>'unit',round(v_quantity,3),round(v_rate,2),round(v_gst,2),round(v_tolerance,2),round(v_total,2));
    end loop;
    perform private.purchase_lifecycle_event(v_company,p_command,'purchase_order',v_source,jsonb_build_object('po_number',v_number,'vendor_id',v_vendor,'request',p_payload-'idempotency_key'));
    return jsonb_build_object('kind','order_created','id',v_source,'po_number',v_number,'status','draft','idempotent_replay',false);
  elsif p_command='order.issue' then
    if p_payload-array['purchase_order_id']<>'{}' then raise exception 'Invalid purchase order issue request'; end if;
    select * into v_order from public.purchase_orders where id=(p_payload->>'purchase_order_id')::uuid and company_id=v_company for update;
    if not found then raise exception 'Purchase order is unavailable'; end if;
    if v_order.status='open' then return jsonb_build_object('kind','order_issued','id',v_order.id,'po_number',v_order.po_number,'status',v_order.status,'idempotent_replay',true); end if;
    update public.purchase_orders set status='open',updated_by=v_actor,updated_at=now() where id=v_order.id and company_id=v_company;
    perform private.purchase_lifecycle_event(v_company,p_command,'purchase_order',v_order.id,jsonb_build_object('from',v_order.status,'to','open'));
    return jsonb_build_object('kind','order_issued','id',v_order.id,'po_number',v_order.po_number,'status','open','idempotent_replay',false);
  elsif p_command='receipt.record' then
    if p_payload-array['idempotency_key','purchase_order_id','receipt_date','reference','lines']<>'{}' then raise exception 'Invalid purchase receipt request'; end if;
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise exception 'A receipt needs between 1 and 100 lines'; end if;
    v_id:=(p_payload->>'idempotency_key')::uuid; v_hash:=md5((p_payload-'idempotency_key')::text);
    perform pg_advisory_xact_lock(hashtextextended(v_company::text||':purchase-receipt:'||v_id::text,0));
    select * into v_receipt from public.purchase_receipts where company_id=v_company and idempotency_key=v_id;
    if found then if v_receipt.request_hash<>v_hash then raise exception 'This receipt retry key was used for different details'; end if; return jsonb_build_object('kind','receipt_recorded','id',v_receipt.id,'idempotent_replay',true); end if;
    v_po_id:=(p_payload->>'purchase_order_id')::uuid; select * into v_order from public.purchase_orders where id=v_po_id and company_id=v_company for update;
    if not found or v_order.status<>'open' then raise exception 'Select an open purchase order'; end if;
    v_date:=nullif(p_payload->>'receipt_date','')::date; if v_date is null or not isfinite(v_date) then raise exception 'Enter a valid finite receipt date'; end if;
    if v_date>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Receipt date cannot be in the future (Asia/Kolkata)'; end if;
    if length(coalesce(p_payload->>'reference',''))>120 then raise exception 'Receipt reference is too long'; end if;
    v_source:=gen_random_uuid(); insert into public.purchase_receipts(id,company_id,purchase_order_id,receipt_date,reference,idempotency_key,request_hash,created_by)
      values(v_source,v_company,v_po_id,v_date,nullif(btrim(p_payload->>'reference'),''),v_id,v_hash,v_actor);
    for v_json in select value from jsonb_array_elements(p_payload->'lines') loop
      if jsonb_typeof(v_json)<>'object' or v_json-array['purchase_order_line_id','received_quantity','accepted_quantity','rejected_quantity','held_quantity','note']<>'{}' then raise exception 'Invalid received purchase line'; end if;
      v_line_id:=(v_json->>'purchase_order_line_id')::uuid;
      select * into v_line from public.purchase_order_lines where id=v_line_id and purchase_order_id=v_po_id and company_id=v_company for update;
      if not found then raise exception 'A receipt line does not belong to this purchase order'; end if;
      v_quantity:=(v_json->>'received_quantity')::numeric; v_accepted:=(v_json->>'accepted_quantity')::numeric; v_rejected:=(v_json->>'rejected_quantity')::numeric; v_held:=(v_json->>'held_quantity')::numeric;
      if 'NaN'::numeric in (v_quantity,v_accepted,v_rejected,v_held) or least(v_quantity,v_accepted,v_rejected,v_held)<0 or v_quantity<=0 or
        v_quantity>100000000 or v_quantity<>round(v_quantity,3) or v_accepted<>round(v_accepted,3) or v_rejected<>round(v_rejected,3) or v_held<>round(v_held,3) or v_accepted+v_rejected+v_held<>v_quantity or length(coalesce(v_json->>'note',''))>1000 then raise exception 'Received, accepted, rejected and held quantities must be finite with up to three decimals and reconcile exactly'; end if;
      select coalesce(sum(rl.received_quantity),0) into v_received_total from public.purchase_receipt_lines rl where rl.company_id=v_company and rl.purchase_order_line_id=v_line_id;
      if v_received_total+v_quantity>v_line.ordered_quantity then raise exception 'Receipt exceeds remaining ordered quantity for %',v_line.description; end if;
      if exists(select 1 from jsonb_array_elements(p_payload->'lines') x where x.value->>'purchase_order_line_id'=v_line_id::text group by x.value->>'purchase_order_line_id' having count(*)>1) then raise exception 'A purchase order line may appear only once per receipt'; end if;
      insert into public.purchase_receipt_lines(company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity,note)
        values(v_company,v_source,v_po_id,v_line_id,round(v_quantity,3),round(v_accepted,3),round(v_rejected,3),round(v_held,3),nullif(btrim(v_json->>'note'),''));
    end loop;
    perform private.purchase_lifecycle_event(v_company,p_command,'purchase_receipt',v_source,jsonb_build_object('purchase_order_id',v_po_id,'receipt_date',v_date,'lines',p_payload->'lines'));
    return jsonb_build_object('kind','receipt_recorded','id',v_source,'idempotent_replay',false);
  elsif p_command='document.create' then
    if p_payload-array['source_hash','source_name','proposal','uncertain_fields']<>'{}' then raise exception 'Invalid supplier document request'; end if;
    v_source_hash:=lower(coalesce(p_payload->>'source_hash','')); if v_source_hash !~ '^[0-9a-f]{64}$' then raise exception 'Supplier source hash is invalid'; end if;
    if jsonb_typeof(p_payload->'proposal') is distinct from 'object' or jsonb_typeof(p_payload->'uncertain_fields') is distinct from 'array' then raise exception 'Supplier extraction proposal is invalid'; end if;
    if length(btrim(coalesce(p_payload->>'source_name','')))<1 or length(p_payload->>'source_name')>180 then raise exception 'Supplier file name is invalid'; end if;
    select * into v_doc from public.supplier_purchase_documents where company_id=v_company and source_hash=v_source_hash for update;
    if found then return jsonb_build_object('kind','document','id',v_doc.id,'source_hash',v_doc.source_hash,'source_name',v_doc.source_name,'proposal',v_doc.proposal,'uncertain_fields',v_doc.uncertain_fields,'review_revision',v_doc.review_revision,'review_hash',v_doc.review_hash,'reviewed_payload',v_doc.reviewed_payload,'idempotent_replay',true); end if;
    v_source:=gen_random_uuid(); insert into public.supplier_purchase_documents(id,company_id,source_hash,source_name,proposal,uncertain_fields,created_by)
      values(v_source,v_company,v_source_hash,btrim(p_payload->>'source_name'),p_payload->'proposal',p_payload->'uncertain_fields',v_actor);
    perform private.purchase_lifecycle_event(v_company,p_command,'supplier_document',v_source,jsonb_build_object('source_hash',v_source_hash,'source_name',btrim(p_payload->>'source_name'),'proposal',p_payload->'proposal','uncertain_fields',p_payload->'uncertain_fields'));
    return jsonb_build_object('kind','document','id',v_source,'source_hash',v_source_hash,'source_name',btrim(p_payload->>'source_name'),'proposal',p_payload->'proposal','uncertain_fields',p_payload->'uncertain_fields','review_revision',0,'review_hash',null,'reviewed_payload',null,'idempotent_replay',false);
  elsif p_command='document.load' then
    if p_payload-array['source_id','source_hash']<>'{}' then raise exception 'Invalid supplier document request'; end if;
    select * into v_doc from public.supplier_purchase_documents where id=(p_payload->>'source_id')::uuid and company_id=v_company and source_hash=lower(p_payload->>'source_hash');
    if not found then raise exception 'Supplier source document version is unavailable'; end if;
    return jsonb_build_object('kind','document','id',v_doc.id,'source_hash',v_doc.source_hash,'source_name',v_doc.source_name,'proposal',v_doc.proposal,'uncertain_fields',v_doc.uncertain_fields,'review_revision',v_doc.review_revision,'review_hash',v_doc.review_hash,'reviewed_payload',v_doc.reviewed_payload,'idempotent_replay',true);
  elsif p_command='document.review' then
    if p_payload-array['source_id','source_hash','expected_revision','reviewed']<>'{}' then raise exception 'Invalid supplier document review'; end if;
    v_source:=(p_payload->>'source_id')::uuid; v_source_hash:=lower(p_payload->>'source_hash'); v_expected_revision:=(p_payload->>'expected_revision')::integer; v_reviewed:=p_payload->'reviewed';
    if v_source_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(v_reviewed)<>'object' or v_reviewed-array['vendor_id','purchase_order_id','invoice_number','invoice_date','due_date','tax_amount','freight_amount','discount_amount','total_amount','lines']<>'{}' then raise exception 'Review every required supplier bill field'; end if;
    select * into v_doc from public.supplier_purchase_documents where id=v_source and company_id=v_company and source_hash=v_source_hash for update;
    if not found then raise exception 'Supplier source document version is unavailable'; end if;
    v_review_hash:=md5(v_source_hash||':'||v_reviewed::text);
    if v_doc.review_hash=v_review_hash and v_doc.reviewed_payload=v_reviewed then return jsonb_build_object('kind','document_reviewed','source_id',v_doc.id,'review_revision',v_doc.review_revision,'review_hash',v_doc.review_hash,'idempotent_replay',true); end if;
    if v_doc.review_revision<>v_expected_revision then raise exception 'Supplier document review changed. Reload the source and review its current version.'; end if;
    if jsonb_typeof(v_reviewed->'lines') is distinct from 'array' or jsonb_array_length(v_reviewed->'lines') not between 1 and 100 then raise exception 'A supplier bill needs between 1 and 100 reviewed lines'; end if;
    v_vendor:=(v_reviewed->>'vendor_id')::uuid; v_po_id:=(v_reviewed->>'purchase_order_id')::uuid;
    select vendor_name into v_vendor_name from public.vendors where id=v_vendor and company_id=v_company;
    if not found then raise exception 'Select the recorded supplier from this company'; end if;
    select * into v_order from public.purchase_orders where id=v_po_id and company_id=v_company and vendor_id=v_vendor and status='open';
    if not found then raise exception 'Select an open purchase order for this supplier'; end if;
    v_vendor_name:=coalesce(v_order.vendor_name_snapshot,v_vendor_name);
    v_number:=btrim(coalesce(v_reviewed->>'invoice_number','')); v_norm:=regexp_replace(upper(v_number),'[^A-Z0-9]','','g');
    if length(v_number)<1 or length(v_number)>120 or length(v_norm)<3 then raise exception 'Enter a supplier invoice number with at least three letters or digits'; end if;
    v_date:=nullif(v_reviewed->>'invoice_date','')::date; v_due_date:=nullif(v_reviewed->>'due_date','')::date;
    if v_date is null or not isfinite(v_date) or (v_due_date is not null and (not isfinite(v_due_date) or v_due_date<v_date)) then raise exception 'Enter valid invoice and due dates'; end if;
    v_tax:=coalesce(nullif(v_reviewed->>'tax_amount','')::numeric,0); v_freight:=coalesce(nullif(v_reviewed->>'freight_amount','')::numeric,0);
    v_discount:=coalesce(nullif(v_reviewed->>'discount_amount','')::numeric,0); v_total:=coalesce(nullif(v_reviewed->>'total_amount','')::numeric,0);
    if 'NaN'::numeric in (v_tax,v_freight,v_discount,v_total) or least(v_tax,v_freight,v_discount)<0 or greatest(v_tax,v_freight,v_discount,v_total)>1000000000000 or v_total<=0 or v_tax<>round(v_tax,2) or v_freight<>round(v_freight,2) or v_discount<>round(v_discount,2) or v_total<>round(v_total,2) then raise exception 'Bill amounts must be finite nonnegative INR values with up to two decimals'; end if;
    v_base:=0; v_count:=0;
    for v_json in select value from jsonb_array_elements(v_reviewed->'lines') loop
      v_count:=v_count+1;
      if jsonb_typeof(v_json)<>'object' or v_json-array['purchase_order_line_id','quantity','unit','rate','base_amount','tax_amount']<>'{}' then raise exception 'Invalid reviewed supplier bill line'; end if;
      v_line_id:=(v_json->>'purchase_order_line_id')::uuid;
      select * into v_line from public.purchase_order_lines where id=v_line_id and company_id=v_company and purchase_order_id=v_po_id;
      if not found then raise exception 'A supplier bill line does not belong to the selected purchase order'; end if;
      v_quantity:=(v_json->>'quantity')::numeric; v_rate:=(v_json->>'rate')::numeric; v_total:=coalesce(nullif(v_json->>'base_amount','')::numeric,0); v_gst:=coalesce(nullif(v_json->>'tax_amount','')::numeric,0);
      if 'NaN'::numeric in (v_quantity,v_rate,v_total,v_gst) or v_quantity<=0 or v_quantity>100000000 or v_quantity<>round(v_quantity,3) or v_rate<0 or v_rate>1000000000 or v_rate<>round(v_rate,2) or v_total<=0 or v_gst<0 or v_total>1000000000000 or v_gst>1000000000000 or v_total<>round(v_total,2) or v_gst<>round(v_gst,2) then raise exception 'Reviewed bill lines require finite quantities up to three decimals and INR amounts up to two decimals'; end if;
      if (v_json->>'unit') is distinct from v_line.unit or v_total<>round(v_quantity*v_rate,2) then raise exception 'Reviewed bill line unit or base amount does not match its quantity and rate'; end if;
      if (select count(*) from jsonb_array_elements(v_reviewed->'lines') x where (x.value->>'purchase_order_line_id')::uuid=v_line_id)>1 then raise exception 'A purchase order line may appear only once on a supplier bill'; end if;
      v_base:=v_base+v_total;
    end loop;
    select coalesce(sum((x.value->>'tax_amount')::numeric),0) into v_received_total from jsonb_array_elements(v_reviewed->'lines') x;
    v_total:=coalesce(nullif(v_reviewed->>'total_amount','')::numeric,0);
    if abs(v_tax-v_received_total)>0.01 or abs(v_total-(v_base+v_tax+v_freight-v_discount))>0.01 then raise exception 'Bill tax and total must reconcile to reviewed line amounts'; end if;
    select id into v_current_bill from public.supplier_purchase_bills where company_id=v_company and source_document_id=v_source for update;
    if found then
      select * into v_bill from public.supplier_purchase_bills where id=v_current_bill and company_id=v_company for update;
      if v_bill.status<>'draft' then raise exception 'A posted supplier bill cannot be changed'; end if;
      if v_bill.vendor_id<>v_vendor or v_bill.purchase_order_id<>v_po_id or v_bill.normalized_invoice_number<>v_norm or v_bill.invoice_date<>v_date then
        if exists(select 1 from public.supplier_purchase_bills b where b.company_id=v_company and b.vendor_id=v_vendor and b.normalized_invoice_number=v_norm and b.invoice_date=v_date and b.id<>v_bill.id) then raise exception 'This supplier invoice number and date already exist'; end if;
      end if;
      delete from public.supplier_purchase_bill_lines where supplier_bill_id=v_bill.id and company_id=v_company;
      update public.supplier_purchase_bills set purchase_order_id=v_po_id,vendor_id=v_vendor,vendor_name_snapshot=v_vendor_name where id=v_bill.id and company_id=v_company;
      for v_json in select value from jsonb_array_elements(v_reviewed->'lines') loop
        insert into public.supplier_purchase_bill_lines(company_id,supplier_bill_id,purchase_order_id,purchase_order_line_id,quantity,unit,rate,base_amount,tax_amount)
          values(v_company,v_bill.id,v_po_id,(v_json->>'purchase_order_line_id')::uuid,round((v_json->>'quantity')::numeric,3),v_json->>'unit',round((v_json->>'rate')::numeric,2),round((v_json->>'base_amount')::numeric,2),round((v_json->>'tax_amount')::numeric,2));
      end loop;
      update public.supplier_purchase_bills set purchase_order_id=v_po_id,vendor_id=v_vendor,source_hash=v_source_hash,review_revision=v_expected_revision+1,
        review_hash=v_review_hash,invoice_number=v_number,normalized_invoice_number=v_norm,invoice_date=v_date,due_date=v_due_date,tax_amount=round(v_tax,2),
        freight_amount=round(v_freight,2),discount_amount=round(v_discount,2),total_amount=round(v_total,2),match_status='unmatched',
        match_snapshot='{}'::jsonb,matched_review_hash=null,matched_at=null,updated_by=v_actor,updated_at=now()
        where id=v_bill.id and company_id=v_company;
      v_id:=v_bill.id;
      perform private.purchase_lifecycle_event(v_company,p_command,'supplier_bill',v_id,jsonb_build_object('revision',v_expected_revision+1,'reviewed',v_reviewed,'source_hash',v_source_hash));
    else
      v_id:=null;
    end if;
    update public.supplier_purchase_documents set review_revision=v_expected_revision+1,review_hash=v_review_hash,reviewed_payload=v_reviewed,reviewed_by=v_actor,reviewed_at=now()
      where id=v_source and company_id=v_company;
    perform private.purchase_lifecycle_event(v_company,p_command,'supplier_document',v_source,jsonb_build_object('review_revision',v_expected_revision+1,'review_hash',v_review_hash,'reviewed',v_reviewed));
    return jsonb_build_object('kind','document_reviewed','source_id',v_source,'review_revision',v_expected_revision+1,'review_hash',v_review_hash,'bill_id',v_id,'idempotent_replay',false);
  elsif p_command='bill.create' then
    if p_payload-array['source_id','source_hash','review_revision','review_hash']<>'{}' then raise exception 'Invalid supplier bill request'; end if;
    v_source:=(p_payload->>'source_id')::uuid; v_source_hash:=lower(p_payload->>'source_hash'); v_expected_revision:=(p_payload->>'review_revision')::integer; v_review_hash:=p_payload->>'review_hash';
    select * into v_doc from public.supplier_purchase_documents where id=v_source and company_id=v_company and source_hash=v_source_hash for update;
    if not found or v_doc.reviewed_payload is null or v_doc.review_revision<>v_expected_revision or v_doc.review_hash is distinct from v_review_hash then raise exception 'Review the exact uploaded supplier document version before creating its bill'; end if;
    select * into v_bill from public.supplier_purchase_bills where company_id=v_company and source_document_id=v_source for update;
    if found then
      if v_bill.source_hash<>v_source_hash or v_bill.review_hash<>v_review_hash or v_bill.review_revision<>v_expected_revision then raise exception 'That source document already belongs to a different bill revision'; end if;
      return jsonb_build_object('kind','bill_created','id',v_bill.id,'status',v_bill.status,'match_status',v_bill.match_status,'match_snapshot',v_bill.match_snapshot,'idempotent_replay',true);
    end if;
    v_reviewed:=v_doc.reviewed_payload; v_vendor:=(v_reviewed->>'vendor_id')::uuid; v_po_id:=(v_reviewed->>'purchase_order_id')::uuid;
    select * into v_order from public.purchase_orders where id=v_po_id and company_id=v_company and vendor_id=v_vendor and status='open';
    if not found then raise exception 'Purchase order is unavailable for this supplier'; end if;
    v_vendor_name:=v_order.vendor_name_snapshot;
    v_number:=btrim(v_reviewed->>'invoice_number'); v_norm:=regexp_replace(upper(v_number),'[^A-Z0-9]','','g'); v_date:=(v_reviewed->>'invoice_date')::date; v_due_date:=nullif(v_reviewed->>'due_date','')::date;
    if exists(select 1 from public.expense_ledger e where e.company_id=v_company and e.vendor_id=v_vendor and e.deleted_at is null
      and e.approval_status not in ('cancelled','rejected','reversed') and regexp_replace(upper(btrim(coalesce(e.invoice_number,''))),'[^A-Z0-9]','','g')=v_norm and e.invoice_date=v_date) then
      raise exception 'This normalized supplier invoice number and date are already recorded in expenses';
    end if;
    v_id:=gen_random_uuid();
      insert into public.supplier_purchase_bills(id,company_id,purchase_order_id,vendor_id,vendor_name_snapshot,source_document_id,source_hash,review_revision,review_hash,
      invoice_number,normalized_invoice_number,invoice_date,due_date,tax_amount,freight_amount,discount_amount,total_amount,created_by,updated_by)
      values(v_id,v_company,v_po_id,v_vendor,v_vendor_name,v_source,v_source_hash,v_expected_revision,v_review_hash,v_number,v_norm,v_date,v_due_date,
        (v_reviewed->>'tax_amount')::numeric,(v_reviewed->>'freight_amount')::numeric,(v_reviewed->>'discount_amount')::numeric,(v_reviewed->>'total_amount')::numeric,v_actor,v_actor);
    for v_json in select value from jsonb_array_elements(v_reviewed->'lines') loop
      insert into public.supplier_purchase_bill_lines(company_id,supplier_bill_id,purchase_order_id,purchase_order_line_id,quantity,unit,rate,base_amount,tax_amount)
        values(v_company,v_id,v_po_id,(v_json->>'purchase_order_line_id')::uuid,(v_json->>'quantity')::numeric,v_json->>'unit',(v_json->>'rate')::numeric,(v_json->>'base_amount')::numeric,(v_json->>'tax_amount')::numeric);
    end loop;
    v_match:=private.purchase_bill_match(v_id,v_company);
    update public.supplier_purchase_bills set match_status=case when (v_match->>'matched')::boolean then 'matched' else 'unmatched' end,
      match_snapshot=v_match,matched_review_hash=case when (v_match->>'matched')::boolean then v_review_hash else null end,
      matched_at=case when (v_match->>'matched')::boolean then now() else null end,updated_at=now()
      where id=v_id and company_id=v_company;
    perform private.purchase_lifecycle_event(v_company,p_command,'supplier_bill',v_id,jsonb_build_object('source_id',v_source,'source_hash',v_source_hash,'review_hash',v_review_hash,'match',v_match));
    return jsonb_build_object('kind','bill_created','id',v_id,'status','draft','match_status',case when (v_match->>'matched')::boolean then 'matched' else 'unmatched' end,'match_snapshot',v_match,'idempotent_replay',false);
  elsif p_command='bill.match' then
    if p_payload-array['bill_id']<>'{}' then raise exception 'Invalid supplier bill matching request'; end if;
    select * into v_bill from public.supplier_purchase_bills where id=(p_payload->>'bill_id')::uuid and company_id=v_company for update;
    if not found then raise exception 'Supplier bill is unavailable'; end if;
    if v_bill.status='posted' then return jsonb_build_object('kind','bill_match','id',v_bill.id,'status',v_bill.status,'match_status',v_bill.match_status,'match_snapshot',v_bill.match_snapshot,'idempotent_replay',true); end if;
    perform 1 from public.purchase_order_lines where purchase_order_id=v_bill.purchase_order_id and company_id=v_company order by id for update;
    v_match:=private.purchase_bill_match(v_bill.id,v_company);
    update public.supplier_purchase_bills set match_status=case when (v_match->>'matched')::boolean then 'matched' else 'unmatched' end,
      match_snapshot=v_match,matched_review_hash=case when (v_match->>'matched')::boolean then v_bill.review_hash else null end,
      matched_at=case when (v_match->>'matched')::boolean then now() else null end,updated_by=v_actor,updated_at=now()
      where id=v_bill.id and company_id=v_company;
    perform private.purchase_lifecycle_event(v_company,p_command,'supplier_bill',v_bill.id,jsonb_build_object('review_hash',v_bill.review_hash,'match',v_match));
    return jsonb_build_object('kind','bill_match','id',v_bill.id,'status',v_bill.status,'match_status',case when (v_match->>'matched')::boolean then 'matched' else 'unmatched' end,'match_snapshot',v_match,'idempotent_replay',false);
  elsif p_command='bill.post' then
    if p_payload-array['bill_id','source_hash','review_revision','review_hash']<>'{}' then raise exception 'Invalid supplier bill posting request'; end if;
    select * into v_bill from public.supplier_purchase_bills where id=(p_payload->>'bill_id')::uuid and company_id=v_company for update;
    if not found then raise exception 'Supplier bill is unavailable'; end if;
    if v_bill.status='posted' then
      if v_bill.source_hash<>p_payload->>'source_hash' or v_bill.review_revision<>(p_payload->>'review_revision')::integer or v_bill.review_hash<>p_payload->>'review_hash' then raise exception 'Posted supplier bill replay does not match its reviewed source version'; end if;
      return jsonb_build_object('kind','bill_posted','id',v_bill.id,'expense_ledger_id',v_bill.expense_ledger_id,'approval_status','pending_approval','idempotent_replay',true);
    end if;
    if v_bill.source_hash<>p_payload->>'source_hash' or v_bill.review_revision<>(p_payload->>'review_revision')::integer or v_bill.review_hash<>p_payload->>'review_hash' then raise exception 'Supplier bill source or review version changed; reload and match the current version'; end if;
    select * into v_doc from public.supplier_purchase_documents where id=v_bill.source_document_id and company_id=v_company for update;
    if not found or v_doc.source_hash<>v_bill.source_hash or v_doc.review_revision<>v_bill.review_revision or v_doc.review_hash<>v_bill.review_hash then raise exception 'Supplier bill does not match the exact human reviewed source version'; end if;
    perform 1 from public.purchase_order_lines where purchase_order_id=v_bill.purchase_order_id and company_id=v_company order by id for update;
    v_match:=private.purchase_bill_match(v_bill.id,v_company);
    if (v_match->>'matched')::boolean is distinct from true then raise exception 'Supplier bill is unmatched and cannot be posted: %',v_match->'exceptions'; end if;
    select * into v_order from public.purchase_orders where id=v_bill.purchase_order_id and company_id=v_company;
    if not found then raise exception 'Purchase order is unavailable'; end if;
    v_vendor_name:=v_bill.vendor_name_snapshot;
    select coalesce(sum(base_amount),0) into v_base from public.supplier_purchase_bill_lines where supplier_bill_id=v_bill.id and company_id=v_company;
    v_expense:=public.upsert_source_expense_v2(v_company,'purchasing','supplier_bill','supplier_purchase_bills',v_bill.id,
      v_bill.invoice_number,'raw_material',null,v_bill.vendor_id,'Supplier bill '||v_bill.invoice_number||' against PO '||v_order.po_number,
      0,'multiple',0,v_base,v_bill.tax_amount,v_bill.freight_amount,v_bill.discount_amount,v_bill.total_amount,'unpaid',null,
      v_bill.invoice_number,v_bill.invoice_date,v_bill.due_date,null,v_vendor_name);
    update public.supplier_purchase_bills set status='posted',match_status='matched',match_snapshot=v_match,matched_review_hash=v_bill.review_hash,
      matched_at=now(),expense_ledger_id=v_expense,posted_by=v_actor,posted_at=now(),updated_by=v_actor,updated_at=now()
      where id=v_bill.id and company_id=v_company;
    perform private.purchase_lifecycle_event(v_company,p_command,'supplier_bill',v_bill.id,jsonb_build_object('review_hash',v_bill.review_hash,'expense_ledger_id',v_expense,'match',v_match));
    return jsonb_build_object('kind','bill_posted','id',v_bill.id,'expense_ledger_id',v_expense,'approval_status','pending_approval','idempotent_replay',false);
  end if;
  raise exception 'Unknown purchase lifecycle command';
end;
$$;
revoke all on function public.purchase_lifecycle_command(text,jsonb) from public, anon;
grant execute on function public.purchase_lifecycle_command(text,jsonb) to authenticated;

commit;
