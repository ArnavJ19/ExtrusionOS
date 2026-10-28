import { replayMigrationChain } from './migration-chain-replay.mjs';
export const cid = n => `bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const commercialIds = { company:cid(1), foreign:cid(2), owner:cid(10), admin:cid(11), sales:cid(12), accounts:cid(13), production:cid(14), viewer:cid(15), dealer:cid(16), customer:cid(20), profile:cid(30), quote:cid(40) };
export async function createCommercialFixture() {
  const result = await replayMigrationChain();
  if (result.failures.length) { await result.db.close(); throw Error(JSON.stringify(result.failures)); }
  const db = result.db, ids = commercialIds;
  await db.query('insert into companies(id,name) values($1,$2),($3,$4)',[ids.company,'Commercial fixture',ids.foreign,'Foreign company']);
  for (const [key,role] of [['owner','owner'],['admin','admin'],['sales','sales'],['accounts','accounts'],['production','production'],['viewer','viewer'],['dealer','dealer_admin']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[ids[key],`${key}@commercial.invalid`]);
    await db.query('insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,$3,$4,$3,true)',[ids[key],ids.company,role,`${key}@commercial.invalid`]);
  }
  const actor = async (id=ids.owner) => db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await actor();
  await db.query("insert into customers(id,company_id,customer_name,customer_type,payment_terms,billing_address,shipping_address) values($1,$2,'Window customer','fabricator','30 days','Billing address','Factory gate')",[ids.customer,ids.company]);
  await db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,drawing_approval_status,drawing_revision,alloy,temper,billet_diameter_required_inch) values($1,$2,'AL-COMM','Commercial section',0.8,'approved','A','6063','T6',7)",[ids.profile,ids.company]);
  const command = async (rpc, command, payload={}) => (await db.query(`select public.${rpc}($1,$2) data`,[command,payload])).rows[0].data;
  const newQuote = async (itemOverrides={}) => (await db.query(`select public.save_quote_atomic(null,$1,$2,null,null,'Initial fixture') id`,[
    {customer_id:ids.customer,quote_date:'2026-10-28',gst_percent:18,payment_terms:'30 days'},
    [{profile_id:ids.profile,quantity_pieces:10,length_per_piece_m:6,section_weight_kg_per_m:0.8,billet_rate_per_kg:250,conversion_charge_per_kg:30,margin_percent:20,expected_recovery_percent:90,finishing_type:'mill_finish',finishing_charge_type:'per_kg',finishing_charge:0,drawing_approval_status:'Approved',gst_percent:18,...itemOverrides}]
  ])).rows[0].id;
  return {db,ids,actor,command,newQuote,close:()=>db.close(),applied:result.applied};
}
