import {createFactoryUpgradeFixture,cid} from './factory-upgrade-fixture.mjs';
import {buildInvoiceItems} from '../../lib/pcda/invoice.ts';
export {cid};
export async function createBatch6CoreFixture(){
  const f=await createFactoryUpgradeFixture();
  await f.db.query("update companies set gst_number='27ABCDE1234F1Z5',gst_state_code='27' where id=$1",[f.ids.company]);
  const post=async({pieces=60,tag='PARTIAL-60',reservation=f.ids.reservation,batch=f.ids.batch}={})=>{
    const kg=pieces*4.8;
    return (await f.db.query('select save_ready_dispatch_atomic(null,$1,$2) id',[
      {order_id:f.ids.order,dispatch_date:'2026-10-29',total_weight_kg:kg,total_tare_weight_kg:1,transporter_name:'Synthetic transporter',vehicle_number:'DL01AB1234'},
      [{source_kind:'reservation',source_line_id:reservation,reservation_id:reservation,source_record_id:f.ids.order,profile_id:f.ids.profile,profile_stock_batch_id:batch,bundle_number:tag,number_of_pieces:pieces,net_length_m:pieces*6,gross_weight_kg:kg+1,tare_weight_kg:1}]
    ])).rows[0].id;
  };
  const dispatch=await post();
  const packing=(await f.db.query('select * from packing_list_items where dispatch_id=$1',[dispatch])).rows;
  const invoice=(await f.db.query('select save_invoice_atomic(null,$1,$2,true) id',[
    {customer_id:f.ids.customer,order_id:f.ids.order,dispatch_id:dispatch,invoice_number:'B6-INV-1',invoice_date:'2026-10-29',due_date:'2026-11-28',status:'generated',place_of_supply_state_code:'27'},
    buildInvoiceItems(packing,cid(4200),f.ids.company)
  ])).rows[0].id;
  const proof=`${f.ids.company}/dispatches/${dispatch}/proof-of-delivery/synthetic-proof.jpg`;
  await f.db.query("insert into technical_documents(company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,storage_bucket,storage_path,approval_status,uploaded_by) values($1,'proof_of_delivery','dispatch',$2,'synthetic-proof.jpg',$3,'documents',$3,'approved',$4)",[f.ids.company,dispatch,proof,f.ids.owner]);
  await f.db.query('select transition_dispatch_delivery_atomic($1,$2,$3,$4)',[dispatch,'delivered',proof,'Synthetic local delivery proof']);
  return {...f,post,dispatch,packing:packing[0],invoice};
}
