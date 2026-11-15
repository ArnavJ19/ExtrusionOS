-- Autopilot batch 9: AP-073, 074, 075, 076, 095, 008, 009, 010, 034 and 048.
-- Additive. Depends on batches 1-8. Nothing here posts stock, money or quality approval, or sends a customer message, by
-- itself: rate cards are prepared for a person to share, scrap sales, weight-difference notes and reservations are
-- confirmed by a person, register photos and enquiries become drafts, scale readings are labelled with their source, and
-- the cash forecast is a read model.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.ap9_int(p_payload jsonb, p_key text, p_label text, p_min integer, p_max integer)
returns integer language plpgsql immutable set search_path = public, private as $$
declare v text := p_payload ->> p_key; n numeric;
begin
  if v is null or btrim(v) = '' then return null; end if;
  begin n := v::numeric; exception when others then raise exception 'AP: % must be a whole number.', p_label; end;
  if n <> trunc(n) or n < p_min or n > p_max then raise exception 'AP: % must be a whole number from % to %.', p_label, p_min, p_max; end if;
  return n::integer;
end;
$$;
revoke all on function private.ap9_int(jsonb, text, text, integer, integer) from public, anon, authenticated;

-- Normalised key of a profile code or shop-floor alias: capitals and digits only ("om-2045 " -> "OM2045").
create or replace function private.ap9_code_key(p text)
returns text language sql immutable set search_path = public, private as $$
  select nullif(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '')
$$;
revoke all on function private.ap9_code_key(text) from public, anon, authenticated;

create or replace function private.ap9_finish_label(p text)
returns text language sql immutable set search_path = public, private as $$
  select case p when 'mill_finish' then 'Mill finish' when 'powder_coating' then 'Powder coated' when 'anodizing' then 'Anodised'
    when 'wood_finish' then 'Wood finish' when 'wood_grain' then 'Wood grain' when 'pvdf' then 'PVDF' when 'electrophoretic' then 'Electrophoretic'
    else initcap(replace(coalesce(p, 'finish'), '_', ' ')) end
$$;
revoke all on function private.ap9_finish_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-073: customer rate cards from today's approved billet, conversion and finishing rates
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  card_number text not null check (card_number ~ '^RC-[0-9]{6}-[0-9]{3,}$'),
  rate_day date not null,
  valid_until date not null,
  gst_percent numeric(5,2) not null check (gst_percent between 0 and 28),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  -- Selling prices only: family, alloy, finish and rate per kg. Never cost, margin or supplier rates.
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  -- Internal: lines left off the card (below the floor or without an approved rate). Never printed.
  excluded jsonb not null default '[]' check (jsonb_typeof(excluded) = 'array'),
  customer_name text not null,
  customer_type text,
  shared_channel text check (shared_channel in ('pdf', 'whatsapp')),
  shared_by uuid references public.app_users(id),
  shared_at timestamptz,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  check (valid_until >= rate_day),
  check ((shared_at is null) = (shared_by is null)),
  unique (company_id, card_number)
);
create index if not exists rate_cards_company_idx on public.rate_cards(company_id, rate_day desc, card_number desc);
create index if not exists rate_cards_customer_idx on public.rate_cards(company_id, customer_id, rate_day desc);

-- The card for one customer on one day: for each alloy and finish, billet (customer, alloy or general) plus the customer's
-- agreed conversion (or the general one) plus the per-kg finishing rate. A line whose conversion is below the floor
-- (AP-072) or that has no approved rate is left off and listed internally. Blank stays blank: no zero rates.
create or replace function private.ap9_rate_lines(p_company uuid, p_customer uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare g record; f record; v_billet public.costing_rates%rowtype; v_conv public.costing_rates%rowtype; v_fin public.costing_rates%rowtype;
  v_other public.costing_rates%rowtype; v_floor public.price_floors%rowtype; v_lines jsonb := '[]'; v_excluded jsonb := '[]'; v_ids text[] := '{}'; v_rate numeric;
begin
  for g in
    select nullif(upper(btrim(p.alloy)), '') alloy,
      string_agg(distinct coalesce(nullif(btrim(p.product_family), ''), initcap(replace(p.application_category, '_', ' '))), ', '
        order by coalesce(nullif(btrim(p.product_family), ''), initcap(replace(p.application_category, '_', ' ')))) families
    from public.aluminium_profiles p
    where p.company_id = p_company and p.is_active and p.deleted_at is null
    group by 1 order by 1 nulls last
  loop
    v_billet := private.applicable_costing_rate(p_company, 'billet', 'per_kg', p_day, p_customer, g.alloy, null);
    v_conv := private.applicable_costing_rate(p_company, 'conversion', 'per_kg', p_day, p_customer, null, null);
    for f in
      select 'mill_finish'::text finishing_type union
      select distinct r.finishing_type from public.costing_rates r
        where r.company_id = p_company and r.rate_type = 'finishing' and r.status = 'approved' and r.finishing_type <> 'mill_finish'
          and r.effective_from <= p_day and (r.effective_to is null or r.effective_to >= p_day) and (r.customer_id is null or r.customer_id = p_customer)
      order by 1
    loop
      v_fin := null; v_other := null;
      if f.finishing_type <> 'mill_finish' then
        v_fin := private.applicable_costing_rate(p_company, 'finishing', 'per_kg', p_day, p_customer, null, f.finishing_type);
        if v_fin.id is null then
          v_other := private.applicable_costing_rate(p_company, 'finishing', 'per_sqft', p_day, p_customer, null, f.finishing_type);
          if v_other.id is null then v_other := private.applicable_costing_rate(p_company, 'finishing', 'per_meter', p_day, p_customer, null, f.finishing_type); end if;
        end if;
      end if;
      if v_billet.id is null or v_conv.id is null then
        v_excluded := v_excluded || jsonb_build_object('families', g.families, 'alloy', g.alloy, 'finish', f.finishing_type,
          'reason', case when v_billet.id is null then 'No approved billet rate for today' else 'No approved conversion rate for today' end);
        continue;
      end if;
      v_floor := private.ap5_floor(p_company, g.alloy, f.finishing_type, 0);
      if v_floor.id is not null and v_conv.rate < v_floor.floor_per_kg then
        v_excluded := v_excluded || jsonb_build_object('families', g.families, 'alloy', g.alloy, 'finish', f.finishing_type,
          'reason', 'Conversion ₹' || trim_scale(v_conv.rate) || '/kg is below the floor of ₹' || trim_scale(v_floor.floor_per_kg) || '/kg');
        continue;
      end if;
      v_rate := round(v_billet.rate + v_conv.rate + coalesce(v_fin.rate, 0), 2);
      v_lines := v_lines || jsonb_build_object('families', g.families, 'alloy', g.alloy, 'finish', f.finishing_type, 'finish_label', private.ap9_finish_label(f.finishing_type),
        'rate_per_kg', v_rate,
        'finish_extra', case when v_other.id is null then null else jsonb_build_object('rate', round(v_other.rate, 2), 'basis', v_other.basis) end);
      v_ids := v_ids || array[coalesce(v_billet.id::text, ''), coalesce(v_conv.id::text, ''), coalesce(v_fin.id::text, ''), coalesce(v_other.id::text, '')];
    end loop;
  end loop;
  return jsonb_build_object('lines', v_lines, 'excluded', v_excluded, 'fingerprint', md5(v_lines::text || array_to_string(v_ids, ',')));
end;
$$;
revoke all on function private.ap9_rate_lines(uuid, uuid, date) from public, anon, authenticated;

create or replace function private.ap9_card_json(x public.rate_cards, p_internal boolean)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', x.id, 'card_number', x.card_number, 'customer_id', x.customer_id, 'customer_name', x.customer_name, 'customer_type', x.customer_type,
    'rate_day', x.rate_day, 'valid_until', x.valid_until, 'gst_percent', x.gst_percent, 'lines', x.lines, 'created_at', x.created_at,
    'created_by', (select full_name from public.app_users where id = x.created_by), 'shared_channel', x.shared_channel, 'shared_at', x.shared_at,
    'company', (select jsonb_build_object('name', coalesce(nullif(c.legal_name, ''), c.name), 'gst_number', c.gst_number, 'city', c.city, 'phone', c.phone, 'email', c.email) from public.companies c where c.id = x.company_id))
    || case when p_internal then jsonb_build_object('excluded', x.excluded) else '{}'::jsonb end
$$;
revoke all on function private.ap9_card_json(public.rate_cards, boolean) from public, anon, authenticated;

-- One card per customer per day and fingerprint: generating again without a rate change returns the same card.
create or replace function private.ap9_card_make(p_company uuid, p_actor uuid, p_customer uuid, p_day date, p_valid integer, p_expect text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare cu public.customers%rowtype; v jsonb; x public.rate_cards%rowtype; v_seq integer; v_gst numeric;
begin
  select * into cu from public.customers where id = p_customer and company_id = p_company and is_active and deleted_at is null;
  if cu.id is null then raise exception 'AP: Customer not found.'; end if;
  v := private.ap9_rate_lines(p_company, p_customer, p_day);
  if p_expect is not null and p_expect <> v ->> 'fingerprint' then
    return jsonb_build_object('state', 'stale', 'message', 'Rates changed after the preview. Review the card again.');
  end if;
  if jsonb_array_length(v -> 'lines') = 0 then
    return jsonb_build_object('state', 'no_lines', 'message', 'No line can be priced today: ' || coalesce((select string_agg(distinct e ->> 'reason', '; ') from jsonb_array_elements(v -> 'excluded') e), 'no approved rates') || '.');
  end if;
  select * into x from public.rate_cards where company_id = p_company and customer_id = p_customer and rate_day = p_day and fingerprint = v ->> 'fingerprint'
    and valid_until = p_day + p_valid order by created_at desc limit 1;
  if x.id is not null then return jsonb_build_object('state', 'unchanged', 'card', private.ap9_card_json(x, true)); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':ap9-rate-card:' || p_day, 0));
  select coalesce(max(substring(card_number from 11)::integer), 0) + 1 into v_seq from public.rate_cards where company_id = p_company and rate_day = p_day;
  select coalesce(default_gst_percent, 18) into v_gst from public.company_settings where company_id = p_company;
  insert into public.rate_cards(company_id, customer_id, card_number, rate_day, valid_until, gst_percent, fingerprint, lines, excluded, customer_name, customer_type, created_by)
    values (p_company, p_customer, 'RC-' || to_char(p_day, 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0'), p_day, p_day + p_valid, coalesce(v_gst, 18),
      v ->> 'fingerprint', v -> 'lines', v -> 'excluded', coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name), cu.customer_type, p_actor)
    returning * into x;
  return jsonb_build_object('state', 'generated', 'card', private.ap9_card_json(x, true));
end;
$$;
revoke all on function private.ap9_card_make(uuid, uuid, uuid, date, integer, text) from public, anon, authenticated;

create or replace function public.ap_rate_card(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_day date := private.ist_today(); v_valid integer; v jsonb; x public.rate_cards%rowtype; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_search text := lower(btrim(coalesce(p_payload ->> 'search', ''))); r record; v_gen integer := 0; v_same integer := 0; v_none integer := 0; v_out jsonb; v_type text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales', 'accounts']);
  if p_command in ('preview', 'generate', 'generate_all') then
    v_valid := coalesce(private.ap9_int(p_payload, 'valid_days', 'Valid for days', 0, 15), 0);
  end if;
  if p_command = 'status' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('today', v_day,
      'billet_rates', (select count(*) from public.costing_rates cr where cr.company_id = c.company_id and cr.rate_type = 'billet' and cr.status = 'approved'
        and cr.effective_from <= v_day and (cr.effective_to is null or cr.effective_to >= v_day)),
      'rate_updated_today', exists (select 1 from public.costing_rates cr where cr.company_id = c.company_id and cr.rate_type = 'billet' and cr.status = 'approved' and cr.effective_from = v_day),
      'last_rate_approved_at', (select max(cr.approved_at) from public.costing_rates cr where cr.company_id = c.company_id and cr.rate_type = 'billet' and cr.status = 'approved'),
      'cards_today', (select count(*) from public.rate_cards rc where rc.company_id = c.company_id and rc.rate_day = v_day),
      'customer_types', (select coalesce(jsonb_object_agg(t, n), '{}') from (select customer_type t, count(*) n from public.customers
        where company_id = c.company_id and is_active and deleted_at is null group by 1) q));
  elsif p_command = 'preview' then
    perform private.ap_keys(p_payload, array['customer_id', 'valid_days']);
    if not exists (select 1 from public.customers where id = private.ap_uuid(p_payload, 'customer_id') and company_id = c.company_id and is_active and deleted_at is null) then
      raise exception 'AP: Customer not found.';
    end if;
    v := private.ap9_rate_lines(c.company_id, private.ap_uuid(p_payload, 'customer_id'), v_day);
    return v || jsonb_build_object('rate_day', v_day, 'valid_until', v_day + v_valid);
  elsif p_command = 'generate' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['customer_id', 'valid_days', 'fingerprint']);
    return private.ap9_card_make(c.company_id, c.actor_id, private.ap_uuid(p_payload, 'customer_id'), v_day, v_valid, nullif(p_payload ->> 'fingerprint', ''));
  elsif p_command = 'generate_all' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['customer_type', 'valid_days']);
    v_type := p_payload ->> 'customer_type';
    if v_type is null or v_type not in ('fabricator', 'dealer', 'architect', 'industrial', 'solar', 'government', 'export', 'contractor', 'other') then
      raise exception 'AP: Choose the customer category.';
    end if;
    for r in select id from public.customers where company_id = c.company_id and is_active and deleted_at is null and customer_type = v_type order by customer_name, id limit 300 loop
      v_out := private.ap9_card_make(c.company_id, c.actor_id, r.id, v_day, v_valid, null);
      if v_out ->> 'state' = 'generated' then v_gen := v_gen + 1; elsif v_out ->> 'state' = 'unchanged' then v_same := v_same + 1; else v_none := v_none + 1; end if;
    end loop;
    return jsonb_build_object('generated', v_gen, 'unchanged', v_same, 'not_priced', v_none, 'customer_type', v_type, 'rate_day', v_day);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'search', 'day']);
    with f as (select rc.*, row_number() over (order by rc.rate_day desc, rc.card_number desc) k from public.rate_cards rc
      where rc.company_id = c.company_id and (nullif(p_payload ->> 'day', '') is null or rc.rate_day = (p_payload ->> 'day')::date)
        and (v_search = '' or lower(rc.customer_name || ' ' || rc.card_number) like '%' || v_search || '%'))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'card_number', f.card_number, 'customer_name', f.customer_name, 'customer_type', f.customer_type,
        'rate_day', f.rate_day, 'valid_until', f.valid_until, 'lines', jsonb_array_length(f.lines), 'excluded', jsonb_array_length(f.excluded),
        'shared_channel', f.shared_channel, 'shared_at', f.shared_at) order by f.k) from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into x from public.rate_cards where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if x.id is null then raise exception 'AP: Rate card not found.'; end if;
    return private.ap9_card_json(x, true);
  elsif p_command = 'shared' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'sales_manager', 'sales']);
    perform private.ap_keys(p_payload, array['id', 'channel']);
    if coalesce(p_payload ->> 'channel', '') not in ('pdf', 'whatsapp') then raise exception 'AP: Choose PDF or WhatsApp.'; end if;
    update public.rate_cards set shared_channel = p_payload ->> 'channel', shared_by = c.actor_id, shared_at = clock_timestamp()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id returning * into x;
    if x.id is null then raise exception 'AP: Rate card not found.'; end if;
    return jsonb_build_object('id', x.id, 'shared_channel', x.shared_channel, 'shared_at', x.shared_at);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_rate_card(text, jsonb) from public, anon;
grant execute on function public.ap_rate_card(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-095: shop-floor language per person (labels only; record values never change)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.user_language_preferences (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  language text not null check (language in ('en', 'hi')),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists user_language_company_idx on public.user_language_preferences(company_id, language);

create or replace function public.ap_language(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_lang text;
begin
  select * into c from private.ap_ctx(null);
  if p_command = 'get' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('language', coalesce((select language from public.user_language_preferences where user_id = c.actor_id and company_id = c.company_id), 'en'));
  elsif p_command = 'set' then
    perform private.ap_keys(p_payload, array['language']);
    v_lang := p_payload ->> 'language';
    if v_lang is null or v_lang not in ('en', 'hi') then raise exception 'AP: Choose English or Hindi.'; end if;
    insert into public.user_language_preferences(user_id, company_id, language) values (c.actor_id, c.company_id, v_lang)
      on conflict (user_id) do update set language = excluded.language, company_id = excluded.company_id, updated_at = clock_timestamp();
    return jsonb_build_object('language', v_lang);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_language(text, jsonb) from public, anon;
grant execute on function public.ap_language(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-074: scrap stock by grade, buyer offers, sale, weighbridge weight and a GST invoice
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.scrap_grades (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(btrim(name)) between 3 and 80 and name !~ '[[:cntrl:]]'),
  hsn_code text not null default '7602' check (hsn_code ~ '^[0-9]{4,8}$'),
  gst_percent numeric(5,2) not null default 18 check (gst_percent between 0 and 28),
  -- Process scrap categories (production_scrap_lines.category) and other scrap types (scrap_records.scrap_type) of this grade.
  foundry_categories text[] not null default '{}',
  scrap_types text[] not null default '{}',
  sort_order integer not null default 100 check (sort_order between 0 and 1000),
  is_active boolean not null default true,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz,
  unique (company_id, code)
);
create index if not exists scrap_grades_company_idx on public.scrap_grades(company_id, is_active, sort_order);

create table if not exists public.scrap_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  grade_id uuid not null references public.scrap_grades(id),
  buyer_id uuid not null references public.customers(id),
  rate_per_kg numeric(12,2) not null check (rate_per_kg > 0 and rate_per_kg <= 10000),
  quantity_kg numeric(14,3) not null check (quantity_kg > 0 and quantity_kg <= 10000000),
  valid_until date not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'withdrawn')),
  note text check (note is null or (length(btrim(note)) between 3 and 300 and note !~ '[[:cntrl:]]')),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  check ((status = 'open') = (decided_at is null))
);
create index if not exists scrap_offers_company_idx on public.scrap_offers(company_id, grade_id, status, rate_per_kg desc);
create index if not exists scrap_offers_buyer_idx on public.scrap_offers(buyer_id);

