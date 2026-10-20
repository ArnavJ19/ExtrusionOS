-- Align quote->order conversion status gate with the application rule.
-- Previously the RPC accepted both 'customer_approved' and 'approved_for_sending',
-- while convertQuoteToOrderAction (and the product rule) only permit conversion of
-- a customer-approved quote. This tightens the server-side check so the RPC cannot
-- be used (e.g. via a direct call) to convert a not-yet-customer-approved quote.
-- Body is otherwise identical to 20260715000000_atomic_business_workflows.sql.

create or replace function private.convert_quote_to_order_atomic(
  p_quote_id uuid,
  p_order jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_quote public.quotes%rowtype;
  v_existing_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_order jsonb;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner','admin','sales','sales_manager') then
    raise exception 'Permission denied for quote conversion' using errcode = '42501';
  end if;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Quote not found for this company'; end if;

  select id into v_existing_id
  from public.orders
  where company_id = v_company_id and quote_id = p_quote_id
  order by created_at
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  if v_quote.status <> 'customer_approved' then
    raise exception 'Only customer-approved quotes can be converted to orders';
  end if;
  if not exists (
    select 1 from public.quote_items where company_id = v_company_id and quote_id = p_quote_id
  ) then
    raise exception 'Quote has no line items to convert';
  end if;
  if exists (
    select 1 from public.quote_items
    where company_id = v_company_id and quote_id = p_quote_id
      and coalesce(drawing_approval_status, 'Pending') <> 'Approved'
  ) then
    raise exception 'Every quote line requires an approved drawing before conversion';
  end if;

  v_order := private.keep_jsonb_keys(p_order, array['order_date','priority','order_value'])
    || jsonb_build_object(
      'company_id', v_company_id,
      'quote_id', p_quote_id,
      'customer_id', v_quote.customer_id,
      'dealer_id', coalesce(private.get_current_user_dealer_id(), v_quote.dealer_id),
      'current_stage', 'order_confirmed',
      'created_by', auth.uid()
    );
  v_order := v_order || jsonb_build_object(
    'order_number', private.next_business_number_locked(
      'public.orders'::regclass,
      'order_number',
      v_company_id,
      'O',
      coalesce(nullif(v_order ->> 'order_date', '')::date, current_date)
    )
  );
  v_order_id := private.insert_jsonb_row('public.orders'::regclass, v_order);

  for v_item in
    select to_jsonb(qi) from public.quote_items qi
    where qi.company_id = v_company_id and qi.quote_id = p_quote_id
    order by qi.created_at
  loop
    perform private.insert_jsonb_row(
      'public.order_items'::regclass,
      (v_item - array['id','company_id','order_id','created_at','updated_at'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'order_id', v_order_id,
          'source_record_id', p_quote_id,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = p_quote_id and company_id = v_company_id;
  return v_order_id;
end;
$$;
