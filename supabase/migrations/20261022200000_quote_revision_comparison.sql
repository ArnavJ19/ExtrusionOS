-- UPGRADE_EOS feature 25: revision comparison for quotations.
--
-- quote_revisions.snapshot_json holds the complete quote and quote_items rows, including
-- billet rates, conversion charges, margins and internal notes. The original read policy let
-- every company user (viewer, production, dispatch and dealer users, including other dealers'
-- quotations) read it directly. This migration:
--   * restricts direct revision reads to the metadata columns and to quotes the reader may see;
--   * serves comparisons through quote_revision_compare(), which applies the same role
--     projection as quotes_authorized / quote_items_authorized to both snapshots and the
--     current version.
-- No revision rows are changed or removed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Column-level privilege: the list on the quote page reads metadata only.
revoke select on public.quote_revisions from authenticated, anon;
grant select (id, company_id, quote_id, revision_number, revised_by, revised_at, reason, pdf_url, updated_at)
  on public.quote_revisions to authenticated;

drop policy if exists "quote revisions tenant read" on public.quote_revisions;
create policy "quote revisions tenant read" on public.quote_revisions
  for select to authenticated
  using (
    company_id = private.get_current_user_company_id()
    and exists (
      select 1 from public.quotes q
      where q.id = quote_revisions.quote_id
        and q.company_id = private.get_current_user_company_id()
        and private.get_current_user_role() in ('owner','admin','sales_manager','sales','accounts','viewer','dealer_admin','dealer_staff')
        and (private.get_current_user_role() not in ('dealer_admin','dealer_staff') or q.dealer_id = private.get_current_user_dealer_id())
    )
  );

-- Keys each projection level may see. Mirrors quotes_authorized and quote_items_authorized.
create or replace function private.quote_compare_keys(p_kind text, p_level text)
returns text[] language sql immutable set search_path = public, private as $$
select case
  when p_kind = 'header' then
    array['customer_id','quote_date','valid_until','status','terms_and_conditions','delivery_timeline','payment_terms',
          'revision_number','low_margin_approval_required','approved_by','approved_at','sent_at','customer_decision_at','updated_at']
    || case when p_level <> 'dealer' then array['notes'] else array[]::text[] end
    || case when p_level in ('price','cost','dealer') then array['subtotal','total_before_gst','gst_percent','gst_amount','grand_total'] else array[]::text[] end
    || case when p_level = 'cost' then array['total_margin_amount','estimated_profit_amount','estimated_profit_percent','approval_notes'] else array[]::text[] end
  else
    array['profile_id','die_id','item_description','section_code','section_name','customer_component_code','quantity_pieces',
          'length_per_piece_m','total_meters','section_weight_kg_per_m','total_weight_kg','quantity_kg','billing_weight_kg',
          'finishing_type','finishing_charge_type','expected_recovery_percent','drawing_revision','created_at']
    || case when p_level in ('price','cost','dealer') then array['price_per_kg','price_per_meter','line_total_before_gst','sales_price_override','discount','net_rate','final_line_value'] else array[]::text[] end
    || case when p_level = 'cost' then array['billet_rate_per_kg','conversion_charge_per_kg','finishing_charge','die_charge','packing_charge',
          'transport_charge','other_charges','margin_percent','line_subtotal','raw_material_cost','conversion_cost','finishing_cost'] else array[]::text[] end
  end;
$$;
revoke all on function private.quote_compare_keys(text, text) from public, anon, authenticated;

create or replace function private.quote_compare_project(p_row jsonb, p_keys text[])
returns jsonb language sql immutable set search_path = public, private as $$
select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
from jsonb_each(coalesce(p_row, '{}'::jsonb)) e
where e.key = any(p_keys);
$$;
revoke all on function private.quote_compare_project(jsonb, text[]) from public, anon, authenticated;