create table if not exists public.scrap_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_number text not null,
  grade_id uuid not null references public.scrap_grades(id),
  buyer_id uuid not null references public.customers(id),
  offer_id uuid unique references public.scrap_offers(id),
  rate_per_kg numeric(12,2) not null check (rate_per_kg > 0),
  ordered_kg numeric(14,3) not null check (ordered_kg > 0),
  not_best_reason text check (not_best_reason is null or length(btrim(not_best_reason)) between 5 and 300),
  status text not null default 'ordered' check (status in ('ordered', 'weighed', 'invoiced', 'paid', 'cancelled')),
  gross_kg numeric(14,3) check (gross_kg is null or gross_kg > 0),
  tare_kg numeric(14,3) check (tare_kg is null or tare_kg >= 0),
  net_kg numeric(14,3) check (net_kg is null or net_kg > 0),
  weighbridge_ref text check (weighbridge_ref is null or length(btrim(weighbridge_ref)) between 1 and 80),
  vehicle_registration text check (vehicle_registration is null or vehicle_registration ~ '^[A-Z0-9]{4,15}$'),
  weighed_by uuid references public.app_users(id),
  weighed_at timestamptz,
  invoice_number text,
  invoice_date date,
  hsn_code text,
  gst_percent numeric(5,2),
  taxable_value numeric(14,2),
  cgst_amount numeric(14,2),
  sgst_amount numeric(14,2),
  igst_amount numeric(14,2),
  invoice_total numeric(14,2),
  place_of_supply text,
  supply_basis text,
  invoiced_by uuid references public.app_users(id),
  invoiced_at timestamptz,
  amount_received numeric(14,2) not null default 0 check (amount_received >= 0),
  paid_at timestamptz,
  cancelled_by uuid references public.app_users(id),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 5 and 300),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  check (gross_kg is null or tare_kg is null or gross_kg > tare_kg),
  check ((status in ('weighed', 'invoiced', 'paid')) <= (net_kg is not null)),
  check ((status in ('invoiced', 'paid')) = (invoice_number is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (invoice_total is null or amount_received <= invoice_total),
  unique (company_id, sale_number)
);
create unique index if not exists scrap_sales_invoice_key on public.scrap_sales(company_id, invoice_number) where invoice_number is not null;
create index if not exists scrap_sales_company_idx on public.scrap_sales(company_id, status, created_at desc);
create index if not exists scrap_sales_buyer_idx on public.scrap_sales(buyer_id);

-- Where each sold kilogram came from: a foundry lot of in-house scrap (its available weight is reduced) or the yard
-- (scrap that never went to the foundry pool). A cancelled sale releases its allocations.
create table if not exists public.scrap_sale_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.scrap_sales(id),
  grade_id uuid not null references public.scrap_grades(id),
  foundry_scrap_id uuid references public.foundry_aluminium_scrap(id),
  kg numeric(14,3) not null check (kg > 0),
  released_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists scrap_sale_allocations_sale_idx on public.scrap_sale_allocations(company_id, sale_id);
create index if not exists scrap_sale_allocations_grade_idx on public.scrap_sale_allocations(company_id, grade_id) where released_at is null;
create index if not exists scrap_sale_allocations_lot_idx on public.scrap_sale_allocations(foundry_scrap_id) where foundry_scrap_id is not null;

create table if not exists public.scrap_sale_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.scrap_sales(id),
  amount numeric(14,2) not null check (amount > 0),
  received_on date not null,
  method text not null check (method in ('bank_transfer', 'upi', 'cheque', 'cash', 'other')),
  reference text check (reference is null or length(btrim(reference)) between 1 and 80),
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists scrap_sale_receipts_company_idx on public.scrap_sale_receipts(company_id, received_on desc);
create index if not exists scrap_sale_receipts_sale_idx on public.scrap_sale_receipts(sale_id);

-- A sale's allocation is the only writer of a foundry lot's available weight outside the furnace charge. It runs as a
-- nested writer, so the lot's own balance guard accepts it; the lot never goes below zero.
create or replace function private.ap9_sale_allocation_lot()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_avail numeric; v_weight numeric; v_next numeric;
begin
  if new.foundry_scrap_id is null then return null; end if;
  if tg_op = 'UPDATE' and not (old.released_at is null and new.released_at is not null) then return null; end if;
  select coalesce(available_weight_kg, weight_kg), weight_kg into v_avail, v_weight from public.foundry_aluminium_scrap where id = new.foundry_scrap_id and company_id = new.company_id for update;
  if v_weight is null then raise exception 'AP: Foundry lot not found.'; end if;
  v_next := case when tg_op = 'INSERT' then round(v_avail - new.kg, 3) else least(v_weight, round(v_avail + new.kg, 3)) end;
  if v_next < -0.0005 then raise exception 'AP: The foundry lot has only % kg left.', trim_scale(v_avail); end if;
  update public.foundry_aluminium_scrap set available_weight_kg = greatest(v_next, 0),
    status = case when status in ('rejected', 'returned') then status when greatest(v_next, 0) >= weight_kg then 'available' when v_next <= 0.0005 then 'used' else 'reserved' end,
    updated_at = now() where id = new.foundry_scrap_id;
  return null;
end;
$$;
revoke all on function private.ap9_sale_allocation_lot() from public, anon, authenticated;
drop trigger if exists ap9_sale_allocation_lot on public.scrap_sale_allocations;
create trigger ap9_sale_allocation_lot after insert or update of released_at on public.scrap_sale_allocations for each row execute function private.ap9_sale_allocation_lot();

create table if not exists public.scrap_invoice_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  fy_label text not null,
  last_value integer not null default 0,
  primary key (company_id, fy_label)
);

-- Default grades the first time the module is opened; the plant edits or adds grades afterwards.
create or replace function private.ap9_scrap_seed(p_company uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from public.scrap_grades where company_id = p_company) then return; end if;
  insert into public.scrap_grades(company_id, code, name, foundry_categories, scrap_types, sort_order) values
    (p_company, 'EXT-CLEAN', 'Clean extrusion scrap (butt ends, crops, saw cuts)', array['butt_end', 'front_back_end', 'saw_cut'], array['butt_scrap', 'cutting_waste'], 10),
    (p_company, 'EXT-REJECT', 'Rejected extrusions (mill finish)', array['rejects', 'qc_reject'], array['rejection'], 20),
    (p_company, 'PAINTED', 'Powder-coated and painted scrap', array['finishing_reject'], array['coating_rejection'], 30),
    (p_company, 'ANODISED', 'Anodised scrap', array[]::text[], array['anodizing_rejection'], 40),
    (p_company, 'MIXED', 'Mixed and unclassified scrap', array['unclassified', 'categorised', 'returned_goods', 'other', 'unrecoverable_loss'], array['packing_damage', 'customer_return', 'remelt_scrap', 'other'], 90);
end;
$$;
revoke all on function private.ap9_scrap_seed(uuid) from public, anon, authenticated;

-- Grade of a process-scrap category or a scrap type: the first active grade that lists it, else MIXED.
create or replace function private.ap9_scrap_grade(p_company uuid, p_category text, p_type text)
returns uuid language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select g.id from public.scrap_grades g where g.company_id = p_company and g.is_active and p_category is not null and p_category = any(g.foundry_categories) order by g.sort_order, g.code limit 1),
    (select g.id from public.scrap_grades g where g.company_id = p_company and g.is_active and p_type is not null and p_type = any(g.scrap_types) order by g.sort_order, g.code limit 1),
    (select g.id from public.scrap_grades g where g.company_id = p_company and g.code = 'MIXED'))
$$;
revoke all on function private.ap9_scrap_grade(uuid, text, text) from public, anon, authenticated;

-- Stock by grade. Generated = recorded in-house scrap (process scrap by its classified lines, other scrap by type),
-- reversed records excluded. Pool = in-house lots the system sent to the foundry. Remelted = pool kg the furnace used.
-- On hand = generated - remelted - sold, split between the foundry pool and the yard.
create or replace function private.ap9_scrap_stock(p_company uuid)
returns table(grade_id uuid, code text, name text, hsn_code text, gst_percent numeric, generated_kg numeric, pool_kg numeric, pool_available_kg numeric,
  remelted_kg numeric, sold_pool_kg numeric, sold_yard_kg numeric, yard_available_kg numeric, on_hand_kg numeric)
language sql stable security definer set search_path = public, private as $$
  with gen as (
    select private.ap9_scrap_grade(p_company, l.category, null) g, l.weight_kg kg
      from public.production_scrap_lines l join public.scrap_records s on s.id = l.scrap_record_id and s.company_id = p_company
      where l.company_id = p_company and not exists (select 1 from public.scrap_record_reversals v where v.scrap_record_id = s.id)
    union all
    select private.ap9_scrap_grade(p_company, null, s.scrap_type), s.weight_kg from public.scrap_records s
      where s.company_id = p_company and s.weight_kg > 0 and not exists (select 1 from public.production_scrap_lines l where l.scrap_record_id = s.id)
        and not exists (select 1 from public.scrap_record_reversals v where v.scrap_record_id = s.id)
  ), pool as (
    select private.ap9_scrap_grade(p_company, f.scrap_category, null) g, f.weight_kg, case when f.status in ('available', 'reserved') then coalesce(f.available_weight_kg, f.weight_kg) else 0 end avail,
      f.id lot from public.foundry_aluminium_scrap f
      where f.company_id = p_company and f.scrap_source = 'in_house' and f.source_scrap_record_id is not null
        and not exists (select 1 from public.scrap_record_reversals v where v.scrap_record_id = f.source_scrap_record_id)
  ), sold as (
    select a.grade_id g, sum(a.kg) filter (where a.foundry_scrap_id is not null) pool_kg, sum(a.kg) filter (where a.foundry_scrap_id is null) yard_kg
      from public.scrap_sale_allocations a where a.company_id = p_company and a.released_at is null group by 1
  )
  select g.id, g.code, g.name, g.hsn_code, g.gst_percent,
    coalesce((select sum(kg) from gen where gen.g = g.id), 0),
    coalesce((select sum(weight_kg) from pool where pool.g = g.id), 0),
    coalesce((select sum(avail) from pool where pool.g = g.id), 0),
    greatest(coalesce((select sum(weight_kg - avail) from pool where pool.g = g.id), 0) - coalesce(sold.pool_kg, 0), 0),
    coalesce(sold.pool_kg, 0), coalesce(sold.yard_kg, 0),
    greatest(coalesce((select sum(kg) from gen where gen.g = g.id), 0) - coalesce((select sum(weight_kg) from pool where pool.g = g.id), 0) - coalesce(sold.yard_kg, 0), 0),
    coalesce((select sum(avail) from pool where pool.g = g.id), 0)
      + greatest(coalesce((select sum(kg) from gen where gen.g = g.id), 0) - coalesce((select sum(weight_kg) from pool where pool.g = g.id), 0) - coalesce(sold.yard_kg, 0), 0)
  from public.scrap_grades g left join sold on sold.g = g.id
  where g.company_id = p_company
  order by g.sort_order, g.code
$$;
revoke all on function private.ap9_scrap_stock(uuid) from public, anon, authenticated;

create or replace function private.ap9_sale_json(s public.scrap_sales)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(s) - 'company_id' || jsonb_build_object(
    'grade', (select jsonb_build_object('code', g.code, 'name', g.name) from public.scrap_grades g where g.id = s.grade_id),
    'buyer', (select jsonb_build_object('id', cu.id, 'name', coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name), 'gst_number', cu.gst_number, 'state', cu.state, 'address', cu.billing_address)
      from public.customers cu where cu.id = s.buyer_id),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('kg', a.kg, 'source', case when a.foundry_scrap_id is null then 'yard' else 'foundry_lot' end,
        'lot', (select f.scrap_number from public.foundry_aluminium_scrap f where f.id = a.foundry_scrap_id), 'released', a.released_at is not null) order by a.created_at), '[]')
      from public.scrap_sale_allocations a where a.sale_id = s.id),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object('amount', r.amount, 'received_on', r.received_on, 'method', r.method, 'reference', r.reference) order by r.received_on, r.recorded_at), '[]')
      from public.scrap_sale_receipts r where r.sale_id = s.id),
    'company', (select jsonb_build_object('name', coalesce(nullif(c.legal_name, ''), c.name), 'gst_number', c.gst_number, 'address', c.billing_address, 'city', c.city, 'state', c.state)
      from public.companies c where c.id = s.company_id))
$$;
revoke all on function private.ap9_sale_json(public.scrap_sales) from public, anon, authenticated;

create or replace function public.ap_scrap_sale(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; g public.scrap_grades%rowtype; o public.scrap_offers%rowtype; s public.scrap_sales%rowtype; st record; v_rows jsonb; v_total bigint;
  v_page integer := private.ap3_page(p_payload); v_kg numeric; v_left numeric; v_take numeric; lot record; v_best numeric; v_seq integer; v_fy text;
  v_supply jsonb; v_tax numeric; v_taxable numeric; v_amount numeric; v_status text; v_search text := lower(btrim(coalesce(p_payload ->> 'search', '')));
  v_manage text[] := array['owner', 'admin', 'accounts', 'factory_manager', 'inventory_manager']; v_money text[] := array['owner', 'admin', 'accounts'];
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'factory_manager', 'inventory_manager', 'production_manager']);
  perform private.ap9_scrap_seed(c.company_id);
  if p_command = 'stock' then
    perform private.ap_keys(p_payload, array[]::text[]);
    select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_rows from private.ap9_scrap_stock(c.company_id) x;
    return jsonb_build_object('grades', v_rows,
      'latest_weighing', (select jsonb_build_object('month', w.month, 'weighed_kg', w.weighed_kg, 'reference', w.reference) from public.scrap_yard_weighings w
        where w.company_id = c.company_id order by w.month desc, w.recorded_at desc limit 1),
      'basis', 'Generated = in-house scrap recorded (process scrap by its classified lines). Foundry pool = lots sent to the foundry. On hand = generated - remelted - sold.');
  elsif p_command = 'grades' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('grades', (select coalesce(jsonb_agg(to_jsonb(x) - 'company_id' - 'created_by' order by x.sort_order, x.code), '[]') from public.scrap_grades x where x.company_id = c.company_id));
  elsif p_command = 'save_grade' then
    perform private.ap4_need(c.role, v_manage);
    perform private.ap_keys(p_payload, array['id', 'code', 'name', 'hsn_code', 'gst_percent', 'foundry_categories', 'scrap_types', 'sort_order', 'is_active']);
    if jsonb_typeof(coalesce(p_payload -> 'foundry_categories', '[]')) <> 'array' or jsonb_typeof(coalesce(p_payload -> 'scrap_types', '[]')) <> 'array' then raise exception 'AP: Invalid request.'; end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'foundry_categories', '[]')) x where x not in ('unclassified', 'categorised', 'butt_end', 'front_back_end', 'saw_cut', 'rejects', 'unrecoverable_loss', 'qc_reject', 'finishing_reject', 'returned_goods', 'other'))
      or exists (select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'scrap_types', '[]')) x where x not in ('butt_scrap', 'process_scrap', 'rejection', 'cutting_waste', 'coating_rejection', 'anodizing_rejection', 'packing_damage', 'customer_return', 'remelt_scrap', 'other')) then
      raise exception 'AP: Choose categories and types from the list.';
    end if;
    if p_payload ? 'id' then
      update public.scrap_grades set name = private.ap_text(p_payload ->> 'name', 'Grade name', 3, 80), hsn_code = coalesce(nullif(btrim(p_payload ->> 'hsn_code'), ''), hsn_code),
        gst_percent = coalesce(private.ap4_num(p_payload, 'gst_percent', 'GST', 0, 28, false), gst_percent),
        foundry_categories = array(select jsonb_array_elements_text(coalesce(p_payload -> 'foundry_categories', '[]'))),
        scrap_types = array(select jsonb_array_elements_text(coalesce(p_payload -> 'scrap_types', '[]'))),
        sort_order = coalesce(private.ap9_int(p_payload, 'sort_order', 'Order', 0, 1000), sort_order),
        is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active), updated_at = clock_timestamp()
        where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id returning * into g;
      if g.id is null then raise exception 'AP: Grade not found.'; end if;
    else
      insert into public.scrap_grades(company_id, code, name, hsn_code, gst_percent, foundry_categories, scrap_types, sort_order, created_by)
        values (c.company_id, upper(btrim(coalesce(p_payload ->> 'code', ''))), private.ap_text(p_payload ->> 'name', 'Grade name', 3, 80), coalesce(nullif(btrim(p_payload ->> 'hsn_code'), ''), '7602'),
          coalesce(private.ap4_num(p_payload, 'gst_percent', 'GST', 0, 28, false), 18), array(select jsonb_array_elements_text(coalesce(p_payload -> 'foundry_categories', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p_payload -> 'scrap_types', '[]'))), coalesce(private.ap9_int(p_payload, 'sort_order', 'Order', 0, 1000), 100), c.actor_id)
        returning * into g;
    end if;
    return to_jsonb(g) - 'company_id' - 'created_by';
  elsif p_command = 'offers' then
    perform private.ap_keys(p_payload, array['grade_id', 'status', 'page']);
    with f as (select o2.*, row_number() over (order by (o2.status = 'open') desc, o2.rate_per_kg desc, o2.recorded_at desc) k from public.scrap_offers o2
      where o2.company_id = c.company_id and (nullif(p_payload ->> 'grade_id', '') is null or o2.grade_id = (p_payload ->> 'grade_id')::uuid)
        and (coalesce(p_payload ->> 'status', 'open') = 'all' or o2.status = coalesce(p_payload ->> 'status', 'open')))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'grade_id', f.grade_id, 'grade', (select code from public.scrap_grades where id = f.grade_id),
        'buyer_id', f.buyer_id, 'buyer', (select coalesce(nullif(btrim(company_name), ''), customer_name) from public.customers where id = f.buyer_id),
        'rate_per_kg', f.rate_per_kg, 'quantity_kg', f.quantity_kg, 'valid_until', f.valid_until, 'expired', f.valid_until < private.ist_today(), 'status', f.status, 'note', f.note,
        'best', f.status = 'open' and f.valid_until >= private.ist_today() and f.rate_per_kg = (select max(x.rate_per_kg) from public.scrap_offers x where x.company_id = c.company_id
          and x.grade_id = f.grade_id and x.status = 'open' and x.valid_until >= private.ist_today())) order by f.k)
      from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'), (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'offer' then
    perform private.ap4_need(c.role, v_manage);
    perform private.ap_keys(p_payload, array['grade_id', 'buyer_id', 'rate_per_kg', 'quantity_kg', 'valid_until', 'note']);
    select * into g from public.scrap_grades where id = private.ap_uuid(p_payload, 'grade_id') and company_id = c.company_id and is_active;
    if g.id is null then raise exception 'AP: Grade not found.'; end if;
    if not exists (select 1 from public.customers where id = private.ap_uuid(p_payload, 'buyer_id') and company_id = c.company_id and is_active and deleted_at is null) then raise exception 'AP: Buyer not found. Add the buyer as a customer first.'; end if;
    if (p_payload ->> 'valid_until')::date < private.ist_today() then raise exception 'AP: The offer is already past its validity date.'; end if;
    insert into public.scrap_offers(company_id, grade_id, buyer_id, rate_per_kg, quantity_kg, valid_until, note, recorded_by)
      values (c.company_id, g.id, private.ap_uuid(p_payload, 'buyer_id'), private.ap4_num(p_payload, 'rate_per_kg', 'Rate per kg', 0.01, 10000),
        private.ap4_num(p_payload, 'quantity_kg', 'Quantity', 0.001, 10000000), (p_payload ->> 'valid_until')::date, private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id)
      returning * into o;
    return to_jsonb(o) - 'company_id';
  elsif p_command = 'withdraw_offer' then
    perform private.ap4_need(c.role, v_manage);
    perform private.ap_keys(p_payload, array['id']);
    update public.scrap_offers set status = 'withdrawn', decided_by = c.actor_id, decided_at = clock_timestamp()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'open' returning * into o;
    if o.id is null then raise exception 'AP: Open offer not found.'; end if;
    return jsonb_build_object('id', o.id, 'status', o.status);
  elsif p_command = 'accept_offer' then
    perform private.ap4_need(c.role, v_manage);
    perform private.ap_keys(p_payload, array['offer_id', 'reason']);
    select * into o from public.scrap_offers where id = private.ap_uuid(p_payload, 'offer_id') and company_id = c.company_id for update;
    if o.id is null or o.status <> 'open' then raise exception 'AP: This offer is no longer open.'; end if;
    if o.valid_until < private.ist_today() then raise exception 'AP: This offer expired on %. Record a fresh offer.', to_char(o.valid_until, 'DD Mon YYYY'); end if;
    select max(rate_per_kg) into v_best from public.scrap_offers where company_id = c.company_id and grade_id = o.grade_id and status = 'open' and valid_until >= private.ist_today();
    if o.rate_per_kg < v_best and private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300, false) is null then
      raise exception 'AP: A better offer of ₹%/kg is open for this grade. Give the reason for accepting ₹%/kg.', trim_scale(v_best), trim_scale(o.rate_per_kg);
    end if;
    update public.scrap_offers set status = 'accepted', decided_by = c.actor_id, decided_at = clock_timestamp() where id = o.id;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap9-scrap-sale-number', 0));
    select coalesce(max(substring(sale_number from 4)::integer), 0) + 1 into v_seq from public.scrap_sales where company_id = c.company_id and sale_number ~ '^SS-[0-9]+$';
    insert into public.scrap_sales(company_id, sale_number, grade_id, buyer_id, offer_id, rate_per_kg, ordered_kg, not_best_reason, created_by)
      values (c.company_id, 'SS-' || lpad(v_seq::text, 5, '0'), o.grade_id, o.buyer_id, o.id, o.rate_per_kg, o.quantity_kg,
        case when o.rate_per_kg < v_best then private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300) end, c.actor_id)
      returning * into s;
    return private.ap9_sale_json(s);
  elsif p_command = 'sales' then
    perform private.ap_keys(p_payload, array['page', 'status', 'search']);
    v_status := coalesce(p_payload ->> 'status', 'all');
    with f as (select x.*, row_number() over (order by x.created_at desc, x.id) k from public.scrap_sales x
      left join public.customers cu on cu.id = x.buyer_id
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status)
        and (v_search = '' or lower(x.sale_number || ' ' || coalesce(x.invoice_number, '') || ' ' || coalesce(cu.company_name, '') || ' ' || cu.customer_name) like '%' || v_search || '%'))
    select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'sale_number', f.sale_number, 'status', f.status, 'grade', (select code from public.scrap_grades where id = f.grade_id),
        'buyer', (select coalesce(nullif(btrim(company_name), ''), customer_name) from public.customers where id = f.buyer_id), 'rate_per_kg', f.rate_per_kg, 'ordered_kg', f.ordered_kg,
        'net_kg', f.net_kg, 'invoice_number', f.invoice_number, 'invoice_total', f.invoice_total, 'amount_received', f.amount_received, 'created_at', f.created_at) order by f.k)
      from f where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'), (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'sale' then
    perform private.ap_keys(p_payload, array['id']);
    select * into s from public.scrap_sales where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if s.id is null then raise exception 'AP: Scrap sale not found.'; end if;
    return private.ap9_sale_json(s);
  elsif p_command = 'weigh' then
    perform private.ap4_need(c.role, v_manage);
    perform private.ap_keys(p_payload, array['id', 'gross_kg', 'tare_kg', 'weighbridge_ref', 'vehicle_registration']);
    select * into s from public.scrap_sales where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null then raise exception 'AP: Scrap sale not found.'; end if;
    if s.status <> 'ordered' then raise exception 'AP: This sale is already %.', s.status; end if;
    v_kg := round(private.ap4_num(p_payload, 'gross_kg', 'Gross weight', 0.001, 100000) - private.ap4_num(p_payload, 'tare_kg', 'Tare weight', 0, 100000), 3);
    if v_kg <= 0 then raise exception 'AP: Gross weight must be more than tare weight.'; end if;
    -- Concurrent weighings of one grade queue here; the stock is rechecked after the lock.
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap9-scrap-grade:' || s.grade_id, 0));
    select * into st from private.ap9_scrap_stock(c.company_id) x where x.grade_id = s.grade_id;
    if v_kg > coalesce(st.on_hand_kg, 0) + 0.0005 then
      raise exception 'AP: Only % kg of % is on hand; the weighbridge shows % kg. Check the grade or the weighment.', trim_scale(round(coalesce(st.on_hand_kg, 0), 3)), st.code, trim_scale(v_kg);
    end if;
    v_left := v_kg;
    -- The yard first (scrap that never went to the foundry), then the oldest foundry lots of this grade.
    v_take := least(v_left, coalesce(st.yard_available_kg, 0));
    if v_take > 0 then
      insert into public.scrap_sale_allocations(company_id, sale_id, grade_id, kg) values (c.company_id, s.id, s.grade_id, v_take);
      v_left := v_left - v_take;
    end if;
    for lot in select f.id, coalesce(f.available_weight_kg, f.weight_kg) avail from public.foundry_aluminium_scrap f
      where f.company_id = c.company_id and f.scrap_source = 'in_house' and f.source_scrap_record_id is not null and f.status in ('available', 'reserved')
        and coalesce(f.available_weight_kg, f.weight_kg) > 0 and private.ap9_scrap_grade(c.company_id, f.scrap_category, null) = s.grade_id
      order by f.received_date, f.created_at, f.id for update loop
      exit when v_left <= 0;
      v_take := least(v_left, lot.avail);
      -- The allocation row moves the lot's available weight (private.ap9_sale_allocation_lot), as the furnace charge writer does.
      insert into public.scrap_sale_allocations(company_id, sale_id, grade_id, foundry_scrap_id, kg) values (c.company_id, s.id, s.grade_id, lot.id, v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0.0005 then raise exception 'AP: The stock of this grade changed while weighing. Retry.'; end if;
    update public.scrap_sales set status = 'weighed', gross_kg = private.ap4_num(p_payload, 'gross_kg', 'Gross weight', 0.001, 100000), tare_kg = private.ap4_num(p_payload, 'tare_kg', 'Tare weight', 0, 100000),
      net_kg = v_kg, weighbridge_ref = private.ap_text(p_payload ->> 'weighbridge_ref', 'Weighbridge slip', 1, 80),
      vehicle_registration = nullif(regexp_replace(upper(coalesce(p_payload ->> 'vehicle_registration', '')), '[^A-Z0-9]', '', 'g'), ''),
      weighed_by = c.actor_id, weighed_at = clock_timestamp() where id = s.id returning * into s;
    return private.ap9_sale_json(s);
  elsif p_command = 'invoice' then
    perform private.ap4_need(c.role, v_money);
    perform private.ap_keys(p_payload, array['id']);
    select * into s from public.scrap_sales where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null then raise exception 'AP: Scrap sale not found.'; end if;
    if s.status <> 'weighed' then raise exception 'AP: Record the weighbridge weight before invoicing.'; end if;
    select * into g from public.scrap_grades where id = s.grade_id;
    v_supply := private.ap3_derive_supply(c.company_id, s.buyer_id);
    if v_supply ->> 'tax_type' is null then raise exception 'AP: Record the buyer''s GSTIN or state, and the company''s GSTIN, before invoicing.'; end if;
    v_taxable := round(s.net_kg * s.rate_per_kg, 2);
    v_tax := round(v_taxable * g.gst_percent / 100, 2);
    v_fy := private.ap_fy_label(private.ist_today(), false);
    insert into public.scrap_invoice_counters(company_id, fy_label, last_value) values (c.company_id, v_fy, 0) on conflict do nothing;
    update public.scrap_invoice_counters set last_value = last_value + 1 where company_id = c.company_id and fy_label = v_fy returning last_value into v_seq;
    update public.scrap_sales set status = 'invoiced', invoice_number = 'SCR/' || v_fy || '/' || lpad(v_seq::text, 4, '0'), invoice_date = private.ist_today(),
      hsn_code = g.hsn_code, gst_percent = g.gst_percent, taxable_value = v_taxable,
      cgst_amount = case when v_supply ->> 'tax_type' = 'cgst_sgst' then round(v_tax / 2, 2) else 0 end,
      sgst_amount = case when v_supply ->> 'tax_type' = 'cgst_sgst' then v_tax - round(v_tax / 2, 2) else 0 end,
      igst_amount = case when v_supply ->> 'tax_type' = 'igst' then v_tax else 0 end, invoice_total = v_taxable + v_tax,
      place_of_supply = v_supply ->> 'state', supply_basis = v_supply ->> 'basis', invoiced_by = c.actor_id, invoiced_at = clock_timestamp()
      where id = s.id returning * into s;
    return private.ap9_sale_json(s);
  elsif p_command = 'receipt' then
    perform private.ap4_need(c.role, v_money);
    perform private.ap_keys(p_payload, array['id', 'amount', 'received_on', 'method', 'reference']);
    select * into s from public.scrap_sales where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null or s.status not in ('invoiced') then raise exception 'AP: Receipts are recorded against an invoiced scrap sale.'; end if;
    v_amount := private.ap4_num(p_payload, 'amount', 'Amount', 0.01, 100000000);
    if s.amount_received + v_amount > s.invoice_total + 0.005 then raise exception 'AP: The receipt is more than the ₹% still due.', trim_scale(s.invoice_total - s.amount_received); end if;
    if coalesce(p_payload ->> 'method', '') not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then raise exception 'AP: Choose how the money was received.'; end if;
    insert into public.scrap_sale_receipts(company_id, sale_id, amount, received_on, method, reference, recorded_by)
      values (c.company_id, s.id, v_amount, coalesce(nullif(p_payload ->> 'received_on', '')::date, private.ist_today()), p_payload ->> 'method',
        private.ap_text(p_payload ->> 'reference', 'Reference', 1, 80, false), c.actor_id);
    update public.scrap_sales set amount_received = amount_received + v_amount,
      status = case when amount_received + v_amount >= invoice_total - 0.005 then 'paid' else status end,
      paid_at = case when amount_received + v_amount >= invoice_total - 0.005 then clock_timestamp() end
      where id = s.id returning * into s;
    return private.ap9_sale_json(s);
  elsif p_command = 'cancel' then
    perform private.ap4_need(c.role, v_manage);
    perform private.ap_keys(p_payload, array['id', 'reason']);
    select * into s from public.scrap_sales where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if s.id is null then raise exception 'AP: Scrap sale not found.'; end if;
    if s.status not in ('ordered', 'weighed') then raise exception 'AP: An invoiced scrap sale cannot be cancelled here.'; end if;
    -- Releasing an allocation gives its kilograms back to the foundry lot (private.ap9_sale_allocation_lot).
    update public.scrap_sale_allocations set released_at = clock_timestamp() where sale_id = s.id and released_at is null;
    update public.scrap_sales set status = 'cancelled', cancelled_by = c.actor_id, cancelled_at = clock_timestamp(), cancel_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300)
      where id = s.id returning * into s;
    return private.ap9_sale_json(s);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_scrap_sale(text, jsonb) from public, anon;
