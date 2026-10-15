-- Read-only internal reconciliation. Missing historical prices remain unknown.
-- No line, price, physical receipt or quotation lineage is backfilled here.
with direct_orders as (
  select order_record.company_id,order_record.id,order_record.order_number,order_record.current_stage,order_record.order_value,
    count(line.id) line_count,
    count(line.id) filter(where line.quantity_kg is null or line.quantity_kg<=0
      or line.quantity_kg::text in ('NaN','Infinity','-Infinity')
      or line.net_rate is null or line.net_rate<=0 or line.net_rate::text in ('NaN','Infinity','-Infinity')
      or line.final_line_value is null or line.final_line_value<=0
      or line.gst_percent is null or line.gst_percent not between 0 and 100
      or coalesce(line.hsn_code,'') !~ '^(\d{4}|\d{6}|\d{8})$'
      or abs(line.final_line_value-round(line.quantity_kg*line.net_rate,2))>0.01) invalid_line_count,
    round(coalesce(sum(line.final_line_value+round(line.final_line_value*line.gst_percent/100,2)),0),2) recorded_line_total
  from public.orders order_record left join public.order_items line
    on line.order_id=order_record.id and line.company_id=order_record.company_id
  where order_record.quote_id is null
  group by order_record.company_id,order_record.id,order_record.order_number,order_record.current_stage,order_record.order_value
)
select *,line_count=0 missing_commercial_lines,invalid_line_count>0 invalid_commercial_lines,
  order_value is null or abs(order_value-recorded_line_total)>0.01 value_mismatch
from direct_orders
where line_count=0 or invalid_line_count>0 or order_value is null or abs(order_value-recorded_line_total)>0.01
order by company_id,order_number,id;