-- p_from / p_to are revision numbers; null means the current (live) version.
create or replace function public.quote_revision_compare(p_quote_id uuid, p_from integer, p_to integer)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_dealer uuid := private.get_current_user_dealer_id();
  v_quote public.quotes%rowtype;
  v_level text;
  v_versions jsonb := '[]'::jsonb;
  v_side jsonb;
  v_result jsonb := '{}'::jsonb;
  v_target integer;
  v_label text;
  v_revision public.quote_revisions%rowtype;
  v_items jsonb;
  v_order record;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role is null or v_role not in ('owner','admin','sales_manager','sales','accounts','viewer','dealer_admin','dealer_staff') then
    raise exception 'Not permitted to compare quotation versions' using errcode = '42501';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id and company_id = v_company and deleted_at is null;
  if not found or (v_role in ('dealer_admin','dealer_staff') and v_quote.dealer_id is distinct from v_dealer) then
    raise exception 'Quotation is unavailable';
  end if;
  v_level := case
    when v_role in ('owner','admin','accounts') then 'cost'
    when v_role in ('sales_manager','sales') then 'price'
    when v_role in ('dealer_admin','dealer_staff') then 'dealer'
    else 'basic' end;
  if (p_from is not null and (p_from < 0 or p_from >= v_quote.revision_number))
     or (p_to is not null and (p_to < 0 or p_to >= v_quote.revision_number))
     or p_from is not distinct from p_to then
    raise exception 'Choose two different recorded versions';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'revision_number', r.revision_number, 'revised_at', r.revised_at, 'reason', r.reason,
      'status', r.snapshot_json -> 'quote' ->> 'status') order by r.revision_number), '[]'::jsonb)
    into v_versions
  from public.quote_revisions r where r.company_id = v_company and r.quote_id = v_quote.id;

  foreach v_label in array array['from','to'] loop
    v_target := case when v_label = 'from' then p_from else p_to end;
    if v_target is null then
      select coalesce(jsonb_agg(private.quote_compare_project(to_jsonb(i), private.quote_compare_keys('item', v_level)) order by i.created_at, i.id), '[]'::jsonb)
        into v_items
      from public.quote_items i where i.company_id = v_company and i.quote_id = v_quote.id;
      v_side := jsonb_build_object(
        'kind', 'current', 'revision_number', v_quote.revision_number, 'recorded_at', v_quote.updated_at,
        'superseded_at', null, 'superseded_by', null, 'reason', null,
        'header', private.quote_compare_project(to_jsonb(v_quote), private.quote_compare_keys('header', v_level)),
        'items', v_items);
    else
      select * into v_revision from public.quote_revisions where company_id = v_company and quote_id = v_quote.id and revision_number = v_target;
      if not found then raise exception 'That version was not recorded'; end if;
      if jsonb_typeof(v_revision.snapshot_json -> 'items') <> 'array' or jsonb_typeof(v_revision.snapshot_json -> 'quote') <> 'object'
         or jsonb_array_length(v_revision.snapshot_json -> 'items') > 500 then
        raise exception 'That recorded version cannot be compared';
      end if;
      select coalesce(jsonb_agg(private.quote_compare_project(e.value, private.quote_compare_keys('item', v_level)) order by e.ordinality), '[]'::jsonb)
        into v_items
      from jsonb_array_elements(v_revision.snapshot_json -> 'items') with ordinality e;
      v_side := jsonb_build_object(
        'kind', 'snapshot', 'revision_number', v_revision.revision_number,
        'recorded_at', v_revision.snapshot_json -> 'quote' -> 'updated_at',
        'superseded_at', v_revision.revised_at,
        'superseded_by', (select nullif(full_name, '') from public.app_users u where u.id = v_revision.revised_by and u.company_id = v_company),
        'reason', v_revision.reason,
        'header', private.quote_compare_project(v_revision.snapshot_json -> 'quote', private.quote_compare_keys('header', v_level)),
        'items', v_items);
    end if;
    v_side := v_side || jsonb_build_object('approved_by_name',
      (select nullif(full_name, '') from public.app_users u where u.company_id = v_company and u.id::text = v_side -> 'header' ->> 'approved_by'));
    v_result := v_result || jsonb_build_object(v_label, v_side);
  end loop;

  select o.order_number, o.created_at into v_order
  from public.orders o where o.company_id = v_company and o.quote_id = v_quote.id
  order by o.created_at limit 1;

  return v_result || jsonb_build_object(
    'level', v_level,
    'quote', jsonb_build_object('id', v_quote.id, 'quote_number', v_quote.quote_number, 'status', v_quote.status, 'current_revision', v_quote.revision_number),
    'versions', v_versions,
    'linked_order', case when v_order.order_number is null then null else jsonb_build_object('order_number', v_order.order_number, 'created_at', v_order.created_at) end);
end;
$$;
revoke all on function public.quote_revision_compare(uuid, integer, integer) from public, anon;
grant execute on function public.quote_revision_compare(uuid, integer, integer) to authenticated;

commit;