grant execute on function public.ap_scrap_sale(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-075: weight-difference notes from the customer's receipt weight
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.customer_weight_tolerances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id),
  tolerance_percent numeric(6,3) check (tolerance_percent is null or tolerance_percent between 0 and 10),
  tolerance_kg numeric(10,3) check (tolerance_kg is null or tolerance_kg between 0 and 10000),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  set_by uuid not null references public.app_users(id),
  set_at timestamptz not null default clock_timestamp(),
  check (tolerance_percent is not null or tolerance_kg is not null)
);
create unique index if not exists customer_weight_tolerances_key on public.customer_weight_tolerances(company_id, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.weight_difference_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  customer_id uuid not null references public.customers(id),
  dispatch_id uuid references public.dispatches(id),
  invoiced_kg numeric(14,3) not null check (invoiced_kg > 0),
  reported_kg numeric(14,3) not null check (reported_kg > 0),
  difference_kg numeric(14,3) not null,
  allowed_kg numeric(14,3) not null check (allowed_kg >= 0),
  tolerance_percent numeric(6,3),
  tolerance_kg numeric(10,3),
  tolerance_source text not null check (tolerance_source in ('customer', 'company')),
  outcome text not null check (outcome in ('within_tolerance', 'credit', 'debit')),
  rate_per_kg numeric(14,4),
  gst_rate numeric(6,3),
  taxable_value numeric(14,2),
  tax_amount numeric(14,2),
  total_amount numeric(14,2),
  status text not null check (status in ('recorded', 'draft', 'approved', 'rejected')),
  customer_reference text not null check (length(btrim(customer_reference)) between 2 and 80),
  note text check (note is null or length(btrim(note)) between 3 and 300),
  reported_by uuid not null references public.app_users(id),
  reported_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 3 and 300),
  credit_note_id uuid unique references public.credit_notes(id),
  debit_note_number text,
  check ((outcome = 'within_tolerance') = (status = 'recorded')),
  check ((status in ('approved', 'rejected')) = (decided_at is not null)),
  check (status <> 'approved' or (outcome = 'credit') = (credit_note_id is not null)),
  check (status <> 'approved' or (outcome = 'debit') = (debit_note_number is not null))
);
create unique index if not exists weight_difference_notes_open on public.weight_difference_notes(company_id, invoice_id) where status = 'draft';
create unique index if not exists weight_difference_debit_key on public.weight_difference_notes(company_id, debit_note_number) where debit_note_number is not null;
create index if not exists weight_difference_notes_company_idx on public.weight_difference_notes(company_id, status, reported_at desc);
create index if not exists weight_difference_notes_invoice_idx on public.weight_difference_notes(invoice_id);

create table if not exists public.weight_debit_note_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  fy_label text not null,
  last_value integer not null default 0,
  primary key (company_id, fy_label)
);

-- Goods weight, average rate per kg and GST rate of an invoice (goods lines only; die and freight charges excluded).
create or replace function private.ap9_invoice_weight(p_company uuid, p_invoice uuid)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('kg', round(sum(coalesce(i.quantity_kg, case when i.invoice_calc_uom = 'kg' then i.quantity end)), 3),
    'value', round(sum(i.line_total), 2),
    'rate', case when sum(coalesce(i.quantity_kg, case when i.invoice_calc_uom = 'kg' then i.quantity end)) > 0
      then round(sum(i.line_total) / sum(coalesce(i.quantity_kg, case when i.invoice_calc_uom = 'kg' then i.quantity end)), 4) end,
    'gst_rate', case when sum(i.line_total) > 0 then round(sum(i.line_total * coalesce(i.gst_percent, 0)) / sum(i.line_total), 3) end)
  from public.invoice_items i where i.company_id = p_company and i.invoice_id = p_invoice and coalesce(i.line_kind, 'goods') = 'goods'
$$;
revoke all on function private.ap9_invoice_weight(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap9_note_json(n public.weight_difference_notes)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(n) - 'company_id' || jsonb_build_object(
    'invoice_number', (select invoice_number from public.invoices where id = n.invoice_id),
    'customer', (select coalesce(nullif(btrim(company_name), ''), customer_name) from public.customers where id = n.customer_id),
    'reported_by_name', (select full_name from public.app_users where id = n.reported_by),
    'decided_by_name', (select full_name from public.app_users where id = n.decided_by),
    'credit_note_number', (select credit_note_number from public.credit_notes where id = n.credit_note_id))
$$;
revoke all on function private.ap9_note_json(public.weight_difference_notes) from public, anon, authenticated;

create or replace function public.ap_weight_note(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; inv public.invoices%rowtype; t public.customer_weight_tolerances%rowtype; n public.weight_difference_notes%rowtype; w jsonb; v_reported numeric;
  v_allowed numeric; v_diff numeric; v_outcome text; v_taxable numeric; v_tax numeric; v_cn uuid; v_fy text; v_seq integer; v_rows jsonb; v_total bigint;
  v_page integer := private.ap3_page(p_payload); v_status text; v_customer uuid;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts', 'sales_manager', 'sales', 'dispatch_manager']);
  if p_command = 'tolerances' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'customer_id', x.customer_id,
        'customer', (select coalesce(nullif(btrim(company_name), ''), customer_name) from public.customers where id = x.customer_id),
        'tolerance_percent', x.tolerance_percent, 'tolerance_kg', x.tolerance_kg, 'reason', x.reason, 'set_at', x.set_at) order by x.customer_id nulls first), '[]')
      from public.customer_weight_tolerances x where x.company_id = c.company_id));
  elsif p_command = 'save_tolerance' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'accounts', 'sales_manager']);
    perform private.ap_keys(p_payload, array['customer_id', 'tolerance_percent', 'tolerance_kg', 'reason']);
    v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    if private.ap4_num(p_payload, 'tolerance_percent', 'Tolerance %', 0, 10, false) is null and private.ap4_num(p_payload, 'tolerance_kg', 'Tolerance kg', 0, 10000, false) is null then
      raise exception 'AP: Give the tolerance in percent, in kg, or both.';
    end if;
    delete from public.customer_weight_tolerances where company_id = c.company_id and customer_id is not distinct from v_customer;
    insert into public.customer_weight_tolerances(company_id, customer_id, tolerance_percent, tolerance_kg, reason, set_by)
      values (c.company_id, v_customer, private.ap4_num(p_payload, 'tolerance_percent', 'Tolerance %', 0, 10, false), private.ap4_num(p_payload, 'tolerance_kg', 'Tolerance kg', 0, 10000, false),
        private.ap_text(p_payload ->> 'reason', 'Reason', 5, 300), c.actor_id) returning * into t;
    return to_jsonb(t) - 'company_id';
  elsif p_command = 'invoice' then
    perform private.ap_keys(p_payload, array['invoice_id']);
    select * into inv from public.invoices where id = private.ap_uuid(p_payload, 'invoice_id') and company_id = c.company_id and deleted_at is null;
    if inv.id is null then raise exception 'AP: Invoice not found.'; end if;
    w := private.ap9_invoice_weight(c.company_id, inv.id);
    select * into t from public.customer_weight_tolerances where company_id = c.company_id and customer_id = inv.customer_id;
    if t.id is null then select * into t from public.customer_weight_tolerances where company_id = c.company_id and customer_id is null; end if;
    return jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'status', inv.status, 'invoiced_kg', w -> 'kg',
      'tolerance', case when t.id is null then null else jsonb_build_object('percent', t.tolerance_percent, 'kg', t.tolerance_kg, 'source', case when t.customer_id is null then 'company' else 'customer' end) end,
      'notes', (select coalesce(jsonb_agg(private.ap9_note_json(x) order by x.reported_at desc), '[]') from public.weight_difference_notes x where x.company_id = c.company_id and x.invoice_id = inv.id));
  elsif p_command = 'report' then
    perform private.ap_keys(p_payload, array['invoice_id', 'reported_kg', 'customer_reference', 'note']);
    select * into inv from public.invoices where id = private.ap_uuid(p_payload, 'invoice_id') and company_id = c.company_id and deleted_at is null for update;
    if inv.id is null then raise exception 'AP: Invoice not found.'; end if;
    if inv.status not in ('generated', 'sent', 'partially_paid', 'paid', 'overdue') or inv.invoice_number is null then raise exception 'AP: Weight differences are recorded against an issued invoice.'; end if;
    if exists (select 1 from public.weight_difference_notes where company_id = c.company_id and invoice_id = inv.id and status = 'draft') then
      raise exception 'AP: A weight-difference note for this invoice is waiting for accounts. Approve or reject it first.';
    end if;
    w := private.ap9_invoice_weight(c.company_id, inv.id);
    if coalesce((w ->> 'kg')::numeric, 0) <= 0 or (w ->> 'rate') is null then raise exception 'AP: This invoice has no goods weight in kg to compare.'; end if;
    v_reported := private.ap4_num(p_payload, 'reported_kg', 'Customer''s weight', 0.001, 10000000);
    select * into t from public.customer_weight_tolerances where company_id = c.company_id and customer_id = inv.customer_id;
    if t.id is null then select * into t from public.customer_weight_tolerances where company_id = c.company_id and customer_id is null; end if;
    if t.id is null then raise exception 'AP: Set the agreed weight tolerance for this customer (or the company default) before recording a weight difference.'; end if;
    v_diff := round(v_reported - (w ->> 'kg')::numeric, 3);
    v_allowed := round(greatest(coalesce(t.tolerance_kg, 0), (w ->> 'kg')::numeric * coalesce(t.tolerance_percent, 0) / 100), 3);
    v_outcome := case when abs(v_diff) <= v_allowed then 'within_tolerance' when v_diff < 0 then 'credit' else 'debit' end;
    if v_outcome <> 'within_tolerance' then
      v_taxable := round(abs(v_diff) * (w ->> 'rate')::numeric, 2);
      v_tax := round(v_taxable * coalesce((w ->> 'gst_rate')::numeric, 0) / 100, 2);
    end if;
    insert into public.weight_difference_notes(company_id, invoice_id, customer_id, dispatch_id, invoiced_kg, reported_kg, difference_kg, allowed_kg, tolerance_percent, tolerance_kg,
      tolerance_source, outcome, rate_per_kg, gst_rate, taxable_value, tax_amount, total_amount, status, customer_reference, note, reported_by)
      values (c.company_id, inv.id, inv.customer_id, inv.dispatch_id, (w ->> 'kg')::numeric, v_reported, v_diff, v_allowed, t.tolerance_percent, t.tolerance_kg,
        case when t.customer_id is null then 'company' else 'customer' end, v_outcome, case when v_outcome <> 'within_tolerance' then (w ->> 'rate')::numeric end,
        case when v_outcome <> 'within_tolerance' then (w ->> 'gst_rate')::numeric end, v_taxable, v_tax, v_taxable + v_tax,
        case when v_outcome = 'within_tolerance' then 'recorded' else 'draft' end, private.ap_text(p_payload ->> 'customer_reference', 'Customer''s weighbridge reference', 2, 80),
        private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false), c.actor_id)
      returning * into n;
    if n.status = 'draft' then
      perform private.ap3_notify_roles(c.company_id, array['owner', 'admin', 'accounts'], 'weight_difference', 'warning',
        'Weight difference on ' || inv.invoice_number || ': ' || case when v_outcome = 'credit' then 'credit' else 'debit' end || ' note to approve',
        'The customer reports ' || trim_scale(v_reported) || ' kg against ' || trim_scale((w ->> 'kg')::numeric) || ' kg invoiced (' || trim_scale(v_diff) || ' kg; agreed tolerance ' || trim_scale(v_allowed) || ' kg).',
        'invoice', inv.id, '/invoices/' || inv.id || '#weight-difference', 'weight-note:' || n.id, c.actor_id);
    end if;
    return private.ap9_note_json(n);
  elsif p_command in ('approve', 'reject') then
    perform private.ap4_need(c.role, array['owner', 'admin', 'accounts']);
    perform private.ap_keys(p_payload, array['id', 'note']);
    select * into n from public.weight_difference_notes where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if n.id is null then raise exception 'AP: Weight-difference note not found.'; end if;
    if n.status <> 'draft' then raise exception 'AP: This note is already %.', n.status; end if;
    if n.reported_by = c.actor_id and c.role <> 'owner' then raise exception 'AP: Another person approves a weight-difference note you recorded.'; end if;
    if p_command = 'reject' then
      update public.weight_difference_notes set status = 'rejected', decided_by = c.actor_id, decided_at = clock_timestamp(), decision_note = private.ap_text(p_payload ->> 'note', 'Reason', 3, 300)
        where id = n.id returning * into n;
    else
      select * into inv from public.invoices where id = n.invoice_id and company_id = c.company_id for update;
      if inv.status in ('cancelled') then raise exception 'AP: The invoice was cancelled.'; end if;
      if n.outcome = 'credit' then
        if inv.dispatch_id is null then raise exception 'AP: This invoice has no dispatch; issue the credit note through the credit-note workflow.'; end if;
        if (select coalesce(sum(x.grand_total), 0) from public.credit_notes x where x.company_id = c.company_id and x.invoice_id = inv.id and x.status = 'issued') + n.total_amount > inv.grand_total + 0.05 then
          raise exception 'AP: Credit notes would exceed the invoice total.';
        end if;
        insert into public.credit_notes(company_id, invoice_id, dispatch_id, credit_note_number, credit_date, reason, subtotal, tax_total, grand_total, item_snapshot, idempotency_key, created_by)
          values (c.company_id, inv.id, inv.dispatch_id,
            private.next_business_number_locked('public.credit_notes'::regclass, 'credit_note_number', c.company_id, 'CN', private.ist_today()), private.ist_today(),
            'Weight difference: customer received ' || trim_scale(n.reported_kg) || ' kg against ' || trim_scale(n.invoiced_kg) || ' kg invoiced (ref ' || n.customer_reference || ')',
            n.taxable_value, n.tax_amount, n.total_amount,
            jsonb_build_array(jsonb_build_object('kind', 'weight_difference', 'kg', abs(n.difference_kg), 'rate_per_kg', n.rate_per_kg, 'gst_rate', n.gst_rate, 'note_id', n.id)),
            n.id, c.actor_id)
          returning id into v_cn;
        update public.invoices set credited_amount = (select coalesce(sum(x.grand_total), 0) from public.credit_notes x where x.company_id = c.company_id and x.invoice_id = inv.id and x.status = 'issued'),
          updated_at = now() where id = inv.id;
        perform private.recalculate_invoice_collection_state(inv.id, c.company_id);
        insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
          values (c.company_id, c.actor_id, 'weight_difference_credit_note_issued', 'credit_note', v_cn, jsonb_build_object('invoice_id', inv.id, 'note_id', n.id, 'amount', n.total_amount));
        update public.weight_difference_notes set status = 'approved', decided_by = c.actor_id, decided_at = clock_timestamp(), credit_note_id = v_cn,
          decision_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false) where id = n.id returning * into n;
      else
        v_fy := private.ap_fy_label(private.ist_today(), false);
        insert into public.weight_debit_note_counters(company_id, fy_label) values (c.company_id, v_fy) on conflict do nothing;
        update public.weight_debit_note_counters set last_value = last_value + 1 where company_id = c.company_id and fy_label = v_fy returning last_value into v_seq;
        update public.weight_difference_notes set status = 'approved', decided_by = c.actor_id, decided_at = clock_timestamp(),
          debit_note_number = 'DN/' || v_fy || '/' || lpad(v_seq::text, 4, '0'), decision_note = private.ap_text(p_payload ->> 'note', 'Note', 3, 300, false)
          where id = n.id returning * into n;
      end if;
    end if;
    update public.notifications set resolved_at = clock_timestamp(), resolution = 'Resolved: the weight-difference note was ' || n.status, is_read = true, read_at = coalesce(read_at, now())
      where company_id = c.company_id and condition_key = 'weight-note:' || n.id and resolved_at is null;
    return private.ap9_note_json(n);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    v_status := coalesce(p_payload ->> 'status', 'draft');
    with f as (select x.id, row_number() over (order by x.reported_at desc, x.id) k from public.weight_difference_notes x
      where x.company_id = c.company_id and (v_status = 'all' or x.status = v_status))
    select coalesce((select jsonb_agg(private.ap9_note_json(n2) order by f.k) from f join public.weight_difference_notes n2 on n2.id = f.id
        where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'),
      (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_weight_note(text, jsonb) from public, anon;
grant execute on function public.ap_weight_note(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-076: four-week cash forecast (owner and accounts only)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.cash_forecast_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  opening_balance numeric(16,2),
  balance_as_of date,
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check ((opening_balance is null) = (balance_as_of is null))
);

create table if not exists public.cash_fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null check (length(btrim(label)) between 3 and 80 and label !~ '[[:cntrl:]]'),
  amount numeric(14,2) not null check (amount > 0),
  frequency text not null check (frequency in ('monthly', 'weekly')),
  day_of_month integer check (day_of_month between 1 and 28),
  weekday integer check (weekday between 1 and 7),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check ((frequency = 'monthly') = (day_of_month is not null)),
  check ((frequency = 'weekly') = (weekday is not null))
);
create index if not exists cash_fixed_expenses_company_idx on public.cash_fixed_expenses(company_id, status);

create table if not exists public.cash_one_offs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  on_date date not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  label text not null check (length(btrim(label)) between 3 and 120 and label !~ '[[:cntrl:]]'),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists cash_one_offs_company_idx on public.cash_one_offs(company_id, status, on_date);

create table if not exists public.cash_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week_start date not null,
  expected_in numeric(16,2) not null,
  expected_out numeric(16,2) not null,
  detail jsonb not null,
  captured_at timestamptz not null default clock_timestamp(),
  unique (company_id, week_start)
);

-- Each customer's usual delay: average days paid after the due date over the last year (at least two paid invoices,
-- never negative, at most 120). With less history the due date is used.
create or replace function private.ap9_customer_delay(p_company uuid, p_customer uuid)
returns integer language sql stable security definer set search_path = public, private as $$
  select case when count(*) >= 2 then least(120, greatest(0, round(avg(i.paid_date - coalesce(i.due_date, i.invoice_date + 30)))))::integer else 0 end
  from public.invoices i where i.company_id = p_company and i.customer_id = p_customer and i.paid_date is not null and i.deleted_at is null
    and i.paid_date >= private.ist_today() - 365
