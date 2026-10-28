-- EOS 86: recorded commercial totals. EOS 87: exact reviewed quotation conversion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function private.commercial_actor(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public, private as $$
declare v_user public.app_users%rowtype;
begin
  select * into v_user from public.app_users where id = auth.uid() and is_active;
  if not found or v_user.company_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_user.role::text like 'dealer%' or private.get_current_user_dealer_id() is not null
    or not coalesce(v_user.role::text = any(p_roles),false) then
    raise exception 'This action is not permitted for your role' using errcode='42501';
  end if;
  return v_user.company_id;
end;
$$;
revoke all on function private.commercial_actor(text[]) from public, anon, authenticated;

create function private.commercial_quote_fingerprint(p_quote public.quotes) returns text
language sql stable security definer set search_path = public, private as $$
  select md5(to_jsonb(p_quote)::text || coalesce((select jsonb_agg(to_jsonb(i) order by i.id)::text
    from public.quote_items i where i.company_id=p_quote.company_id and i.quote_id=p_quote.id),'[]'));
$$;
revoke all on function private.commercial_quote_fingerprint(public.quotes) from public, anon, authenticated;

create table public.quote_conversion_reviews (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  quote_id uuid not null references public.quotes(id),
  order_id uuid not null references public.orders(id),
  revision_number integer not null,
  fingerprint text not null,
  accepted_snapshot jsonb not null,
  actor_id uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique(company_id,quote_id), unique(company_id,order_id)
);
create index quote_conversion_reviews_company_idx on public.quote_conversion_reviews(company_id,created_at);
create index quote_conversion_reviews_quote_idx on public.quote_conversion_reviews(quote_id);
create index quote_conversion_reviews_order_idx on public.quote_conversion_reviews(order_id);
create index quote_conversion_reviews_actor_idx on public.quote_conversion_reviews(actor_id);
alter table public.quote_conversion_reviews enable row level security;
revoke all on public.quote_conversion_reviews from public,anon,authenticated;

create function private.keep_commercial_history() returns trigger
language plpgsql set search_path = public, private as $$
begin raise exception 'Recorded commercial history cannot be changed'; end;
$$;
revoke all on function private.keep_commercial_history() from public,anon,authenticated;
create trigger keep_quote_conversion_reviews before update or delete on public.quote_conversion_reviews
for each row execute function private.keep_commercial_history();

create function private.reconcile_draft_quote_tax() returns trigger
language plpgsql security definer set search_path=public,private as $$
begin
  if new.status in ('draft','internal_review') and exists(select 1 from public.quote_items where company_id=new.company_id and quote_id=new.id) then
    select round(sum(line_total_before_gst),2),sum(round(line_total_before_gst*coalesce(gst_percent,new.gst_percent)/100,2))
      into new.subtotal,new.gst_amount from public.quote_items where company_id=new.company_id and quote_id=new.id;
    new.total_before_gst:=new.subtotal;new.grand_total:=new.subtotal+new.gst_amount;
  end if;
  return new;
end;
$$;
revoke all on function private.reconcile_draft_quote_tax() from public,anon,authenticated;
create trigger zz_reconcile_draft_quote_tax before update of subtotal,gst_percent,gst_amount,grand_total on public.quotes
for each row execute function private.reconcile_draft_quote_tax();

create function public.commercial_review_command(p_command text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_company uuid; v_quote public.quotes%rowtype; v_order uuid;
  v_existing public.quote_conversion_reviews%rowtype; v_items jsonb;
  v_net numeric; v_tax numeric; v_cost numeric; v_count integer; v_fingerprint text;
begin
  v_company := private.commercial_actor(array['owner','admin','sales','sales_manager','accounts','viewer']);
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_payload - array['quote_id','request_id','fingerprint'] <> '{}'::jsonb then
    raise exception 'Invalid commercial review request';
  end if;
  if p_command not in ('quote.review','quote.convert') then raise exception 'Invalid commercial review request'; end if;
  if p_command='quote.convert' then
    perform private.commercial_actor(array['owner','admin','sales','sales_manager']);
    if nullif(p_payload->>'request_id','') is null then raise exception 'A request identity is required'; end if;
  end if;
  select * into v_quote from public.quotes where company_id=v_company and id=(p_payload->>'quote_id')::uuid for update;
  if not found then raise exception 'Quotation is unavailable'; end if;
  if p_command='quote.convert' then
    select * into v_existing from public.quote_conversion_reviews where company_id=v_company and id=(p_payload->>'request_id')::uuid;
    if found then
      if v_existing.quote_id<>v_quote.id or v_existing.fingerprint is distinct from p_payload->>'fingerprint' then
        raise exception 'That request identity was used for different details';
      end if;
      return jsonb_build_object('order_id',v_existing.order_id,'revision_number',v_existing.revision_number,'replayed',true);
    end if;
    select id into v_order from public.orders where company_id=v_company and quote_id=v_quote.id order by created_at,id limit 1;
    if v_order is not null then
      return jsonb_build_object('order_id',v_order,'replayed',true);
    end if;
    if v_quote.status<>'customer_approved' then raise exception 'Only customer-approved quotations can be converted'; end if;
  end if;
  v_fingerprint := private.commercial_quote_fingerprint(v_quote);
  select count(*),coalesce(sum(line_total_before_gst),0),
    coalesce(sum(round(line_total_before_gst*coalesce(gst_percent,v_quote.gst_percent)/100,2)),0),
    coalesce(sum(line_subtotal),0),coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'profile_id',profile_id,'description',item_description,'pieces',quantity_pieces,'cut_length_m',length_per_piece_m,
      'physical_kg',total_weight_kg,'billing_kg',billing_weight_kg,'net',line_total_before_gst,
      'gst_percent',coalesce(gst_percent,v_quote.gst_percent),'tax',round(line_total_before_gst*coalesce(gst_percent,v_quote.gst_percent)/100,2),
      'invoice_rate_per_kg',net_rate,'separate_charges',charges_billed_separately,
      'costing_complete',costing_complete) order by created_at,id),'[]')
    into v_count,v_net,v_tax,v_cost,v_items from public.quote_items where company_id=v_company and quote_id=v_quote.id;
  if p_command='quote.review' then
    return jsonb_build_object('quote_id',v_quote.id,'quote_number',v_quote.quote_number,'revision_number',v_quote.revision_number,
      'updated_at',v_quote.updated_at,'status',v_quote.status,'fingerprint',v_fingerprint,'items',v_items,
      'line_count',v_count,'subtotal',v_net,'tax',v_tax,'grand_total',v_net+v_tax,'recorded_total',v_quote.grand_total,
      'difference',round(v_quote.grand_total-v_net-v_tax,2),'currency','INR',
      'can_convert',private.get_current_user_role() in ('owner','admin','sales','sales_manager') and v_quote.status='customer_approved',
      'existing_order_id',(select id from public.orders where company_id=v_company and quote_id=v_quote.id order by created_at,id limit 1))
      || case when private.get_current_user_role() in ('owner','admin') then
        jsonb_build_object('cost',v_cost,'profit',v_net-v_cost,'margin_percent',case when v_net>0 then round((v_net-v_cost)*100/v_net,2) else null end)
        else '{}'::jsonb end;
  end if;
  if p_payload->>'fingerprint' is distinct from v_fingerprint then raise exception 'The quotation changed. Review the current version before conversion'; end if;
  if v_count=0 or exists(select 1 from public.quote_items where company_id=v_company and quote_id=v_quote.id and costing_complete is distinct from true)
    then raise exception 'Complete the costing of every quotation line'; end if;
  if abs(v_quote.grand_total-v_net-v_tax)>0.01 then raise exception 'Commercial totals do not reconcile. Revise the quotation before conversion'; end if;
  v_order := private.create_order_from_quote_with_dealer_workflow_atomic(v_quote.id,null,private.ist_today(),null,'normal',0,null,'queue',null);
  insert into public.quote_conversion_reviews(id,company_id,quote_id,order_id,revision_number,fingerprint,accepted_snapshot,actor_id)
  values((p_payload->>'request_id')::uuid,v_company,v_quote.id,v_order,v_quote.revision_number,v_fingerprint,
    jsonb_build_object('quote',to_jsonb(v_quote),'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.quote_items i where i.company_id=v_company and i.quote_id=v_quote.id)),auth.uid());
  return jsonb_build_object('order_id',v_order,'revision_number',v_quote.revision_number,'replayed',false);
end;
$$;
revoke all on function public.commercial_review_command(text,jsonb) from public,anon;
grant execute on function public.commercial_review_command(text,jsonb) to authenticated;
commit;
