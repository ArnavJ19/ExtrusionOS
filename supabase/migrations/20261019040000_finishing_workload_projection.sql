-- R20 local candidate only; not applied. Requires the reconciled prerequisite chain.
begin;

create or replace function public.get_finishing_workload(
  p_order_id uuid default null,p_production_job_id uuid default null,p_finishing_job_id uuid default null,
  p_status text default '',p_search text default '',p_sort text default 'planned_date',p_direction text default 'asc',p_page integer default 1
)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare
  v_company uuid:=private.get_current_user_company_id();v_result jsonb;
  v_sort text:=coalesce(nullif(p_sort,''),'planned_date');v_direction text:=coalesce(nullif(p_direction,''),'asc');
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501';end if;
  if coalesce(private.get_current_user_role(),'') not in ('owner','admin','factory_manager','production_manager','production','quality','viewer') then
    raise exception 'Permission denied for finishing workload' using errcode='42501';end if;
  if p_page is null or p_page<1 or p_page>100000000 then raise exception 'Invalid finishing page';end if;
  if coalesce(p_status,'') not in ('','planned','sent_to_vendor','in_process','received','completed','rejected','not_required')
    or v_sort not in ('planned_date','created_at','order_number','status','input_weight_kg','output_weight_kg','rejection_weight_kg')
    or v_direction not in ('asc','desc') or length(coalesce(p_search,''))>100 then raise exception 'Invalid finishing filters';end if;

  -- All totals, preview rows, exact retry links and the database page share this statement.
  with recursive scoped as materialized (
    select f.*,j.id source_job_id,j.company_id source_company,j.order_id source_order,j.status source_status,
      j.finishing_type source_finish,j.actual_quantity_kg source_output,o.id verified_order,
      o.order_number,coalesce(c.company_name,c.customer_name) customer_name,j.job_number,v.vendor_name,v.id verified_vendor,o.customer_id source_customer,c.id verified_customer
    from public.finishing_jobs f
    left join public.production_jobs j on j.id=f.production_job_id and j.company_id=v_company
    left join public.orders o on o.id=f.order_id and o.company_id=v_company
    left join public.customers c on c.id=o.customer_id and c.company_id=v_company
    left join public.vendors v on v.id=f.vendor_id and v.company_id=v_company
    where f.company_id=v_company and (p_order_id is null or f.order_id=p_order_id)
      and (p_production_job_id is null or f.production_job_id=p_production_job_id)
      and (p_finishing_job_id is null or f.production_job_id=(select selected.production_job_id from public.finishing_jobs selected
        where selected.id=p_finishing_job_id and selected.company_id=v_company))
  ), children as materialized (
    select retry_of_finishing_job_id parent_id,count(*) child_count,sum(input_weight_kg) retry_input,
      jsonb_agg(jsonb_build_object('id',id,'status',status,'input_weight_kg',input_weight_kg) order by id)->0 corrective_retry
    from scoped where retry_of_finishing_job_id is not null group by retry_of_finishing_job_id
  ), linked as materialized (
    select s.*,parent.id parent_id,parent.company_id parent_company,parent.order_id parent_order,
      parent.production_job_id parent_job,parent.finishing_type parent_finish,parent.status parent_status,
      parent.input_weight_kg parent_input,parent.output_weight_kg parent_output,parent.rejection_weight_kg parent_rejection,
      coalesce(children.child_count,0) child_count,children.corrective_retry,children.retry_input
    from scoped s left join scoped parent on parent.id=s.retry_of_finishing_job_id left join children on children.parent_id=s.id
  ), reachable(id) as (
    select id from scoped where retry_of_finishing_job_id is null
    union
    select child.id from scoped child join reachable parent on child.retry_of_finishing_job_id=parent.id
  ), source_totals as (
    select production_job_id,sum(input_weight_kg) filter(where retry_of_finishing_job_id is null) root_input,
      sum(output_weight_kg) filter(where status in ('completed','rejected')) accepted_output,max(source_output) captured_output
    from scoped group by production_job_id
  ), checked as (
    select coalesce(bool_and(coalesce(source_job_id is not null and verified_order is not null and source_company=company_id
      and source_order=order_id and source_status='completed' and source_finish=finishing_type and source_output>0 and source_output::text not in ('NaN','Infinity','-Infinity')
      and (vendor_id is null or verified_vendor is not null) and (source_customer is null or verified_customer is not null)
      and status in ('planned','sent_to_vendor','in_process','received','completed','rejected','not_required')
      and input_weight_kg>0 and input_weight_kg::text not in ('NaN','Infinity','-Infinity')
      and coalesce(output_weight_kg,0)>=0 and coalesce(output_weight_kg,0)::text not in ('NaN','Infinity','-Infinity')
      and coalesce(rejection_weight_kg,0)>=0 and coalesce(rejection_weight_kg,0)::text not in ('NaN','Infinity','-Infinity')
      and coalesce(output_weight_kg,0)+coalesce(rejection_weight_kg,0)<=input_weight_kg+0.01
      and child_count<=1
      and (status not in ('completed','rejected') or (output_weight_kg is not null and rejection_weight_kg is not null
        and output_weight_kg+rejection_weight_kg<=input_weight_kg+0.01
        and (output_weight_kg=0 or (received_date is not null and received_date<=(now() at time zone 'Asia/Kolkata')::date
          and (sent_date is null or received_date>=sent_date)))))
      and (status<>'not_required' or (coalesce(output_weight_kg,0)=0 and coalesce(rejection_weight_kg,0)=0))
      and (retry_of_finishing_job_id is null or (parent_id is not null and parent_company=company_id and parent_order=order_id
        and parent_job=production_job_id and parent_finish=finishing_type and parent_status='rejected'
        and abs(input_weight_kg-least(parent_rejection,greatest(parent_input-coalesce(parent_output,0),0)))<=0.01)),false)),true)
      and (select count(*) from reachable)=(select count(*) from scoped)
      -- A malformed child outside the selected scope must not make its source retryable.
      and not exists(select 1 from public.finishing_jobs child join scoped parent on child.retry_of_finishing_job_id=parent.id
        where child.company_id is distinct from parent.company_id or child.order_id is distinct from parent.order_id
          or child.production_job_id is distinct from parent.production_job_id or child.finishing_type is distinct from parent.finishing_type)
      and not exists(select 1 from source_totals where coalesce(root_input,0)>captured_output+0.001
        or coalesce(accepted_output,0)>captured_output+0.001) integrity_ok
    from linked
  ), disposition as materialized (
    select l.*,case when status in ('completed','rejected') then greatest(rejection_weight_kg-coalesce(retry_input,0),0) else 0 end remaining_rejected_kg,
      status='rejected' and child_count=0 and least(rejection_weight_kg,greatest(input_weight_kg-coalesce(output_weight_kg,0),0))>0 can_retry
    from linked l
  ), totals as (
    select count(*) scope_count,count(*) filter(where status in ('planned','sent_to_vendor','in_process','received')) active_count,
      coalesce(sum(input_weight_kg) filter(where retry_of_finishing_job_id is null),0) original_input_kg,
      coalesce(sum(output_weight_kg) filter(where status in ('completed','rejected')),0) accepted_output_kg,
      coalesce(sum(input_weight_kg) filter(where status in ('planned','sent_to_vendor','in_process','received')),0) pending_input_kg,
      coalesce(sum(input_weight_kg) filter(where status in ('sent_to_vendor','in_process')),0) at_vendor_input_kg,
      coalesce(sum(input_weight_kg) filter(where status='not_required'),0) not_required_input_kg,
      coalesce(sum(remaining_rejected_kg),0) remaining_rejected_kg,count(*) filter(where can_retry) retry_eligible_count
    from disposition
  ), projected as materialized (
    select d.*,jsonb_build_object('id',id,'company_id',company_id,'order_id',order_id,'production_job_id',production_job_id,
      'finishing_type',finishing_type,'status',status,'color_code',color_code,'shade_name',shade_name,'vendor_id',vendor_id,
      'planned_date',planned_date,'sent_date',sent_date,'received_date',received_date,'created_at',created_at,'updated_at',updated_at,
      'input_weight_kg',input_weight_kg,'output_weight_kg',output_weight_kg,'rejection_weight_kg',rejection_weight_kg,
      'remaining_rejected_kg',remaining_rejected_kg,'retry_of_finishing_job_id',retry_of_finishing_job_id,'corrective_retry',corrective_retry,
      'can_retry',can_retry,'remarks',remarks,'order_number',order_number,'customer_name',customer_name,'job_number',job_number,'vendor_name',vendor_name) payload
    from disposition d
  ), queue_ranked as (
    select payload,status,row_number() over(partition by status order by planned_date asc nulls last,created_at asc,id asc) queue_position
    from projected where status in ('planned','sent_to_vendor','in_process','received','rejected')
  ), matched as materialized (
    select * from projected where (coalesce(p_status,'')='' or status=p_status)
      and (p_finishing_job_id is null or id=p_finishing_job_id)
      and (coalesce(btrim(p_search),'')='' or strpos(lower(concat_ws(' ',order_number,customer_name,job_number,vendor_name,finishing_type,status,color_code,shade_name,remarks)),lower(btrim(p_search)))>0)
  ), ranked as (
    select payload,row_number() over(order by
      case when v_direction='asc' and v_sort='planned_date' then planned_date end asc nulls last,
      case when v_direction='desc' and v_sort='planned_date' then planned_date end desc nulls last,
      case when v_direction='asc' and v_sort='created_at' then created_at end asc nulls last,
      case when v_direction='desc' and v_sort='created_at' then created_at end desc nulls last,
      case when v_direction='asc' and v_sort='order_number' then order_number end asc nulls last,
      case when v_direction='desc' and v_sort='order_number' then order_number end desc nulls last,
      case when v_direction='asc' and v_sort='status' then status end asc,
      case when v_direction='desc' and v_sort='status' then status end desc,
      case when v_direction='asc' and v_sort='input_weight_kg' then input_weight_kg end asc,
      case when v_direction='desc' and v_sort='input_weight_kg' then input_weight_kg end desc,
      case when v_direction='asc' and v_sort='output_weight_kg' then output_weight_kg end asc,
      case when v_direction='desc' and v_sort='output_weight_kg' then output_weight_kg end desc,
      case when v_direction='asc' and v_sort='rejection_weight_kg' then rejection_weight_kg end asc,
      case when v_direction='desc' and v_sort='rejection_weight_kg' then rejection_weight_kg end desc,id asc) position
    from matched
  ), paging as (
    select count(*) total_count,least(p_page,greatest(1,((count(*)+9)/10)::integer)) page from matched
  )
  select jsonb_build_object('company_id',v_company,'order_id',p_order_id,'production_job_id',p_production_job_id,'finishing_job_id',p_finishing_job_id,
    'integrity_ok',checked.integrity_ok,'scope_count',totals.scope_count,'page',paging.page,'page_size',10,'total_count',paging.total_count,
    'summary',jsonb_build_object('active_count',totals.active_count,'retry_eligible_count',totals.retry_eligible_count,
      'original_input_kg',totals.original_input_kg,'accepted_output_kg',totals.accepted_output_kg,'pending_input_kg',totals.pending_input_kg,
      'at_vendor_input_kg',totals.at_vendor_input_kg,'not_required_input_kg',totals.not_required_input_kg,'remaining_rejected_kg',totals.remaining_rejected_kg,
      'recorded_difference_kg',totals.original_input_kg-totals.accepted_output_kg-totals.pending_input_kg-totals.not_required_input_kg-totals.remaining_rejected_kg),
    'status_counts',(select jsonb_object_agg(s.status,(select count(*) from scoped where scoped.status=s.status))
      from unnest(array['planned','sent_to_vendor','in_process','received','completed','rejected','not_required']) s(status)),
    'queues',(select jsonb_object_agg(s.status,coalesce((select jsonb_agg(payload order by queue_position) from queue_ranked q where q.status=s.status and queue_position<=10),'[]'::jsonb))
      from unnest(array['planned','sent_to_vendor','in_process','received','rejected']) s(status)),
    'rows',coalesce((select jsonb_agg(payload order by position) from ranked where position>(paging.page::bigint-1)*10 and position<=paging.page::bigint*10),'[]'::jsonb),
    'vendors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'vendor_name',vendor_name,'vendor_type',vendor_type) order by vendor_name,id)
      from public.vendors where company_id=v_company and is_active and vendor_type in ('powder_coating','anodizing','other')),'[]'::jsonb))
  into v_result from totals cross join checked cross join paging;
  if p_finishing_job_id is not null and (v_result->>'total_count')::bigint=0 then raise exception 'Finishing receipt not found for this company and scope';end if;
  return v_result;
end;
$$;
revoke all on function public.get_finishing_workload(uuid,uuid,uuid,text,text,text,text,integer) from public,anon;
grant execute on function public.get_finishing_workload(uuid,uuid,uuid,text,text,text,text,integer) to authenticated;
commit;