$$;
revoke all on function private.ap9_customer_delay(uuid, uuid) from public, anon, authenticated;

-- Days of credit from a vendor's payment terms text ("30 days", "Net 45"); 30 when not stated.
create or replace function private.ap9_terms_days(p text)
returns integer language sql immutable set search_path = public, private as $$
  -- least() ignores nulls, so the default is applied before the cap.
  select least(180, coalesce(nullif(substring(coalesce(p, '') from '([0-9]{1,3})'), '')::integer, 30))
$$;
revoke all on function private.ap9_terms_days(text) from public, anon, authenticated;

-- Every expected movement from p_from for p_weeks weeks. Anything already due before p_from falls in the first week.
create or replace function private.ap9_cash_items(p_company uuid, p_from date, p_weeks integer)
returns table(kind text, direction text, expected_on date, amount numeric, label text, basis text, ref_id uuid)
language sql stable security definer set search_path = public, private as $$
  with horizon as (select p_from + p_weeks * 7 - 1 last_day),
  recv as (
    select 'receivable'::text kind, 'in'::text direction,
      coalesce(i.due_date, i.invoice_date + 30) + private.ap9_customer_delay(p_company, i.customer_id) expected_on,
      round(coalesce(i.balance_due, i.grand_total - i.amount_paid - coalesce(i.credited_amount, 0)), 2) amount,
      coalesce(i.invoice_number, 'Invoice') || ' · ' || coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name) label,
      case when private.ap9_customer_delay(p_company, i.customer_id) > 0 then 'Due date + ' || private.ap9_customer_delay(p_company, i.customer_id) || ' days (this customer''s usual delay)'
        else 'Due date' end basis, i.id ref_id
    from public.invoices i join public.customers cu on cu.id = i.customer_id
    where i.company_id = p_company and i.deleted_at is null and i.status in ('generated', 'sent', 'partially_paid', 'overdue')
      and coalesce(i.balance_due, i.grand_total - i.amount_paid - coalesce(i.credited_amount, 0)) > 0.005
  ), scrap as (
    select 'scrap_sale', 'in', s.invoice_date + 7, round(s.invoice_total - s.amount_received, 2), s.invoice_number || ' · scrap sale', 'Scrap invoice date + 7 days', s.id
    from public.scrap_sales s where s.company_id = p_company and s.status = 'invoiced' and s.invoice_total - s.amount_received > 0.005
  ), pay as (
    select 'payable', 'out', coalesce(e.due_date, e.invoice_date + 30, e.created_at::date + 30), round(e.balance_amount, 2),
      coalesce(e.vendor_name_snapshot, e.expense_category) || coalesce(' · ' || e.invoice_number, ''), case when e.due_date is null then 'Bill date + 30 days' else 'Due date' end, e.id
    from public.expense_ledger e where e.company_id = p_company and e.deleted_at is null and e.balance_amount > 0.005
      and e.approval_status = 'approved' and e.payment_status not in ('paid', 'cancelled', 'reversed')
  ), po as (
    select 'purchase_order', 'out', greatest(p_from, p.order_date + 15 + private.ap9_terms_days(v.payment_terms)),
      round(greatest(sum(l.ordered_quantity * l.unit_rate * (1 + coalesce(l.gst_percent, 0) / 100))
        - coalesce((select sum(b.total_amount) from public.supplier_purchase_bills b where b.company_id = p_company and b.purchase_order_id = p.id and b.status = 'posted'), 0), 0), 2),
      p.po_number || ' · ' || p.vendor_name_snapshot, 'Order date + 15 days delivery + ' || private.ap9_terms_days(v.payment_terms) || ' days credit (not yet billed)', p.id
    from public.purchase_orders p join public.purchase_order_lines l on l.purchase_order_id = p.id and l.company_id = p_company
      left join public.vendors v on v.id = p.vendor_id
    where p.company_id = p_company and p.status = 'open'
    group by p.id, p.order_date, p.po_number, p.vendor_name_snapshot, v.payment_terms
  ), fixed as (
    select 'fixed', 'out', d::date, f.amount, f.label, case when f.frequency = 'monthly' then 'Every month on day ' || f.day_of_month else 'Every week' end, f.id
    from public.cash_fixed_expenses f cross join generate_series(p_from, (select last_day from horizon), interval '1 day') d
    where f.company_id = p_company and f.status = 'active'
      and ((f.frequency = 'monthly' and extract(day from d)::integer = f.day_of_month) or (f.frequency = 'weekly' and extract(isodow from d)::integer = f.weekday))
  ), once as (
    select 'one_off', o.direction, o.on_date, o.amount, o.label, 'Entered by accounts', o.id
    from public.cash_one_offs o where o.company_id = p_company and o.status = 'active' and o.on_date <= (select last_day from horizon)
      and o.on_date >= p_from - 30
  )
  select x.kind, x.direction, greatest(x.expected_on, p_from), x.amount, x.label, x.basis, x.ref_id
  from (select * from recv union all select * from scrap union all select * from pay union all select * from po union all select * from fixed union all select * from once) x
  where x.amount > 0 and x.expected_on <= (select last_day from horizon)
$$;
revoke all on function private.ap9_cash_items(uuid, date, integer) from public, anon, authenticated;

create or replace function private.ap9_cash_forecast(p_company uuid, p_weeks integer)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_from date := private.ap8_week(private.ist_today()); s public.cash_forecast_settings%rowtype; v_weeks jsonb; v_running numeric;
begin
  select * into s from public.cash_forecast_settings where company_id = p_company;
  with items as (select * from private.ap9_cash_items(p_company, v_from, p_weeks)),
  wk as (select (v_from + n * 7) week_start from generate_series(0, p_weeks - 1) n),
  agg as (
    select w.week_start,
      coalesce(sum(i.amount) filter (where i.direction = 'in'), 0) cash_in,
      coalesce(sum(i.amount) filter (where i.direction = 'out'), 0) cash_out,
      coalesce(sum(i.amount) filter (where i.kind = 'receivable' or i.kind = 'scrap_sale'), 0) receipts,
      coalesce(sum(i.amount) filter (where i.kind = 'payable'), 0) payables,
      coalesce(sum(i.amount) filter (where i.kind = 'purchase_order'), 0) purchase_orders,
      coalesce(sum(i.amount) filter (where i.kind = 'fixed'), 0) fixed,
      coalesce(sum(i.amount) filter (where i.kind = 'one_off' and i.direction = 'in'), 0) one_off_in,
      coalesce(sum(i.amount) filter (where i.kind = 'one_off' and i.direction = 'out'), 0) one_off_out,
      coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'direction', i.direction, 'expected_on', i.expected_on, 'amount', i.amount, 'label', i.label, 'basis', i.basis, 'ref_id', i.ref_id)
        order by i.amount desc) filter (where i.kind is not null), '[]') items
    from wk w left join items i on i.expected_on between w.week_start and w.week_start + 6
    group by w.week_start
  )
  select jsonb_agg(jsonb_build_object('week_start', a.week_start, 'week_end', a.week_start + 6, 'cash_in', round(a.cash_in, 2), 'cash_out', round(a.cash_out, 2),
    'net', round(a.cash_in - a.cash_out, 2), 'receipts', a.receipts, 'payables', a.payables, 'purchase_orders', a.purchase_orders, 'fixed', a.fixed,
    'one_off_in', a.one_off_in, 'one_off_out', a.one_off_out, 'items', a.items) order by a.week_start) into v_weeks from agg a;
  -- A running balance only when accounts entered an opening balance; otherwise it stays blank, never zero.
  if s.opening_balance is not null then
    v_running := s.opening_balance;
    select jsonb_agg(q.w || jsonb_build_object('closing', round(v_running + q.cum, 2)) order by q.ws) into v_weeks
      from (select w, w ->> 'week_start' ws, sum((w ->> 'net')::numeric) over (order by w ->> 'week_start') cum from jsonb_array_elements(v_weeks) w) q;
  end if;
  return jsonb_build_object('from', v_from, 'weeks', coalesce(v_weeks, '[]'), 'opening_balance', s.opening_balance, 'balance_as_of', s.balance_as_of,
    'basis', 'Receipts: open invoice balance on its due date plus the customer''s usual delay. Payables: approved unpaid bills on their due date. Purchase orders: unbilled value after delivery and credit. Fixed expenses and one-offs as entered.');
end;
$$;
revoke all on function private.ap9_cash_forecast(uuid, integer) from public, anon, authenticated;

-- Monday night: keep the forecast for the current week so it can be compared with what actually came in and went out.
create or replace function private.ap9_cash_snapshot_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v jsonb; w jsonb; v_n integer := 0;
begin
  -- The first run of each week (Monday night in practice) keeps that week's forecast; later runs leave it unchanged.
  v :=private.ap9_cash_forecast(p_company, 1);
  w := v -> 'weeks' -> 0;
  if w is not null then
    insert into public.cash_forecast_snapshots(company_id, week_start, expected_in, expected_out, detail)
      values (p_company, (w ->> 'week_start')::date, (w ->> 'cash_in')::numeric, (w ->> 'cash_out')::numeric, w - 'items' || jsonb_build_object('item_count', jsonb_array_length(w -> 'items')))
      on conflict (company_id, week_start) do nothing;
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('examined', 1, 'proposals', 0, 'alerts', 0, 'snapshots', v_n);
end;
$$;
revoke all on function private.ap9_cash_snapshot_job(uuid, uuid) from public, anon, authenticated;

create or replace function public.ap_cash_forecast(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; v_weeks integer; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); f public.cash_fixed_expenses%rowtype; o public.cash_one_offs%rowtype;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'accounts']);
  if p_command = 'forecast' then
    perform private.ap_keys(p_payload, array['weeks']);
    v_weeks := coalesce(private.ap9_int(p_payload, 'weeks', 'Weeks', 1, 8), 4);
    return private.ap9_cash_forecast(c.company_id, v_weeks);
  elsif p_command = 'save_opening' then
    perform private.ap_keys(p_payload, array['opening_balance', 'balance_as_of']);
    insert into public.cash_forecast_settings(company_id, opening_balance, balance_as_of, updated_by)
      values (c.company_id, private.ap4_num(p_payload, 'opening_balance', 'Bank and cash balance', -1000000000, 1000000000, false),
        case when private.ap4_num(p_payload, 'opening_balance', 'Bank and cash balance', -1000000000, 1000000000, false) is null then null else coalesce(nullif(p_payload ->> 'balance_as_of', '')::date, private.ist_today()) end, c.actor_id)
      on conflict (company_id) do update set opening_balance = excluded.opening_balance, balance_as_of = excluded.balance_as_of, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    return jsonb_build_object('saved', true);
  elsif p_command = 'fixed' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(to_jsonb(x) - 'company_id' order by x.label), '[]') from public.cash_fixed_expenses x where x.company_id = c.company_id and x.status = 'active'),
      'one_offs', (select coalesce(jsonb_agg(to_jsonb(x) - 'company_id' order by x.on_date), '[]') from public.cash_one_offs x where x.company_id = c.company_id and x.status = 'active' and x.on_date >= private.ist_today() - 30));
  elsif p_command = 'save_fixed' then
    perform private.ap_keys(p_payload, array['label', 'amount', 'frequency', 'day_of_month', 'weekday']);
    if coalesce(p_payload ->> 'frequency', '') not in ('monthly', 'weekly') then raise exception 'AP: Choose monthly or weekly.'; end if;
    insert into public.cash_fixed_expenses(company_id, label, amount, frequency, day_of_month, weekday, created_by)
      values (c.company_id, private.ap_text(p_payload ->> 'label', 'Expense', 3, 80), private.ap4_num(p_payload, 'amount', 'Amount', 0.01, 100000000), p_payload ->> 'frequency',
        case when p_payload ->> 'frequency' = 'monthly' then coalesce(private.ap9_int(p_payload, 'day_of_month', 'Day of the month', 1, 28), 1) end,
        case when p_payload ->> 'frequency' = 'weekly' then coalesce(private.ap9_int(p_payload, 'weekday', 'Weekday', 1, 7), 1) end, c.actor_id)
      returning * into f;
    return to_jsonb(f) - 'company_id';
  elsif p_command = 'retire_fixed' then
    perform private.ap_keys(p_payload, array['id']);
    update public.cash_fixed_expenses set status = 'retired', retired_at = clock_timestamp() where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into f;
    if f.id is null then raise exception 'AP: Expense not found.'; end if;
    return jsonb_build_object('id', f.id, 'status', f.status);
  elsif p_command = 'save_one_off' then
    perform private.ap_keys(p_payload, array['on_date', 'direction', 'amount', 'label']);
    if coalesce(p_payload ->> 'direction', '') not in ('in', 'out') then raise exception 'AP: Choose money in or money out.'; end if;
    insert into public.cash_one_offs(company_id, on_date, direction, amount, label, created_by)
      values (c.company_id, (p_payload ->> 'on_date')::date, p_payload ->> 'direction', private.ap4_num(p_payload, 'amount', 'Amount', 0.01, 1000000000), private.ap_text(p_payload ->> 'label', 'Description', 3, 120), c.actor_id)
      returning * into o;
    return to_jsonb(o) - 'company_id';
  elsif p_command = 'remove_one_off' then
    perform private.ap_keys(p_payload, array['id']);
    update public.cash_one_offs set status = 'removed' where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into o;
    if o.id is null then raise exception 'AP: Entry not found.'; end if;
    return jsonb_build_object('id', o.id, 'status', o.status);
  elsif p_command = 'accuracy' then
    perform private.ap_keys(p_payload, array['page']);
    with snap as (select s.*, row_number() over (order by s.week_start desc) k from public.cash_forecast_snapshots s where s.company_id = c.company_id and s.week_start + 6 < private.ist_today())
    select coalesce((select jsonb_agg(jsonb_build_object('week_start', snap.week_start, 'expected_in', snap.expected_in, 'expected_out', snap.expected_out,
        'actual_in', round(coalesce((select sum(p.amount) from public.payments p where p.company_id = c.company_id and p.reversed_at is null and p.payment_method <> 'credit_note'
          and p.payment_date between snap.week_start and snap.week_start + 6), 0)
          + coalesce((select sum(r.amount) from public.scrap_sale_receipts r where r.company_id = c.company_id and r.received_on between snap.week_start and snap.week_start + 6), 0), 2),
        'actual_out', round(coalesce((select sum(p.amount_paid) from public.expense_payments p where p.company_id = c.company_id and p.status = 'posted'
          and p.payment_date between snap.week_start and snap.week_start + 6), 0), 2)) order by snap.k)
      from snap where snap.k > (v_page - 1) * 10 and snap.k <= v_page * 10), '[]'), (select count(*) from snap) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'snapshot_now' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return private.ap9_cash_snapshot_job(c.company_id, null);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_cash_forecast(text, jsonb) from public, anon;
