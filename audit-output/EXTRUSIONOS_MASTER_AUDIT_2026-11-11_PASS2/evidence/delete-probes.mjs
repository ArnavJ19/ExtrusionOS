// PASS2 audit: can an owner hard-delete parents of the lineage chain (which would cascade or null child links)? Native PG18, synthetic rows.
import { admin, asUser, cloneDb, dropDb, log, nid, U } from './native-lib.mjs';
const db = cloneDb('w_del');
try {
  const c = U.company, o = nid(50), d = nid(90), fb = nid(8101), q = nid(8800), j = nid(60), die = nid(82);
  admin(db, `set session_replication_role = replica;
    insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority) values('${o}','${c}','SO-AUD-1','${U.customer}',current_date,current_date+5,'normal');
    insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles) values('${d}','${c}','${o}','DC-AUD-1',current_date,'dispatched',100,1);
    insert into production_jobs(id,company_id,order_id,profile_id,job_number,status) values('${j}','${c}','${o}','${U.profile}','JOB-AUD-1','completed');
    insert into foundry_batches(id,company_id,batch_number,furnace_number,batch_sequence,production_date,status,alloy,temper,billet_length_mm,billet_diameter_mm,billet_count,billet_weight_density_kg,scrap_aluminium_kg,external_aluminium_kg) values('${fb}','${c}','AUD-CAST-1','FA',1,current_date,'cast','6063','T5',1000,178,1,65.670,0,65.670);
    insert into quotes(id,company_id,quote_number,customer_id,quote_date,status,gst_percent) values('${q}','${c}','AUD-Q-1','${U.customer}',current_date,'sent',18);
    insert into dies(id,company_id,die_number,profile_id,die_status) values('${die}','${c}','D-AUD','${U.profile}','active');
    insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code,igst_amount) values('${nid(601)}','${c}','${U.customer}','${o}','${d}','AUD/1',current_date,'generated',1000,0,1000,0,'07','07',0);
    set session_replication_role = origin;`);
  for (const [who, actor] of [['owner', U.owner], ['admin', U.admin]]) {
    for (const [t, id] of [['production_jobs', j], ['dispatches', d], ['orders', o], ['foundry_batches', fb], ['quotes', q], ['dies', die], ['aluminium_profiles', U.profile], ['customers', U.customer], ['invoices', nid(601)]]) {
      const r = await asUser(db, actor, `with x as (delete from public.${t} where id='${id}' returning 1) select count(*) from x; rollback; begin;`);
      log({ id: `DEL-${who}-${t}`, expect: 'refused or 0 rows for records with downstream history', deleted: r.ok ? Number(r.out.split('\n').pop()) : 0, err: r.err.slice(0, 150) });
    }
  }
} finally { dropDb(db); }
