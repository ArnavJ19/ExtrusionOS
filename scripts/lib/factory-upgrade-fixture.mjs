import {createCommercialFixture,cid} from './commercial-upgrade-fixture.mjs';
export {cid};
export async function createFactoryUpgradeFixture(){
  const f=await createCommercialFixture(),ids={...f.ids,order:cid(800),batch:cid(801),reservation:cid(802)};
  ids.order=(await f.db.query('select create_direct_order_atomic($1,$2,$3) id',[
    {customer_id:ids.customer,order_date:'2026-10-29',priority:'normal',notes:'Factory upgrade fixture'},
    [{profile_id:ids.profile,die_id:null,quantity_pieces:200,length_per_piece_m:6,expected_section_weight_kg_per_m:0.8,net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'}],cid(800)
  ])).rows[0].id;
  await f.db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,location,status,origin_type,qc_status,alloy,temper)
    values($1,$2,$3,'mill_finish',6,1200,200,960,'Rack A','available','legacy_unverified','not_required','6063','T6')`,[ids.batch,ids.company,ids.profile]);
  await f.db.query(`insert into profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,created_by)
    values($1,$2,$3,$4,$5,480,600,100,'active',$6)`,[ids.reservation,ids.company,ids.batch,ids.profile,ids.order,ids.owner]);
  const recordBundle=async(n,patch={})=>f.command('physical_bundle_command','bundle.record',{id:cid(n),order_id:ids.order,source_line_id:ids.reservation,source_kind:'reservation',bundle_number:`MEASURED-${n}`,number_of_pieces:2,net_length_m:12,gross_weight_kg:10.6,tare_weight_kg:1,...patch});
  return {...f,ids,recordBundle};
}