grant execute on function public.ap_cash_forecast(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-008: a pasted WhatsApp enquiry becomes a reviewable draft quotation
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.quote_enquiries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enquiry_number text not null,
  raw_text text not null check (length(raw_text) between 3 and 20000),
  source text not null check (source in ('paste', 'chat_export')),
  sender_phone text check (sender_phone is null or sender_phone ~ '^[0-9]{10,13}$'),
  sender_name text check (sender_name is null or length(btrim(sender_name)) between 1 and 80),
  customer_id uuid references public.customers(id),
  customer_basis text check (customer_basis in ('phone', 'name', 'chosen')),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  unknown_codes text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'quoted', 'discarded')),
  quote_id uuid references public.quotes(id),
  discarded_reason text check (discarded_reason is null or length(btrim(discarded_reason)) between 3 and 300),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'quoted') = (quote_id is not null)),
  unique (company_id, enquiry_number)
);
create index if not exists quote_enquiries_company_idx on public.quote_enquiries(company_id, status, created_at desc);
create index if not exists quote_enquiries_quote_idx on public.quote_enquiries(quote_id) where quote_id is not null;

-- Codes and aliases the sales team mapped once; the parser uses them next time (customer-specific first).
create table if not exists public.enquiry_code_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code_key text not null check (code_key ~ '^[A-Z0-9]{1,40}$'),
  customer_id uuid references public.customers(id),
  profile_id uuid not null references public.aluminium_profiles(id),
  use_count integer not null default 0,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz
);
create unique index if not exists enquiry_code_mappings_key on public.enquiry_code_mappings(company_id, code_key, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists enquiry_code_mappings_profile_idx on public.enquiry_code_mappings(profile_id);

-- How a code from a message resolves to a profile for this customer.
create or replace function private.ap9_resolve_code(p_company uuid, p_customer uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v_id uuid; v_basis text; v_candidates jsonb;
begin
  if p_key is null then return null; end if;
  select m.profile_id into v_id from public.enquiry_code_mappings m join public.aluminium_profiles p on p.id = m.profile_id and p.is_active and p.deleted_at is null
    where m.company_id = p_company and m.code_key = p_key and p_customer is not null and m.customer_id = p_customer;
  if v_id is not null then v_basis := 'remembered_customer'; end if;
  if v_id is null and p_customer is not null then
    select a.profile_id into v_id from public.customer_profile_aliases a join public.aluminium_profiles p on p.id = a.profile_id and p.is_active and p.deleted_at is null
      where a.company_id = p_company and a.customer_id = p_customer and a.is_active and private.ap9_code_key(a.alias) = p_key limit 1;
    if v_id is not null then v_basis := 'customer_alias'; end if;
  end if;
  if v_id is null then
    select p.id into v_id from public.aluminium_profiles p where p.company_id = p_company and p.is_active and p.deleted_at is null
      and (private.ap9_code_key(p.profile_code) = p_key or private.ap9_code_key(p.section_code) = p_key) order by (private.ap9_code_key(p.profile_code) = p_key) desc limit 1;
    if v_id is not null then v_basis := 'code'; end if;
  end if;
  if v_id is null then
    select m.profile_id into v_id from public.enquiry_code_mappings m join public.aluminium_profiles p on p.id = m.profile_id and p.is_active and p.deleted_at is null
      where m.company_id = p_company and m.code_key = p_key and m.customer_id is null;
    if v_id is not null then v_basis := 'remembered'; end if;
  end if;
  if v_id is null and p_key ~ '^[0-9]{3,6}$' then
    -- "2045" for "OM-2045": accepted only when exactly one profile carries that number.
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'profile_code', p.profile_code) order by p.profile_code), '[]') into v_candidates
      from public.aluminium_profiles p where p.company_id = p_company and p.is_active and p.deleted_at is null
        and regexp_replace(private.ap9_code_key(p.profile_code), '^[A-Z]+', '') = p_key;
    if jsonb_array_length(v_candidates) = 1 then v_id := (v_candidates -> 0 ->> 'profile_id')::uuid; v_basis := 'code_number'; end if;
  end if;
  if v_id is null then return jsonb_build_object('code_key', p_key, 'profile_id', null, 'candidates', coalesce(v_candidates, '[]')); end if;
  return (select jsonb_build_object('code_key', p_key, 'profile_id', p.id, 'profile_code', p.profile_code, 'profile_name', p.profile_name,
    'section_weight_kg_per_m', p.section_weight_kg_per_m, 'alloy', p.alloy, 'basis', v_basis) from public.aluminium_profiles p where p.id = v_id);
end;
$$;
revoke all on function private.ap9_resolve_code(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.ap9_enquiry_json(e public.quote_enquiries)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(e) - 'company_id' || jsonb_build_object(
    'customer', (select jsonb_build_object('id', cu.id, 'name', coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name), 'phone', cu.phone, 'customer_type', cu.customer_type)
      from public.customers cu where cu.id = e.customer_id),
    'quote_number', (select quote_number from public.quotes where id = e.quote_id),
    'created_by_name', (select full_name from public.app_users where id = e.created_by))
$$;
revoke all on function private.ap9_enquiry_json(public.quote_enquiries) from public, anon, authenticated;

-- Lines from the parser are checked here: known keys and value ranges, profiles of this company. Values the parser could
-- not read stay null; nothing is defaulted to zero.
create or replace function private.ap9_enquiry_lines(p_company uuid, p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare l jsonb; v_out jsonb := '[]'; v_pid uuid;
begin
  if jsonb_typeof(coalesce(p_lines, 'null')) <> 'array' or jsonb_array_length(p_lines) > 100 then raise exception 'AP: The enquiry can have at most 100 lines.'; end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or exists (select 1 from jsonb_object_keys(l) k where k not in ('seq', 'text', 'code', 'code_key', 'profile_id', 'profile_code', 'basis', 'length_m', 'length_text',
      'pieces', 'kg', 'finish', 'shade', 'alloy', 'confidence', 'issues')) then raise exception 'AP: An enquiry line could not be read.'; end if;
    if coalesce(l ->> 'confidence', '') not in ('high', 'medium', 'low') then raise exception 'AP: An enquiry line has no confidence.'; end if;
    if (l ->> 'length_m') is not null and ((l ->> 'length_m')::numeric <= 0 or (l ->> 'length_m')::numeric > 20) then raise exception 'AP: A line length is outside 0 to 20 m.'; end if;
    if (l ->> 'pieces') is not null and ((l ->> 'pieces')::numeric <= 0 or (l ->> 'pieces')::numeric > 1000000 or (l ->> 'pieces')::numeric <> trunc((l ->> 'pieces')::numeric)) then raise exception 'AP: A line quantity in pieces is not a whole number.'; end if;
    if (l ->> 'kg') is not null and ((l ->> 'kg')::numeric <= 0 or (l ->> 'kg')::numeric > 10000000) then raise exception 'AP: A line weight is out of range.'; end if;
    if length(coalesce(l ->> 'text', '')) > 300 then raise exception 'AP: An enquiry line is too long.'; end if;
    v_pid := nullif(l ->> 'profile_id', '')::uuid;
    if v_pid is not null and not exists (select 1 from public.aluminium_profiles where id = v_pid and company_id = p_company) then raise exception 'AP: A line names a profile that is not in this company.'; end if;
    v_out := v_out || l;
  end loop;
  return v_out;
end;
$$;
revoke all on function private.ap9_enquiry_lines(uuid, jsonb) from public, anon, authenticated;

create or replace function public.ap_enquiry(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; e public.quote_enquiries%rowtype; v_customer uuid; v_phone text; v_name text; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
  v_seq integer; v_key text; v_pid uuid; v_lines jsonb; l jsonb; v_items jsonb := '[]'; v_skipped jsonb := '[]'; p record; v_billet public.costing_rates%rowtype;
  v_conv public.costing_rates%rowtype; v_fin public.costing_rates%rowtype; v_fin_type text; s public.company_settings%rowtype; v_pieces integer; v_search text := lower(btrim(coalesce(p_payload ->> 'search', '')));
  q public.quotes%rowtype; v_remember text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'sales_manager', 'sales']);
  if p_command = 'context' then
    perform private.ap_keys(p_payload, array['codes', 'phone', 'name', 'customer_id']);
    if jsonb_typeof(coalesce(p_payload -> 'codes', '[]')) <> 'array' or jsonb_array_length(coalesce(p_payload -> 'codes', '[]')) > 100 then raise exception 'AP: Too many codes in one enquiry.'; end if;
    v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    v_phone := right(regexp_replace(coalesce(p_payload ->> 'phone', ''), '[^0-9]', '', 'g'), 10);
    v_name := lower(btrim(coalesce(p_payload ->> 'name', '')));
    if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id) then v_customer := null; end if;
    if v_customer is null and length(v_phone) = 10 then
      select cu.id into v_customer from public.customers cu where cu.company_id = c.company_id and cu.is_active and cu.deleted_at is null
        and (right(regexp_replace(coalesce(cu.whatsapp_number, ''), '[^0-9]', '', 'g'), 10) = v_phone or right(regexp_replace(coalesce(cu.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone)
        order by cu.updated_at desc limit 1;
      if v_customer is not null then v_name := 'phone'; end if;
    end if;
    if v_customer is null and length(v_name) >= 3 and v_name <> 'phone' then
      select cu.id into v_customer from public.customers cu where cu.company_id = c.company_id and cu.is_active and cu.deleted_at is null
        and (lower(cu.customer_name) = v_name or lower(coalesce(cu.company_name, '')) = v_name or lower(coalesce(cu.contact_person, '')) = v_name) limit 1;
      if v_customer is not null then v_name := 'name'; end if;
    end if;
    return jsonb_build_object(
      'customer', (select jsonb_build_object('id', cu.id, 'name', coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name), 'basis', case when v_name in ('phone', 'name') then v_name else 'chosen' end)
        from public.customers cu where cu.id = v_customer),
      'codes', (select coalesce(jsonb_object_agg(k, private.ap9_resolve_code(c.company_id, v_customer, k)), '{}')
        from (select distinct private.ap9_code_key(x) k from jsonb_array_elements_text(coalesce(p_payload -> 'codes', '[]')) x) q where k is not null and length(k) <= 40));
  elsif p_command = 'save' then
    perform private.ap_keys(p_payload, array['raw_text', 'source', 'sender_phone', 'sender_name', 'customer_id', 'customer_basis', 'lines', 'unknown_codes']);
    if length(coalesce(p_payload ->> 'raw_text', '')) not between 3 and 20000 then raise exception 'AP: Paste the enquiry text (up to 20,000 characters).'; end if;
    v_customer := private.ap_uuid(p_payload, 'customer_id', false);
    if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and company_id = c.company_id) then raise exception 'AP: Customer not found.'; end if;
    v_lines := private.ap9_enquiry_lines(c.company_id, p_payload -> 'lines');
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap9-enquiry-number', 0));
    select coalesce(max(substring(enquiry_number from 12)::integer), 0) + 1 into v_seq from public.quote_enquiries
      where company_id = c.company_id and enquiry_number like 'ENQ-' || to_char(private.ist_today(), 'YYMMDD') || '-%';
    insert into public.quote_enquiries(company_id, enquiry_number, raw_text, source, sender_phone, sender_name, customer_id, customer_basis, lines, unknown_codes, created_by)
      values (c.company_id, 'ENQ-' || to_char(private.ist_today(), 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0'), p_payload ->> 'raw_text',
        coalesce(nullif(p_payload ->> 'source', ''), 'paste'), nullif(regexp_replace(coalesce(p_payload ->> 'sender_phone', ''), '[^0-9]', '', 'g'), ''),
        private.ap_text(p_payload ->> 'sender_name', 'Sender', 1, 80, false), v_customer, case when v_customer is null then null else coalesce(nullif(p_payload ->> 'customer_basis', ''), 'chosen') end,
        v_lines, array(select distinct x from jsonb_array_elements_text(coalesce(p_payload -> 'unknown_codes', '[]')) x where x ~ '^[A-Z0-9]{1,40}$'), c.actor_id)
      returning * into e;
    return private.ap9_enquiry_json(e);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into e from public.quote_enquiries where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if e.id is null then raise exception 'AP: Enquiry not found.'; end if;
    return private.ap9_enquiry_json(e);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status', 'search']);
    with f as (select x.id, row_number() over (order by x.created_at desc, x.id) k from public.quote_enquiries x
      left join public.customers cu on cu.id = x.customer_id
      where x.company_id = c.company_id and (coalesce(p_payload ->> 'status', 'draft') = 'all' or x.status = coalesce(p_payload ->> 'status', 'draft'))
        and (v_search = '' or lower(x.enquiry_number || ' ' || coalesce(cu.customer_name, '') || ' ' || coalesce(cu.company_name, '') || ' ' || left(x.raw_text, 400)) like '%' || v_search || '%'))
    select coalesce((select jsonb_agg(jsonb_build_object('id', e2.id, 'enquiry_number', e2.enquiry_number, 'status', e2.status, 'created_at', e2.created_at,
        'customer', (select coalesce(nullif(btrim(company_name), ''), customer_name) from public.customers where id = e2.customer_id),
        'lines', jsonb_array_length(e2.lines), 'high', (select count(*) from jsonb_array_elements(e2.lines) x where x ->> 'confidence' = 'high'),
        'unknown', cardinality(e2.unknown_codes), 'quote_number', (select quote_number from public.quotes where id = e2.quote_id), 'preview', left(e2.raw_text, 120)) order by f.k)
      from f join public.quote_enquiries e2 on e2.id = f.id where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'), (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command = 'map' then
    perform private.ap_keys(p_payload, array['id', 'code_key', 'profile_id', 'remember']);
    select * into e from public.quote_enquiries where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if e.id is null or e.status <> 'draft' then raise exception 'AP: Only a draft enquiry can be mapped.'; end if;
    v_key := private.ap9_code_key(p_payload ->> 'code_key');
    if v_key is null or length(v_key) > 40 then raise exception 'AP: Unknown code.'; end if;
    v_pid := private.ap_uuid(p_payload, 'profile_id');
    select id, profile_code into p from public.aluminium_profiles where id = v_pid and company_id = c.company_id and is_active and deleted_at is null;
    if p.id is null then raise exception 'AP: Profile not found.'; end if;
    v_remember := coalesce(p_payload ->> 'remember', 'customer');
    if v_remember not in ('customer', 'everyone', 'no') then raise exception 'AP: Choose who the mapping is remembered for.'; end if;
    if v_remember = 'customer' and e.customer_id is null then raise exception 'AP: Choose the customer first, or remember the mapping for every customer.'; end if;
    if v_remember <> 'no' then
      insert into public.enquiry_code_mappings(company_id, code_key, customer_id, profile_id, created_by)
        values (c.company_id, v_key, case when v_remember = 'customer' then e.customer_id end, v_pid, c.actor_id)
        on conflict (company_id, code_key, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set profile_id = excluded.profile_id, created_by = excluded.created_by, created_at = clock_timestamp();
    end if;
    select coalesce(jsonb_agg(case when x ->> 'code_key' = v_key then
        x || jsonb_build_object('profile_id', v_pid, 'profile_code', p.profile_code, 'basis', 'chosen',
          'confidence', case when (x ->> 'length_m') is not null and ((x ->> 'pieces') is not null or (x ->> 'kg') is not null) then 'high' else 'low' end,
          'issues', coalesce((select jsonb_agg(i) from jsonb_array_elements_text(x -> 'issues') i where i not like 'Unknown code%'), '[]'))
        else x end order by (x ->> 'seq')::integer), '[]') into v_lines from jsonb_array_elements(e.lines) x;
    update public.quote_enquiries set lines = v_lines, unknown_codes = array_remove(unknown_codes, v_key), updated_at = clock_timestamp() where id = e.id returning * into e;
    return private.ap9_enquiry_json(e);
  elsif p_command = 'set_customer' then
    perform private.ap_keys(p_payload, array['id', 'customer_id']);
    select * into e from public.quote_enquiries where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if e.id is null or e.status <> 'draft' then raise exception 'AP: Only a draft enquiry can change customer.'; end if;
    if not exists (select 1 from public.customers where id = private.ap_uuid(p_payload, 'customer_id') and company_id = c.company_id and is_active and deleted_at is null) then raise exception 'AP: Customer not found.'; end if;
    update public.quote_enquiries set customer_id = private.ap_uuid(p_payload, 'customer_id'), customer_basis = 'chosen', updated_at = clock_timestamp() where id = e.id returning * into e;
    return private.ap9_enquiry_json(e);
  elsif p_command = 'draft' then
    -- The quotation form opens with these lines; prices come from the normal quotation calculation and today's approved rates.
    perform private.ap4_need(c.role, array['owner', 'admin']);
    perform private.ap_keys(p_payload, array['id']);
    select * into e from public.quote_enquiries where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if e.id is null or e.status <> 'draft' then raise exception 'AP: Only a draft enquiry opens as a quotation.'; end if;
    if e.customer_id is null then raise exception 'AP: Choose the customer for this enquiry first.'; end if;
    select * into s from public.company_settings where company_id = c.company_id;
    for l in select value from jsonb_array_elements(e.lines) order by (value ->> 'seq')::integer loop
      select * into p from public.aluminium_profiles where id = nullif(l ->> 'profile_id', '')::uuid and company_id = c.company_id and is_active and deleted_at is null;
      if p.id is null then v_skipped := v_skipped || jsonb_build_object('seq', l -> 'seq', 'text', l ->> 'text', 'reason', 'Profile not mapped'); continue; end if;
      if (l ->> 'length_m') is null then v_skipped := v_skipped || jsonb_build_object('seq', l -> 'seq', 'text', l ->> 'text', 'reason', 'Length not stated'); continue; end if;
      v_pieces := coalesce((l ->> 'pieces')::integer, case when (l ->> 'kg') is not null then ceil((l ->> 'kg')::numeric / ((l ->> 'length_m')::numeric * p.section_weight_kg_per_m))::integer end);
      if v_pieces is null then v_skipped := v_skipped || jsonb_build_object('seq', l -> 'seq', 'text', l ->> 'text', 'reason', 'Quantity not stated'); continue; end if;
      v_fin_type := coalesce(nullif(l ->> 'finish', ''), 'mill_finish');
      v_billet := private.applicable_costing_rate(c.company_id, 'billet', 'per_kg', private.ist_today(), e.customer_id, nullif(upper(btrim(p.alloy)), ''), null);
      v_conv := private.applicable_costing_rate(c.company_id, 'conversion', 'per_kg', private.ist_today(), e.customer_id, null, null);
      v_fin := null;
      if v_fin_type <> 'mill_finish' then
        v_fin := private.applicable_costing_rate(c.company_id, 'finishing', 'per_kg', private.ist_today(), e.customer_id, null, v_fin_type);
        if v_fin.id is null then v_fin := private.applicable_costing_rate(c.company_id, 'finishing', 'per_sqft', private.ist_today(), e.customer_id, null, v_fin_type); end if;
      end if;
      v_items := v_items || jsonb_build_object('seq', l -> 'seq', 'profile_id', p.id, 'profile_code', p.profile_code, 'item_description', left(coalesce(nullif(l ->> 'text', ''), p.profile_code), 200)
          || case when nullif(l ->> 'shade', '') is not null then ' · ' || (l ->> 'shade') else '' end,
        'quantity_pieces', v_pieces, 'length_per_piece_m', (l ->> 'length_m')::numeric, 'section_weight_kg_per_m', p.section_weight_kg_per_m,
        'billet_rate_per_kg', coalesce(v_billet.rate, 0), 'billet_rate_found', v_billet.id is not null,
        'conversion_charge_per_kg', coalesce(v_conv.rate, s.default_conversion_charge_per_kg, 0), 'finishing_type', v_fin_type,
        'finishing_charge_type', case when v_fin.basis = 'per_sqft' then 'per_sqft' else 'per_kg' end, 'finishing_charge', coalesce(v_fin.rate, 0),
        'finishing_rate_found', v_fin_type = 'mill_finish' or v_fin.id is not null,
        'packing_charge', coalesce(s.default_packing_charge, 0), 'transport_charge', coalesce(s.default_transport_charge, 0), 'margin_percent', coalesce(s.default_margin_percent, 10),
        'minimum_margin_percent', coalesce(s.minimum_margin_percent, 8), 'gst_percent', coalesce(s.default_gst_percent, 18), 'confidence', l ->> 'confidence');
    end loop;
    return jsonb_build_object('enquiry_id', e.id, 'enquiry_number', e.enquiry_number, 'customer', (select jsonb_build_object('id', cu.id, 'customer_name', cu.customer_name, 'company_name', cu.company_name,
        'gst_number', cu.gst_number, 'billing_address', cu.billing_address, 'shipping_address', cu.shipping_address) from public.customers cu where cu.id = e.customer_id),
      'items', v_items, 'skipped', v_skipped, 'gst_percent', coalesce(s.default_gst_percent, 18), 'validity_days', coalesce(s.default_quote_validity_days, 15),
      'notes', 'From enquiry ' || e.enquiry_number);
  elsif p_command = 'link_quote' then
    perform private.ap_keys(p_payload, array['id', 'quote_id']);
    select * into e from public.quote_enquiries where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if e.id is null then raise exception 'AP: Enquiry not found.'; end if;
    select * into q from public.quotes where id = private.ap_uuid(p_payload, 'quote_id') and company_id = c.company_id and deleted_at is null;
    if q.id is null then raise exception 'AP: Quotation not found.'; end if;
    if e.status = 'quoted' and e.quote_id = q.id then return private.ap9_enquiry_json(e); end if;
    if e.status <> 'draft' then raise exception 'AP: This enquiry is already %.', e.status; end if;
    if q.customer_id is distinct from e.customer_id or q.created_at < e.created_at - interval '5 minutes' then raise exception 'AP: That quotation was not prepared from this enquiry.'; end if;
    update public.quote_enquiries set status = 'quoted', quote_id = q.id, updated_at = clock_timestamp() where id = e.id returning * into e;
    update public.enquiry_code_mappings m set use_count = use_count + 1, last_used_at = clock_timestamp()
      where m.company_id = c.company_id and m.code_key in (select x ->> 'code_key' from jsonb_array_elements(e.lines) x where x ->> 'basis' in ('remembered', 'remembered_customer', 'chosen'))
        and (m.customer_id is null or m.customer_id = e.customer_id);
    return private.ap9_enquiry_json(e);
  elsif p_command = 'discard' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.quote_enquiries set status = 'discarded', discarded_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 3, 300), updated_at = clock_timestamp()
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'draft' returning * into e;
    if e.id is null then raise exception 'AP: Draft enquiry not found.'; end if;
    return private.ap9_enquiry_json(e);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_enquiry(text, jsonb) from public, anon;
grant execute on function public.ap_enquiry(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-009: a photographed shift register becomes draft rows against that shift's jobs
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.register_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 3 and 60 and name !~ '[[:cntrl:]]'),
  columns text[] not null check (cardinality(columns) between 1 and 8 and columns <@ array['die_no', 'job_no', 'billets', 'pushes', 'output_pcs', 'rejects', 'downtime_min', 'remarks']),
  notes text check (notes is null or length(btrim(notes)) between 3 and 300),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists register_templates_name_key on public.register_templates(company_id, lower(name)) where status = 'active';

create table if not exists public.register_captures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  capture_number text not null,
  machine_id uuid not null references public.machines(id),
  shift_day date not null,
  shift_name text check (shift_name is null or length(btrim(shift_name)) between 1 and 40),
  window_start timestamptz not null,
  window_end timestamptz not null,
  template_id uuid references public.register_templates(id),
  storage_path text not null,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  extraction text not null check (extraction in ('typed', 'vision')),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'discarded')),
  summary jsonb,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  confirmed_by uuid references public.app_users(id),
  confirmed_at timestamptz,
  discarded_reason text check (discarded_reason is null or length(btrim(discarded_reason)) between 3 and 300),
  check (window_end > window_start),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  unique (company_id, capture_number)
);
create unique index if not exists register_captures_photo_key on public.register_captures(company_id, file_sha256) where status <> 'discarded';
create index if not exists register_captures_company_idx on public.register_captures(company_id, status, shift_day desc);

create table if not exists public.register_capture_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  capture_id uuid not null references public.register_captures(id) on delete cascade,
  seq integer not null check (seq between 1 and 100),
  job_id uuid references public.production_jobs(id),
  die_no text check (die_no is null or length(btrim(die_no)) between 1 and 40),
  billets integer check (billets is null or billets between 0 and 5000),
  pushes integer check (pushes is null or pushes between 0 and 5000),
  output_pcs integer check (output_pcs is null or output_pcs between 0 and 1000000),
  rejects integer check (rejects is null or rejects between 0 and 1000000),
  downtime_min integer check (downtime_min is null or downtime_min between 0 and 1440),
  remarks text check (remarks is null or length(btrim(remarks)) between 1 and 200),
  -- Per cell: where the value came from (system, typed from the photo, read from the photo) and how sure the reader was.
  cells jsonb not null default '{}' check (jsonb_typeof(cells) = 'object'),
  tapped_pushes integer not null default 0,
  backfilled integer not null default 0,
  unique (capture_id, seq)
);
create index if not exists register_capture_rows_capture_idx on public.register_capture_rows(company_id, capture_id, seq);
create index if not exists register_capture_rows_job_idx on public.register_capture_rows(job_id) where job_id is not null;

-- The shift window on a press: the shift's hours from factory capacity (IST), else the whole day.
create or replace function private.ap9_shift_window(p_company uuid, p_machine uuid, p_day date, p_shift text)
returns table(window_start timestamptz, window_end timestamptz) language sql stable security definer set search_path = public, private as $$
  select coalesce((select (p_day + s.starts_local) at time zone 'Asia/Kolkata' from public.factory_shift_capacities s where s.company_id = p_company and s.machine_id = p_machine
      and s.weekday = extract(isodow from p_day)::integer and lower(s.shift_name) = lower(p_shift) limit 1), p_day::timestamp at time zone 'Asia/Kolkata'),
    coalesce((select ((p_day + case when s.ends_local <= s.starts_local then 1 else 0 end) + s.ends_local) at time zone 'Asia/Kolkata' from public.factory_shift_capacities s
      where s.company_id = p_company and s.machine_id = p_machine and s.weekday = extract(isodow from p_day)::integer and lower(s.shift_name) = lower(p_shift) limit 1),
      (p_day + 1)::timestamp at time zone 'Asia/Kolkata')
$$;
revoke all on function private.ap9_shift_window(uuid, uuid, date, text) from public, anon, authenticated;

-- Pushes already tapped for a job in a window (voided pushes excluded).
create or replace function private.ap9_tapped(p_company uuid, p_job uuid, p_from timestamptz, p_to timestamptz)
returns integer language sql stable security definer set search_path = public, private as $$
  select count(*)::integer from public.production_push_events e where e.company_id = p_company and e.production_job_id = p_job and e.kind = 'push'
    and e.event_at >= p_from and e.event_at < p_to and not exists (select 1 from public.production_push_events v where v.voids_event_id = e.id)
$$;
revoke all on function private.ap9_tapped(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.ap9_capture_json(x public.register_captures)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(x) - 'company_id' || jsonb_build_object(
    'machine', (select machine_name from public.machines where id = x.machine_id),
    'template', (select jsonb_build_object('id', t.id, 'name', t.name, 'columns', t.columns) from public.register_templates t where t.id = x.template_id),
    'created_by_name', (select full_name from public.app_users where id = x.created_by),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'seq', r.seq, 'job_id', r.job_id, 'job_number', j.job_number, 'die_no', r.die_no, 'billets', r.billets,
        'pushes', r.pushes, 'output_pcs', r.output_pcs, 'rejects', r.rejects, 'downtime_min', r.downtime_min, 'remarks', r.remarks, 'cells', r.cells,
        'tapped_pushes', case when x.status = 'draft' and r.job_id is not null then private.ap9_tapped(x.company_id, r.job_id, x.window_start, x.window_end) else r.tapped_pushes end,
        'backfilled', r.backfilled) order by r.seq), '[]')
      from public.register_capture_rows r left join public.production_jobs j on j.id = r.job_id where r.capture_id = x.id),
    'shift_jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'job_number', j.job_number, 'die_number', d.die_number, 'status', j.status) order by j.job_number), '[]')
      from public.production_jobs j left join public.dies d on d.id = j.die_id
      where j.company_id = x.company_id and j.machine_id = x.machine_id and j.status <> 'cancelled'
        and (j.planned_date = x.shift_day or exists (select 1 from public.production_push_events e where e.production_job_id = j.id and e.event_at >= x.window_start and e.event_at < x.window_end))))
$$;
revoke all on function private.ap9_capture_json(public.register_captures) from public, anon, authenticated;

-- Draft rows: one per value the register can carry; blank stays null. Cells record their source.
create or replace function private.ap9_capture_rows_save(p_company uuid, p_capture public.register_captures, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, private as $$
declare r jsonb; v_seq integer := 0; v_job uuid;
begin
  if jsonb_typeof(coalesce(p_rows, 'null')) <> 'array' or jsonb_array_length(p_rows) > 100 then raise exception 'AP: A register has at most 100 rows.'; end if;
  delete from public.register_capture_rows where capture_id = p_capture.id;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' or exists (select 1 from jsonb_object_keys(r) k where k not in ('id', 'job_id', 'die_no', 'billets', 'pushes', 'output_pcs', 'rejects', 'downtime_min', 'remarks', 'cells')) then
      raise exception 'AP: A register row could not be read.';
    end if;
    v_seq := v_seq + 1;
    v_job := nullif(r ->> 'job_id', '')::uuid;
    if v_job is not null and not exists (select 1 from public.production_jobs where id = v_job and company_id = p_company) then raise exception 'AP: Row % names a job that is not in this company.', v_seq; end if;
    insert into public.register_capture_rows(company_id, capture_id, seq, job_id, die_no, billets, pushes, output_pcs, rejects, downtime_min, remarks, cells)
      values (p_company, p_capture.id, v_seq, v_job, private.ap_text(r ->> 'die_no', 'Die number', 1, 40, false),
        private.ap9_int(r, 'billets', 'Billets in row ' || v_seq, 0, 5000), private.ap9_int(r, 'pushes', 'Pushes in row ' || v_seq, 0, 5000),
        private.ap9_int(r, 'output_pcs', 'Output pieces in row ' || v_seq, 0, 1000000), private.ap9_int(r, 'rejects', 'Rejects in row ' || v_seq, 0, 1000000),
        private.ap9_int(r, 'downtime_min', 'Downtime minutes in row ' || v_seq, 0, 1440), private.ap_text(r ->> 'remarks', 'Remarks', 1, 200, false),
        case when jsonb_typeof(r -> 'cells') = 'object' then r -> 'cells' else '{}'::jsonb end);
  end loop;
end;
$$;
revoke all on function private.ap9_capture_rows_save(uuid, public.register_captures, jsonb) from public, anon, authenticated;

create or replace function public.ap_register(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; x public.register_captures%rowtype; t public.register_templates%rowtype; r record; j public.production_jobs%rowtype; v_seq integer; v_ws timestamptz; v_we timestamptz;
  v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload); v_tapped integer; v_add integer; v_added integer := 0; i integer; v_machine uuid; v_day date;
  v_supervisor text[] := array['owner', 'admin', 'factory_manager', 'production_manager']; v_existing text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'production_manager', 'production']);
  if p_command = 'templates' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(to_jsonb(t2) - 'company_id' order by t2.name), '[]') from public.register_templates t2 where t2.company_id = c.company_id and t2.status = 'active'));
  elsif p_command = 'save_template' then
    perform private.ap4_need(c.role, v_supervisor);
    perform private.ap_keys(p_payload, array['name', 'columns', 'notes']);
    if jsonb_typeof(coalesce(p_payload -> 'columns', 'null')) <> 'array' then raise exception 'AP: Choose the register columns in order.'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_payload -> 'columns') k where k not in ('die_no', 'job_no', 'billets', 'pushes', 'output_pcs', 'rejects', 'downtime_min', 'remarks'))
      or jsonb_array_length(p_payload -> 'columns') not between 1 and 8 then raise exception 'AP: Choose the register columns from the list.'; end if;
    insert into public.register_templates(company_id, name, columns, notes, created_by)
      values (c.company_id, private.ap_text(p_payload ->> 'name', 'Template name', 3, 60), array(select jsonb_array_elements_text(p_payload -> 'columns')),
        private.ap_text(p_payload ->> 'notes', 'Notes', 3, 300, false), c.actor_id) returning * into t;
    return to_jsonb(t) - 'company_id';
  elsif p_command = 'retire_template' then
    perform private.ap4_need(c.role, v_supervisor);
    perform private.ap_keys(p_payload, array['id']);
    update public.register_templates set status = 'retired' where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'active' returning * into t;
    if t.id is null then raise exception 'AP: Template not found.'; end if;
    return jsonb_build_object('id', t.id, 'status', t.status);
  elsif p_command = 'create' then
    perform private.ap_keys(p_payload, array['machine_id', 'shift_day', 'shift_name', 'template_id', 'storage_path', 'file_name', 'mime_type', 'file_sha256']);
    v_machine := private.ap_uuid(p_payload, 'machine_id');
    if not exists (select 1 from public.machines where id = v_machine and company_id = c.company_id) then raise exception 'AP: Press not found.'; end if;
    v_day := (p_payload ->> 'shift_day')::date;
    if v_day > private.ist_today() or v_day < private.ist_today() - 14 then raise exception 'AP: Capture registers from the last 14 days.'; end if;
    if coalesce(p_payload ->> 'storage_path', '') not like c.company_id::text || '/register-photos/%' or (p_payload ->> 'storage_path') like '%..%' then raise exception 'AP: Upload the photo again.'; end if;
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[a-f0-9]{64}$' then raise exception 'AP: Upload the photo again.'; end if;
    select capture_number into v_existing from public.register_captures where company_id = c.company_id and file_sha256 = p_payload ->> 'file_sha256' and status <> 'discarded';
    if v_existing is not null then raise exception 'AP: This photo was already captured as %.', v_existing; end if;
    if nullif(p_payload ->> 'template_id', '') is not null and not exists (select 1 from public.register_templates where id = (p_payload ->> 'template_id')::uuid and company_id = c.company_id and status = 'active') then
      raise exception 'AP: Template not found.';
    end if;
    select w.window_start, w.window_end into v_ws, v_we from private.ap9_shift_window(c.company_id, v_machine, v_day, coalesce(nullif(btrim(p_payload ->> 'shift_name'), ''), '-')) w;
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text || ':ap9-register-number', 0));
    select coalesce(max(substring(capture_number from 12)::integer), 0) + 1 into v_seq from public.register_captures where company_id = c.company_id and capture_number like 'REG-' || to_char(v_day, 'YYMMDD') || '-%';
    insert into public.register_captures(company_id, capture_number, machine_id, shift_day, shift_name, window_start, window_end, template_id, storage_path, file_name, mime_type, file_sha256, extraction, created_by)
      values (c.company_id, 'REG-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0'), v_machine, v_day, private.ap_text(p_payload ->> 'shift_name', 'Shift', 1, 40, false), v_ws, v_we,
        nullif(p_payload ->> 'template_id', '')::uuid, p_payload ->> 'storage_path', private.ap_text(p_payload ->> 'file_name', 'File name', 1, 200),
        coalesce(p_payload ->> 'mime_type', 'image/jpeg'), p_payload ->> 'file_sha256', 'typed', c.actor_id)
      returning * into x;
    -- One row per job that ran on this press in the shift; the system fills what it already knows (job, die, pushes tapped).
    v_seq := 0;
    for r in select j2.id, d.die_number from public.production_jobs j2 left join public.dies d on d.id = j2.die_id
      where j2.company_id = c.company_id and j2.machine_id = v_machine and j2.status <> 'cancelled'
        and (j2.planned_date = v_day or exists (select 1 from public.production_push_events e where e.production_job_id = j2.id and e.event_at >= v_ws and e.event_at < v_we))
      order by j2.job_number limit 100 loop
      v_seq := v_seq + 1;
      insert into public.register_capture_rows(company_id, capture_id, seq, job_id, die_no, cells, tapped_pushes)
        values (c.company_id, x.id, v_seq, r.id, r.die_number, jsonb_build_object('job_id', jsonb_build_object('source', 'system'), 'die_no', jsonb_build_object('source', 'system')),
          private.ap9_tapped(c.company_id, r.id, v_ws, v_we));
    end loop;
    return private.ap9_capture_json(x);
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into x from public.register_captures where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if x.id is null then raise exception 'AP: Register capture not found.'; end if;
    return private.ap9_capture_json(x);
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'status']);
    with f as (select x2.id, row_number() over (order by x2.shift_day desc, x2.created_at desc) k from public.register_captures x2
      where x2.company_id = c.company_id and (coalesce(p_payload ->> 'status', 'all') = 'all' or x2.status = p_payload ->> 'status'))
    select coalesce((select jsonb_agg(jsonb_build_object('id', x2.id, 'capture_number', x2.capture_number, 'shift_day', x2.shift_day, 'shift_name', x2.shift_name, 'status', x2.status,
        'machine', (select machine_name from public.machines where id = x2.machine_id), 'rows', (select count(*) from public.register_capture_rows r2 where r2.capture_id = x2.id),
        'created_at', x2.created_at, 'confirmed_at', x2.confirmed_at, 'summary', x2.summary) order by f.k)
      from f join public.register_captures x2 on x2.id = f.id where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'), (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  elsif p_command in ('save_rows', 'confirm') then
    if p_command = 'confirm' then perform private.ap4_need(c.role, v_supervisor); end if;
    perform private.ap_keys(p_payload, array['id', 'rows']);
    select * into x from public.register_captures where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id for update;
    if x.id is null then raise exception 'AP: Register capture not found.'; end if;
    if x.status <> 'draft' then raise exception 'AP: This register is already %.', x.status; end if;
    perform private.ap9_capture_rows_save(c.company_id, x, p_payload -> 'rows');
    if p_command = 'save_rows' then return private.ap9_capture_json(x); end if;
    for r in select * from public.register_capture_rows where capture_id = x.id order by seq for update loop
      if r.job_id is null then
        if coalesce(r.billets, r.pushes, r.output_pcs, r.rejects, r.downtime_min) is not null then raise exception 'AP: Choose the job for row %.', r.seq; end if;
        continue;
      end if;
      select * into j from public.production_jobs where id = r.job_id and company_id = c.company_id;
      v_tapped := private.ap9_tapped(c.company_id, j.id, x.window_start, x.window_end);
      v_add := 0;
      if r.pushes is not null then
        if r.pushes < v_tapped then
          raise exception 'AP: Row % shows % pushes but % were already tapped for % in this shift. Void the mistaken pushes on the job instead.', r.seq, r.pushes, v_tapped, j.job_number;
        end if;
        v_add := r.pushes - v_tapped;
        if v_add > 200 then raise exception 'AP: Row % would add % pushes; at most 200 are added from one register row.', r.seq, v_add; end if;
        for i in 1 .. v_add loop
          perform private.ap2_record_push(c.company_id, c.actor_id, j.id, coalesce(j.machine_id, x.machine_id), null, gen_random_uuid(), null, 'backfill', 'Shift register ' || x.capture_number);
        end loop;
      end if;
      update public.register_capture_rows set tapped_pushes = v_tapped, backfilled = v_add where id = r.id;
      v_added := v_added + v_add;
    end loop;
    update public.register_captures set status = 'confirmed', confirmed_by = c.actor_id, confirmed_at = clock_timestamp(),
      summary = (select jsonb_build_object('rows', count(*) filter (where job_id is not null), 'pushes_added', v_added, 'output_pcs', sum(output_pcs), 'rejects', sum(rejects),
        'downtime_min', sum(downtime_min)) from public.register_capture_rows where capture_id = x.id)
      where id = x.id returning * into x;
    return private.ap9_capture_json(x);
  elsif p_command = 'discard' then
    perform private.ap_keys(p_payload, array['id', 'reason']);
    update public.register_captures set status = 'discarded', discarded_reason = private.ap_text(p_payload ->> 'reason', 'Reason', 3, 300)
      where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id and status = 'draft' returning * into x;
    if x.id is null then raise exception 'AP: Draft register not found.'; end if;
    return jsonb_build_object('id', x.id, 'status', x.status);
  elsif p_command = 'job' then
    perform private.ap_keys(p_payload, array['job_id']);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object('capture_id', x2.id, 'capture_number', x2.capture_number, 'shift_day', x2.shift_day, 'shift_name', x2.shift_name,
        'pushes', r2.pushes, 'backfilled', r2.backfilled, 'output_pcs', r2.output_pcs, 'rejects', r2.rejects, 'downtime_min', r2.downtime_min, 'remarks', r2.remarks) order by x2.shift_day desc), '[]')
      from public.register_capture_rows r2 join public.register_captures x2 on x2.id = r2.capture_id and x2.status = 'confirmed'
      where r2.company_id = c.company_id and r2.job_id = private.ap_uuid(p_payload, 'job_id')));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_register(text, jsonb) from public, anon;
grant execute on function public.ap_register(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-010: how each bundle weight was captured (packing scale or typed), checked against theoretical
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.bundle_weight_captures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bundle_id uuid not null unique references public.prepared_physical_bundles(id),
  source text not null check (source in ('scale', 'manual')),
  indicator_ref text check (indicator_ref is null or length(btrim(indicator_ref)) between 2 and 60),
  raw_reading text check (raw_reading is null or (length(raw_reading) <= 80 and raw_reading !~ '[[:cntrl:]]')),
  stable boolean,
  readings_count integer check (readings_count is null or readings_count between 1 and 1000),
  gross_kg numeric(12,3) not null,
  tare_kg numeric(12,3) not null,
  net_kg numeric(12,3) not null,
  theoretical_kg numeric(12,3),
  tolerance_percent numeric(6,3),
  tolerance_source text check (tolerance_source in ('section_weight_policy', 'profile')),
  deviation_percent numeric(8,3),
  flagged boolean not null default false,
  recorded_by uuid not null references public.app_users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check (source = 'manual' or (raw_reading is not null and stable is true)),
  check (not flagged or (tolerance_percent is not null and deviation_percent is not null))
);
create index if not exists bundle_weight_captures_company_idx on public.bundle_weight_captures(company_id, recorded_at desc);
create index if not exists bundle_weight_captures_flag_idx on public.bundle_weight_captures(company_id, recorded_at desc) where flagged;

create or replace function public.ap_scale(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; b public.prepared_physical_bundles%rowtype; w public.bundle_weight_captures%rowtype; v_kgm numeric; v_theo numeric; v_tol numeric; v_tol_source text; v_dev numeric;
  v_source text; v_days integer; v_rows jsonb; v_total bigint; v_page integer := private.ap3_page(p_payload);
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'factory_manager', 'dispatch_manager', 'dispatch', 'inventory_manager', 'quality']);
  if p_command = 'record' then
    perform private.ap_keys(p_payload, array['bundle_id', 'source', 'indicator_ref', 'raw_reading', 'stable', 'readings_count']);
    select * into b from public.prepared_physical_bundles where id = private.ap_uuid(p_payload, 'bundle_id') and company_id = c.company_id;
    if b.id is null then raise exception 'AP: Bundle not found.'; end if;
    select * into w from public.bundle_weight_captures where bundle_id = b.id;
    if w.id is not null then return to_jsonb(w) - 'company_id' || jsonb_build_object('replayed', true); end if;
    v_source := p_payload ->> 'source';
    if v_source is null or v_source not in ('scale', 'manual') then raise exception 'AP: Say whether the weight came from the scale or was typed.'; end if;
    if v_source = 'scale' and (coalesce(p_payload ->> 'raw_reading', '') = '' or coalesce((p_payload ->> 'stable')::boolean, false) is false) then
      raise exception 'AP: A scale weight needs a stable reading from the indicator. Capture again, or type the weight (it is then marked as typed).';
    end if;
    -- Theoretical net weight: metres in the bundle x the profile's section weight. The tolerance is the approved
    -- section-weight policy (AP-027), else the profile's own tolerance; without either the bundle is not judged.
    select p.section_weight_kg_per_m, p.weight_tolerance_percent into v_kgm, v_tol from public.aluminium_profiles p where p.id = b.profile_id and p.company_id = c.company_id;
    v_tol_source := case when v_tol is not null then 'profile' end;
    if (select tolerance_percent from public.section_weight_settings where company_id = c.company_id) is not null then
      select tolerance_percent into v_tol from public.section_weight_settings where company_id = c.company_id; v_tol_source := 'section_weight_policy';
    end if;
    v_theo := case when v_kgm > 0 then round(b.net_length_m * v_kgm, 3) end;
    v_dev := case when v_theo > 0 then round(((b.gross_weight_kg - b.tare_weight_kg) - v_theo) / v_theo * 100, 3) end;
    insert into public.bundle_weight_captures(company_id, bundle_id, source, indicator_ref, raw_reading, stable, readings_count, gross_kg, tare_kg, net_kg, theoretical_kg,
      tolerance_percent, tolerance_source, deviation_percent, flagged, recorded_by)
      values (c.company_id, b.id, v_source, private.ap_text(p_payload ->> 'indicator_ref', 'Scale name', 2, 60, false), left(nullif(p_payload ->> 'raw_reading', ''), 80),
        case when v_source = 'scale' then true when p_payload ? 'stable' then (p_payload ->> 'stable')::boolean end, private.ap9_int(p_payload, 'readings_count', 'Readings', 1, 1000),
        b.gross_weight_kg, b.tare_weight_kg, round(b.gross_weight_kg - b.tare_weight_kg, 3), v_theo, v_tol, v_tol_source, v_dev,
        v_tol is not null and v_dev is not null and abs(v_dev) > v_tol, c.actor_id)
      returning * into w;
    if w.flagged then
      perform private.ap3_notify_roles(c.company_id, array['owner', 'admin', 'factory_manager', 'quality'], 'bundle_weight', 'warning',
        'Bundle ' || b.bundle_number || ' weighs ' || trim_scale(w.deviation_percent) || '% from theoretical',
        'Net ' || trim_scale(w.net_kg) || ' kg against ' || trim_scale(w.theoretical_kg) || ' kg theoretical (tolerance ' || trim_scale(w.tolerance_percent) || '%). Weight ' ||
          case when w.source = 'scale' then 'read from the scale.' else 'typed by hand.' end,
        'bundle', b.id, '/dispatches/bundles/weights', 'bundle-weight:' || b.id, c.actor_id);
    end if;
    return to_jsonb(w) - 'company_id' || jsonb_build_object('replayed', false);
  elsif p_command = 'share' then
    perform private.ap_keys(p_payload, array['days']);
    v_days := coalesce(private.ap9_int(p_payload, 'days', 'Days', 1, 365), 30);
    return (select jsonb_build_object('days', v_days, 'total', count(*), 'scale', count(*) filter (where source = 'scale'), 'manual', count(*) filter (where source = 'manual'),
        'flagged', count(*) filter (where flagged), 'unjudged', count(*) filter (where tolerance_percent is null or theoretical_kg is null),
        'scale_share_percent', case when count(*) > 0 then round(count(*) filter (where source = 'scale') * 100.0 / count(*), 1) end)
      from public.bundle_weight_captures where company_id = c.company_id and recorded_at >= now() - make_interval(days => v_days));
  elsif p_command = 'list' then
    perform private.ap_keys(p_payload, array['page', 'show']);
    with f as (select w2.id, row_number() over (order by w2.recorded_at desc, w2.id) k from public.bundle_weight_captures w2
      where w2.company_id = c.company_id and (coalesce(p_payload ->> 'show', 'flagged') = 'all' or (coalesce(p_payload ->> 'show', 'flagged') = 'flagged' and w2.flagged)
        or (p_payload ->> 'show' = 'manual' and w2.source = 'manual')))
    select coalesce((select jsonb_agg(to_jsonb(w2) - 'company_id' || jsonb_build_object('bundle_number', b2.bundle_number, 'recorded_by_name', (select full_name from public.app_users where id = w2.recorded_by)) order by f.k)
      from f join public.bundle_weight_captures w2 on w2.id = f.id join public.prepared_physical_bundles b2 on b2.id = w2.bundle_id
      where f.k > (v_page - 1) * 10 and f.k <= v_page * 10), '[]'), (select count(*) from f) into v_rows, v_total;
    return jsonb_build_object('rows', v_rows, 'page', v_page, 'total_count', v_total);
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_scale(text, jsonb) from public, anon;
grant execute on function public.ap_scale(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-034: propose reservations to waiting order lines when finished stock arrives
-- ---------------------------------------------------------------------------------------------------------------
-- Open order lines this batch could serve, with the same eligibility the stock allocation itself checks (released stock,
-- same piece length, alloy, temper and finish, one line per profile and finish on the order, no unassigned reservations)
-- and demand not already covered by stock or production.
create or replace function private.ap9_reservation_candidates(p_company uuid, p_batch uuid)
returns table(order_item_id uuid, order_id uuid, order_number text, customer text, promise date, priority text, remaining_kg numeric, kg_per_piece numeric)
language sql stable security definer set search_path = public, private as $$
  with b as (select * from public.profile_stock_batches where id = p_batch and company_id = p_company),
  lines as (
    select i.*, o.order_number, o.expected_dispatch_date, o.priority, coalesce(nullif(btrim(cu.company_name), ''), cu.customer_name) customer_name,
      coalesce(nullif(i.technical_spec_snapshot ->> 'alloy', ''), p.alloy) want_alloy, coalesce(nullif(i.technical_spec_snapshot ->> 'temper', ''), p.temper) want_temper
    from b join public.order_items i on i.company_id = p_company and i.profile_id = b.profile_id
      join public.orders o on o.id = i.order_id and o.company_id = p_company and o.deleted_at is null
        and o.current_stage not in ('cancelled', 'dispatched', 'delivered', 'closed', 'payment_pending')
      join public.customers cu on cu.id = o.customer_id
      join public.aluminium_profiles p on p.id = i.profile_id
    where i.quantity_pieces > 0 and i.quantity_kg > 0 and i.length_per_piece_m is not null
  )
  select l.id, l.order_id, l.order_number, l.customer_name, l.expected_dispatch_date, l.priority,
    (q ->> 'demand_kg')::numeric - (q ->> 'stock_covered_kg')::numeric - (q ->> 'production_committed_kg')::numeric, l.quantity_kg / l.quantity_pieces
  from lines l cross join b cross join lateral (select private.stock_line_quantities(p_company, l.id) q) qq
  where b.dealer_id is null and b.status in ('available', 'reserved') and b.qc_status in ('released', 'not_required')
    and abs(coalesce(b.piece_length_m, 0) - l.length_per_piece_m) <= 0.001
    and regexp_replace(lower(coalesce(b.alloy, '')), '[^a-z0-9]', '', 'g') <> '' and regexp_replace(lower(coalesce(b.temper, '')), '[^a-z0-9]', '', 'g') <> ''
    and regexp_replace(lower(b.alloy), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(l.want_alloy, '')), '[^a-z0-9]', '', 'g')
    and regexp_replace(lower(b.temper), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(l.want_temper, '')), '[^a-z0-9]', '', 'g')
    and coalesce(b.finish, 'mill_finish') = coalesce(l.finishing_type, 'mill_finish')
    and (select count(*) from public.order_items i2 where i2.company_id = p_company and i2.order_id = l.order_id and i2.profile_id = l.profile_id
      and coalesce(i2.finishing_type, 'mill_finish') = coalesce(l.finishing_type, 'mill_finish')) = 1
    and not exists (select 1 from public.profile_stock_reservations r where r.company_id = p_company and r.order_id = l.order_id and r.profile_id = l.profile_id
      and r.status in ('active', 'consumed') and not exists (select 1 from public.order_stock_allocations a where a.reservation_id = r.id))
    and (q ->> 'demand_kg')::numeric - (q ->> 'stock_covered_kg')::numeric - (q ->> 'production_committed_kg')::numeric > 0.001
$$;
revoke all on function private.ap9_reservation_candidates(uuid, uuid) from public, anon, authenticated;

-- Shares the batch's whole pieces between waiting lines by the shared priority policy (NOV-043: priority, then the
-- promised date). Each line gets its own proposal, so stores can accept one and leave another.
create or replace function private.ap9_propose_reservations(p_company uuid, p_batch uuid, p_run uuid)
returns integer language plpgsql security definer set search_path = public, private as $$
declare b public.profile_stock_batches%rowtype; v_bal jsonb; v_left integer; r record; v_pieces integer; v_id uuid; v_n integer := 0; v_code text;
begin
  select * into b from public.profile_stock_batches where id = p_batch and company_id = p_company;
  if b.id is null then return 0; end if;
  v_bal := private.profile_stock_balance(p_company, b.id);
  v_left := floor(coalesce((v_bal #>> '{available,pieces}')::numeric, 0))::integer;
  if v_left <= 0 then return 0; end if;
  select profile_code into v_code from public.aluminium_profiles where id = b.profile_id;
  for r in select * from private.ap9_reservation_candidates(p_company, b.id) x
    order by private.coordination_priority_rank(x.priority), x.promise nulls last, x.order_number, x.order_item_id loop
    exit when v_left <= 0;
    v_pieces := least(v_left, floor((r.remaining_kg + 0.001) / r.kg_per_piece)::integer);
    if v_pieces <= 0 then continue; end if;
    v_id := private.ap_proposal_create(p_company, 'stock.reservation', b.id::text || ':' || r.order_item_id::text,
      'Reserve ' || v_pieces || ' pcs of ' || coalesce(v_code, 'stock') || ' for ' || r.order_number,
      jsonb_build_object('batch_id', b.id, 'order_item_id', r.order_item_id, 'order_id', r.order_id, 'order_number', r.order_number, 'customer', r.customer,
        'pieces', v_pieces, 'kg', round(v_pieces * coalesce(b.total_weight_kg / nullif(b.quantity_pieces, 0), r.kg_per_piece), 3), 'profile_code', v_code,
        'bundle', b.bundle_number, 'finish', coalesce(b.finish, 'mill_finish'), 'piece_length_m', b.piece_length_m),
      jsonb_build_object('available_pieces', (v_bal #>> '{available,pieces}')::numeric, 'remaining_kg', round(r.remaining_kg, 3), 'promise', r.promise, 'priority', r.priority),
      'arrival-reserve-v1',
      'Stock ' || coalesce(b.bundle_number, 'batch') || ' arrived released; order ' || r.order_number || ' still needs ' || trim_scale(round(r.remaining_kg, 1)) || ' kg of this profile, finish and length'
        || case when r.promise is not null then ', promised ' || to_char(r.promise, 'DD Mon') else '' end || ' (' || coalesce(r.priority, 'normal') || ' priority).',
      0.9, array['owner', 'admin', 'inventory_manager', 'factory_manager', 'production_manager'], 72, p_run);
    if v_id is not null then v_n := v_n + 1; end if;
    v_left := v_left - v_pieces;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.ap9_propose_reservations(uuid, uuid, uuid) from public, anon, authenticated;

-- Any path that releases finished stock (QC release, cutting output, returns) gets the same proposal. Advisory: a failure
-- here never blocks the stock change; the hourly job retries.
create or replace function private.ap9_stock_arrival_trigger()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.dealer_id is null and new.status = 'available' and new.qc_status in ('released', 'not_required')
     and (tg_op = 'INSERT' or old.qc_status is distinct from new.qc_status or old.status is distinct from new.status) then
    begin
      perform private.ap9_propose_reservations(new.company_id, new.id, null);
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;
revoke all on function private.ap9_stock_arrival_trigger() from public, anon, authenticated;
drop trigger if exists zzz_ap9_stock_arrival on public.profile_stock_batches;
create trigger zzz_ap9_stock_arrival after insert or update of qc_status, status on public.profile_stock_batches
  for each row execute function private.ap9_stock_arrival_trigger();

create or replace function private.ap9_arrival_job(p_company uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r record; v_n integer := 0; v_p integer := 0;
begin
  for r in select id from public.profile_stock_batches where company_id = p_company and dealer_id is null and status = 'available' and qc_status in ('released', 'not_required')
    and greatest(created_at, updated_at, coalesce(qc_released_at, created_at)) >= now() - interval '7 days' order by created_at limit 500 loop
    v_n := v_n + 1; v_p := v_p + private.ap9_propose_reservations(p_company, r.id, p_run);
  end loop;
  return jsonb_build_object('examined', v_n, 'proposals', v_p, 'alerts', 0);
end;
$$;
revoke all on function private.ap9_arrival_job(uuid, uuid) from public, anon, authenticated;

create or replace function private.ap9_reservation_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_line uuid := (p_payload ->> 'order_item_id')::uuid; v_batch uuid := (p_payload ->> 'batch_id')::uuid; v_pieces integer; v_plan jsonb; v_row jsonb; v_page integer := 1; v_result jsonb;
begin
  if p_role not in ('owner', 'admin', 'inventory_manager', 'factory_manager', 'production_manager') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if (p_payload ->> 'order_item_id') is distinct from (p_proposal.payload ->> 'order_item_id') or (p_payload ->> 'batch_id') is distinct from (p_proposal.payload ->> 'batch_id') then
    raise exception 'AP: Only the pieces of a reservation proposal can be changed.';
  end if;
  v_pieces := private.ap9_int(p_payload, 'pieces', 'Pieces', 1, 1000000);
  if v_pieces is null then raise exception 'AP: Give the pieces to reserve.'; end if;
  -- The allocation rechecks stock, demand, quality and the reviewed balance under its own locks (stock_production_command).
  loop
    v_plan := public.stock_production_command('line.plan', jsonb_build_object('order_item_id', v_line, 'page', v_page));
    select value into v_row from jsonb_array_elements(v_plan -> 'stock') where value ->> 'id' = v_batch::text;
    exit when v_row is not null or jsonb_array_length(coalesce(v_plan -> 'stock', '[]')) < 10 or v_page >= 50;
    v_page := v_page + 1;
  end loop;
  if v_row is null then raise exception 'AP: This stock is no longer offered for the order line. Review the line''s stock plan.'; end if;
  if v_row ->> 'reason' is not null then raise exception 'AP: %.', v_row ->> 'reason'; end if;
  v_result := public.stock_production_command('stock.allocate', jsonb_build_object('id', gen_random_uuid(), 'order_item_id', v_line, 'batch_id', v_batch,
    'pieces', v_pieces, 'fingerprint', v_row ->> 'fingerprint', 'page', v_page));
  return v_result || jsonb_build_object('pieces', v_pieces, 'order_number', p_proposal.payload ->> 'order_number', 'href', '/orders/' || (p_proposal.payload ->> 'order_id'));
end;
$$;
revoke all on function private.ap9_reservation_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-048: kg/m and perimeter from the profile's DXF drawing (proposal to the profile master)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.pcda_master_alloys add column if not exists density_kg_m3 numeric(7,1);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pcda_master_alloys_density_check') then
    alter table public.pcda_master_alloys add constraint pcda_master_alloys_density_check check (density_kg_m3 is null or density_kg_m3 between 2500 and 3000);
  end if;
end $$;

create table if not exists public.profile_drawing_reads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.aluminium_profiles(id),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  storage_path text not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  units text not null check (units in ('mm', 'inch', 'unknown')),
  outer_area_mm2 numeric(14,4),
  void_area_mm2 numeric(14,4),
  net_area_mm2 numeric(14,4),
  outer_perimeter_mm numeric(14,4),
  void_count integer,
  entity_count integer,
  density_kg_m3 numeric(7,1),
  density_source text check (density_source in ('alloy_master', 'standard')),
  kg_per_m numeric(10,4),
  finishing_area_m2_per_m numeric(10,5),
  preview_svg text check (preview_svg is null or length(preview_svg) <= 300000),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  status text not null check (status in ('proposed', 'accepted', 'rejected', 'superseded', 'unreadable', 'no_density')),
  proposal_id uuid references public.proposals(id),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'unreadable') = (net_area_mm2 is null)),
  check (status in ('unreadable', 'no_density') or kg_per_m is not null)
);
create index if not exists profile_drawing_reads_profile_idx on public.profile_drawing_reads(company_id, profile_id, created_at desc);
create index if not exists profile_drawing_reads_proposal_idx on public.profile_drawing_reads(proposal_id) where proposal_id is not null;

-- Density of an alloy: the alloy master's value, else the standard handbook value for common wrought alloys, else none.
create or replace function private.ap9_density(p_company uuid, p_alloy text)
returns table(density numeric, source text) language sql stable security definer set search_path = public, private as $$
  select coalesce(m.density_kg_m3, s.d), case when m.density_kg_m3 is not null then 'alloy_master' when s.d is not null then 'standard' end
  from (select upper(btrim(coalesce(p_alloy, ''))) a) x
    left join public.pcda_master_alloys m on m.company_id = p_company and upper(btrim(m.value)) = x.a and m.density_kg_m3 is not null
    left join (values ('1050', 2705.0), ('1060', 2705.0), ('1100', 2710.0), ('3003', 2730.0), ('5052', 2680.0), ('6005', 2700.0), ('6005A', 2700.0), ('6060', 2700.0),
      ('6061', 2700.0), ('6063', 2700.0), ('6082', 2700.0), ('6351', 2710.0), ('7075', 2810.0)) s(a, d) on s.a = x.a
  limit 1
$$;
revoke all on function private.ap9_density(uuid, text) from public, anon, authenticated;

create or replace function private.ap9_read_json(x public.profile_drawing_reads, p_svg boolean)
returns jsonb language sql stable security definer set search_path = public, private as $$
  select (to_jsonb(x) - 'company_id' - case when p_svg then '' else 'preview_svg' end) || jsonb_build_object(
    'created_by_name', (select full_name from public.app_users where id = x.created_by),
    'profile', (select jsonb_build_object('id', p.id, 'profile_code', p.profile_code, 'alloy', p.alloy, 'section_weight_kg_per_m', p.section_weight_kg_per_m,
      'section_perimeter_mm', p.section_perimeter_mm, 'surface_area_per_meter_sqm', p.surface_area_per_meter_sqm) from public.aluminium_profiles p where p.id = x.profile_id),
    'proposal_status', (select status from public.proposals where id = x.proposal_id),
    'difference_percent', (select case when p.section_weight_kg_per_m > 0 and x.kg_per_m is not null then round((x.kg_per_m - p.section_weight_kg_per_m) / p.section_weight_kg_per_m * 100, 2) end
      from public.aluminium_profiles p where p.id = x.profile_id))
$$;
revoke all on function private.ap9_read_json(public.profile_drawing_reads, boolean) from public, anon, authenticated;

create or replace function public.ap_geometry(p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare c record; p public.aluminium_profiles%rowtype; x public.profile_drawing_reads%rowtype; g jsonb; v_outer numeric; v_void numeric; v_net numeric; v_per numeric; v_units text;
  d record; v_kgm numeric; v_status text; v_pid uuid; v_rows jsonb; v_alloy text;
begin
  select * into c from private.ap_ctx(array['owner', 'admin', 'production_manager', 'factory_manager', 'quality', 'sales_manager']);
  if p_command = 'draft' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'production_manager', 'factory_manager', 'quality']);
    perform private.ap_keys(p_payload, array['profile_id', 'file_name', 'storage_path', 'file_sha256', 'geometry', 'preview_svg']);
    select * into p from public.aluminium_profiles where id = private.ap_uuid(p_payload, 'profile_id') and company_id = c.company_id and deleted_at is null;
    if p.id is null then raise exception 'AP: Profile not found.'; end if;
    if coalesce(p_payload ->> 'storage_path', '') not like c.company_id::text || '/profile-drawings/%' or (p_payload ->> 'storage_path') like '%..%' then raise exception 'AP: Upload the drawing again.'; end if;
    if coalesce(p_payload ->> 'file_sha256', '') !~ '^[a-f0-9]{64}$' then raise exception 'AP: Upload the drawing again.'; end if;
    -- The preview is the generator's own shape only (one path of coordinates); anything else is refused, so no markup or
    -- script from a caller can be stored and shown to another person.
    if nullif(p_payload ->> 'preview_svg', '') is not null and (p_payload ->> 'preview_svg') !~
      '^<svg xmlns="http://www\.w3\.org/2000/svg" width="[0-9]{1,4}" height="[0-9]{1,4}" viewBox="[-0-9. ]{1,120}"><path d="[-MLZ0-9. ]+" fill="#9ca3af" fill-rule="evenodd" stroke="#111827" stroke-width="[0-9.]{1,20}"/></svg>$' then
      raise exception 'AP: The drawing preview could not be stored.';
    end if;
    g := p_payload -> 'geometry';
    if g is not null and jsonb_typeof(g) = 'object' and g ? 'outer_area_mm2' then
      v_units := coalesce(g ->> 'units', 'unknown');
      if v_units not in ('mm', 'inch', 'unknown') then raise exception 'AP: Unknown drawing units.'; end if;
      v_outer := nullif(g ->> 'outer_area_mm2', '')::numeric; v_void := coalesce(nullif(g ->> 'void_area_mm2', '')::numeric, 0); v_per := nullif(g ->> 'outer_perimeter_mm', '')::numeric;
      if v_outer is null or v_outer <= 0 or v_outer > 1000000 or v_void < 0 or v_void >= v_outer or v_per is null or v_per <= 0 or v_per > 100000 then
        raise exception 'AP: The drawing geometry is out of range. Check the drawing units.';
      end if;
      v_net := round(v_outer - v_void, 4);
    end if;
    v_alloy := coalesce((select value from public.pcda_master_alloys where id = p.alloy_id), p.alloy);
    select * into d from private.ap9_density(c.company_id, v_alloy);
    v_kgm := case when v_net is not null and d.density is not null then round(v_net * 1e-6 * d.density, 4) end;
    v_status := case when v_net is null then 'unreadable' when v_kgm is null then 'no_density' else 'proposed' end;
    update public.profile_drawing_reads set status = 'superseded' where company_id = c.company_id and profile_id = p.id and status in ('proposed', 'no_density');
    insert into public.profile_drawing_reads(company_id, profile_id, file_name, storage_path, file_sha256, units, outer_area_mm2, void_area_mm2, net_area_mm2, outer_perimeter_mm,
      void_count, entity_count, density_kg_m3, density_source, kg_per_m, finishing_area_m2_per_m, preview_svg, warnings, status, created_by)
      values (c.company_id, p.id, private.ap_text(p_payload ->> 'file_name', 'File name', 1, 200), p_payload ->> 'storage_path', p_payload ->> 'file_sha256', coalesce(v_units, case when jsonb_typeof(g) = 'object' and g ->> 'units' in ('mm', 'inch', 'unknown') then g ->> 'units' end, 'unknown'),
        case when v_net is not null then v_outer end, case when v_net is not null then v_void end, v_net, case when v_net is not null then round(v_per, 4) end,
        case when v_net is not null then private.ap9_int(g, 'void_count', 'Voids', 0, 1000) end, private.ap9_int(case when jsonb_typeof(g) = 'object' then g end, 'entity_count', 'Entities', 0, 1000000),
        d.density, d.source, v_kgm, case when v_net is not null then round(v_per / 1000, 5) end,
        nullif(p_payload ->> 'preview_svg', ''), case when jsonb_typeof(g) = 'object' and jsonb_typeof(g -> 'warnings') = 'array' then g -> 'warnings' else '[]'::jsonb end, v_status, c.actor_id)
      returning * into x;
    if v_status = 'proposed' then
      v_pid := private.ap_proposal_create(c.company_id, 'profile.geometry', p.id::text, 'Section weight ' || trim_scale(round(v_kgm, 3)) || ' kg/m from drawing for ' || p.profile_code,
        jsonb_build_object('read_id', x.id, 'profile_id', p.id, 'profile_code', p.profile_code, 'section_weight_kg_per_m', round(v_kgm, 3), 'section_perimeter_mm', round(v_per, 2),
          'finishing_area_m2_per_m', x.finishing_area_m2_per_m, 'current_kg_per_m', p.section_weight_kg_per_m, 'current_perimeter_mm', p.section_perimeter_mm, 'file_name', x.file_name),
        jsonb_build_object('net_area_mm2', v_net, 'outer_area_mm2', v_outer, 'void_area_mm2', v_void, 'void_count', x.void_count, 'density_kg_m3', d.density, 'density_source', d.source),
        'dxf-area-v1', 'Area ' || trim_scale(round(v_net, 2)) || ' mm² (outer less ' || coalesce(x.void_count, 0) || ' void(s)) x ' || trim_scale(d.density) || ' kg/m³ ('
          || case when d.source = 'alloy_master' then 'alloy master' else 'standard density for ' || coalesce(v_alloy, 'the alloy') end || '). Outer perimeter ' || trim_scale(round(v_per, 1)) || ' mm.',
        case when jsonb_array_length(x.warnings) = 0 then 0.9 else 0.6 end, array['owner', 'admin'], 24 * 14, null);
      update public.profile_drawing_reads set proposal_id = coalesce(v_pid, (select id from public.proposals where company_id = c.company_id and proposal_type = 'profile.geometry'
        and target_key = p.id::text and status = 'open' order by created_at desc limit 1)) where id = x.id returning * into x;
    end if;
    return private.ap9_read_json(x, false);
  elsif p_command = 'reads' then
    perform private.ap_keys(p_payload, array['profile_id']);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(private.ap9_read_json(r, false) order by r.created_at desc), '[]')
      from (select * from public.profile_drawing_reads where company_id = c.company_id and profile_id = private.ap_uuid(p_payload, 'profile_id') order by created_at desc limit 10) r),
      'density', (select to_jsonb(d2) from public.aluminium_profiles p2, private.ap9_density(c.company_id, coalesce((select value from public.pcda_master_alloys where id = p2.alloy_id), p2.alloy)) d2
        where p2.id = private.ap_uuid(p_payload, 'profile_id') and p2.company_id = c.company_id));
  elsif p_command = 'get' then
    perform private.ap_keys(p_payload, array['id']);
    select * into x from public.profile_drawing_reads where id = private.ap_uuid(p_payload, 'id') and company_id = c.company_id;
    if x.id is null then raise exception 'AP: Drawing read not found.'; end if;
    return private.ap9_read_json(x, true);
  elsif p_command = 'densities' then
    perform private.ap_keys(p_payload, array[]::text[]);
    return jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object('alloy', m.value, 'density_kg_m3', m.density_kg_m3) order by m.value), '[]')
      from public.pcda_master_alloys m where m.company_id = c.company_id and m.is_active));
  elsif p_command = 'set_density' then
    perform private.ap4_need(c.role, array['owner', 'admin', 'quality']);
    perform private.ap_keys(p_payload, array['alloy', 'density_kg_m3']);
    v_alloy := upper(btrim(coalesce(p_payload ->> 'alloy', '')));
    if v_alloy !~ '^[0-9]{4}[A-Z]?$' then raise exception 'AP: Enter the alloy as four digits, such as 6063.'; end if;
    update public.pcda_master_alloys set density_kg_m3 = private.ap4_num(p_payload, 'density_kg_m3', 'Density', 2500, 3000), updated_at = now()
      where company_id = c.company_id and upper(btrim(value)) = v_alloy;
    if not found then
      insert into public.pcda_master_alloys(company_id, value, description, density_kg_m3, created_by)
        values (c.company_id, v_alloy, 'Added with its density for drawing reads', private.ap4_num(p_payload, 'density_kg_m3', 'Density', 2500, 3000), c.actor_id);
    end if;
    return jsonb_build_object('alloy', v_alloy, 'density_kg_m3', private.ap4_num(p_payload, 'density_kg_m3', 'Density', 2500, 3000));
  end if;
  raise exception 'AP: Unknown request.';
end;
$$;
revoke all on function public.ap_geometry(text, jsonb) from public, anon;
grant execute on function public.ap_geometry(text, jsonb) to authenticated;

create or replace function private.ap9_geometry_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare x public.profile_drawing_reads%rowtype; p public.aluminium_profiles%rowtype; v_kgm numeric; v_per numeric; v_approval uuid;
begin
  if p_role not in ('owner', 'admin') then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into x from public.profile_drawing_reads where id = (p_proposal.payload ->> 'read_id')::uuid and company_id = p_company for update;
  if x.id is null or x.status <> 'proposed' then raise exception 'AP: A newer drawing read replaced this one.'; end if;
  select * into p from public.aluminium_profiles where id = x.profile_id and company_id = p_company for update;
  v_kgm := private.ap4_num(p_payload, 'section_weight_kg_per_m', 'Section weight', 0.001, 100);
  v_per := private.ap4_num(p_payload, 'section_perimeter_mm', 'Perimeter', 1, 100000);
  -- The master weight changes through the profile specification approval, which records the before and after values
  -- and the open work it affects (EXOS-AUD-021).
  if p.section_weight_kg_per_m is distinct from v_kgm then
    v_approval := private.approve_profile_spec_change(p.id, jsonb_build_object('section_weight_kg_per_m', v_kgm),
      'Section weight from die drawing ' || x.file_name || ' (drawing read ' || x.id || ')');
  end if;
  update public.aluminium_profiles set section_perimeter_mm = round(v_per, 2), surface_area_per_meter_sqm = round(v_per / 1000, 5), updated_at = now() where id = p.id;
  update public.profile_drawing_reads set status = 'accepted' where id = x.id;
  update public.profile_drawing_reads set status = 'superseded' where company_id = p_company and profile_id = p.id and id <> x.id and status in ('proposed', 'no_density');
  return jsonb_build_object('profile_id', p.id, 'section_weight_kg_per_m', v_kgm, 'section_perimeter_mm', round(v_per, 2), 'spec_approval_id', v_approval, 'href', '/profiles/' || p.id);
end;
$$;
revoke all on function private.ap9_geometry_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- AP-002 proposal types and AP-001 jobs
-- ---------------------------------------------------------------------------------------------------------------
alter table public.proposals drop constraint proposals_proposal_type_check;
alter table public.proposals add constraint proposals_proposal_type_check check(proposal_type in
  ('navigation.role_layout','period.close_month','series.adopt','production.expected_output','die.service_due','maintenance.pm_due','bank.receipt_match','freight.estimate','billet.shortage',
   'die.weight_drift','quote.reprice','stock.reorder','stock.reservation','profile.geometry'));

alter function private.ap_proposal_versions(uuid, text, text) rename to ap9_previous_proposal_versions;
create function private.ap_proposal_versions(p_company uuid, p_type text, p_target text) returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if p_type = 'stock.reservation' then
    return jsonb_build_object('line', private.stock_line_quantities(p_company, split_part(p_target, ':', 2)::uuid),
      'batch', (select jsonb_build_object('status', b.status, 'qc', b.qc_status, 'length', b.piece_length_m, 'finish', b.finish) from public.profile_stock_batches b
        where b.id = split_part(p_target, ':', 1)::uuid and b.company_id = p_company));
  elsif p_type = 'profile.geometry' then
    return (select jsonb_build_object('kgm', p.section_weight_kg_per_m, 'perimeter', p.section_perimeter_mm,
      'read', (select r.id from public.profile_drawing_reads r where r.company_id = p_company and r.profile_id = p.id and r.status = 'proposed' order by r.created_at desc limit 1))
      from public.aluminium_profiles p where p.id = p_target::uuid and p.company_id = p_company);
  end if;
  return private.ap9_previous_proposal_versions(p_company, p_type, p_target);
end;
$$;
revoke all on function private.ap_proposal_versions(uuid, text, text) from public, anon, authenticated;

alter function private.ap_proposal_editable(text) rename to ap9_previous_proposal_editable;
create function private.ap_proposal_editable(p_type text) returns text[] language sql immutable set search_path = public, private as $$
  select case p_type when 'stock.reservation' then array['pieces'] when 'profile.geometry' then array['section_weight_kg_per_m', 'section_perimeter_mm']
    else private.ap9_previous_proposal_editable(p_type) end
$$;
revoke all on function private.ap_proposal_editable(text) from public, anon, authenticated;

alter function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) rename to ap9_previous_proposal_apply;
create function private.ap_proposal_apply(p_company uuid, p_actor uuid, p_role text, p_proposal public.proposals, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_proposal.proposal_type = 'stock.reservation' then return private.ap9_reservation_apply(p_company, p_actor, p_role, p_proposal, p_payload); end if;
  if p_proposal.proposal_type = 'profile.geometry' then return private.ap9_geometry_apply(p_company, p_actor, p_role, p_proposal, p_payload); end if;
  return private.ap9_previous_proposal_apply(p_company, p_actor, p_role, p_proposal, p_payload);
end;
$$;
revoke all on function private.ap_proposal_apply(uuid, uuid, text, public.proposals, jsonb) from public, anon, authenticated;

alter function private.ap_job_registry() rename to ap9_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text, schedule text, label text, description text)
language sql immutable set search_path = public, private as $$
  select * from private.ap9_previous_job_registry() union all values
    ('stock.arrival_reservations', 'hourly', 'Propose reservations for arriving stock', 'Proposes reserving newly released finished stock to waiting order lines of the same profile, finish and length, by priority and promised date.'),
    ('cash.forecast_snapshot', 'nightly', 'Keep the weekly cash forecast', 'Keeps the first forecast of each week so accounts can compare it with what actually came in and went out.')
$$;
revoke all on function private.ap_job_registry() from public, anon, authenticated;

alter function private.ap_job_execute(uuid, text, uuid) rename to ap9_previous_job_execute;
create function private.ap_job_execute(p_company uuid, p_job text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_job = 'stock.arrival_reservations' then return private.ap9_arrival_job(p_company, p_run); end if;
  if p_job = 'cash.forecast_snapshot' then return private.ap9_cash_snapshot_job(p_company, p_run); end if;
  return private.ap9_previous_job_execute(p_company, p_job, p_run);
end;
$$;
revoke all on function private.ap_job_execute(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Row security: every new table is company-scoped and readable by its working roles; writes go through the gateways.
-- A language preference is readable only by its owner.
-- ---------------------------------------------------------------------------------------------------------------
do $$ declare t text; roles text; begin
  foreach t in array array['rate_cards', 'scrap_grades', 'scrap_offers', 'scrap_sales', 'scrap_sale_allocations', 'scrap_sale_receipts', 'scrap_invoice_counters',
    'customer_weight_tolerances', 'weight_difference_notes', 'weight_debit_note_counters', 'cash_forecast_settings', 'cash_fixed_expenses', 'cash_one_offs', 'cash_forecast_snapshots',
    'quote_enquiries', 'enquiry_code_mappings', 'register_templates', 'register_captures', 'register_capture_rows', 'bundle_weight_captures', 'profile_drawing_reads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    roles := case
      when t = 'rate_cards' then 'array[''owner'',''admin'',''sales_manager'',''sales'',''accounts'']'
      when t = 'scrap_invoice_counters' then 'array[''owner'',''admin'',''accounts'']'
      when t like 'scrap_%' then 'array[''owner'',''admin'',''accounts'',''factory_manager'',''inventory_manager'',''production_manager'']'
      when t in ('customer_weight_tolerances', 'weight_difference_notes', 'weight_debit_note_counters') then 'array[''owner'',''admin'',''accounts'',''sales_manager'',''sales'',''dispatch_manager'']'
      when t like 'cash_%' then 'array[''owner'',''admin'',''accounts'']'
      when t in ('quote_enquiries', 'enquiry_code_mappings') then 'array[''owner'',''admin'',''sales_manager'',''sales'']'
      when t like 'register_%' then 'array[''owner'',''admin'',''factory_manager'',''production_manager'',''production'']'
      when t = 'bundle_weight_captures' then 'array[''owner'',''admin'',''factory_manager'',''dispatch_manager'',''dispatch'',''inventory_manager'',''quality'']'
      else 'array[''owner'',''admin'',''production_manager'',''factory_manager'',''quality'',''sales_manager'']' end;
    execute format('drop policy if exists ap9_read on public.%I', t);
    execute format('create policy ap9_read on public.%I for select to authenticated using (company_id = (select public.get_current_user_company_id()) and (select public.get_current_user_role()) = any(%s))', t, roles);
  end loop;
end $$;
alter table public.user_language_preferences enable row level security;
revoke all on public.user_language_preferences from public, anon, authenticated;
drop policy if exists ap9_own_language on public.user_language_preferences;
create policy ap9_own_language on public.user_language_preferences for select to authenticated using (company_id = (select public.get_current_user_company_id()) and user_id = (select auth.uid()));

commit;
