import { replayMigrationChain } from "./migration-chain-replay.mjs";

export const nid = n => `be500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const nids = {
  company: nid(1), foreignCompany: nid(2), owner: nid(10), admin: nid(11), salesManager: nid(12), sales: nid(13), accounts: nid(14), productionManager: nid(15),
  production: nid(16), production2: nid(17), quality: nid(18), viewer: nid(19), foreign: nid(20), inventory: nid(21), dispatch: nid(22), factory: nid(23), dealer: nid(24), dispatchManager: nid(25),
  customer: nid(30), profile: nid(40), profile2: nid(41), order: nid(50), order2: nid(51), foreignOrder: nid(52), line1: nid(55), line2: nid(56),
  job1: nid(60), job2: nid(61), job3: nid(62), foreignJob: nid(64), vendor: nid(70), drawing: nid(80), foreignDrawing: nid(81),
  po: nid(100), poLine: nid(101), poLineMetres: nid(102), receipt: nid(103), receiptLine: nid(104), receiptLineMetres: nid(105),
  dispatch1: nid(110), dispatch2: nid(111), bundle1: nid(112), bundle2: nid(113), bundle3: nid(114),
  press1: nid(120), press2: nid(121), slot1: nid(122), slot2: nid(123), block: nid(124), breakdown: nid(125),
  competency: nid(130), procedure: nid(131), plan: nid(140), planItem: nid(141), planItem2: nid(142), planItem3: nid(146), inspection: nid(143), result1: nid(144), result2: nid(145),
  requirement: nid(150), document: nid(151), documentPending: nid(152), stock1: nid(160), stock2: nid(161), stock3: nid(162)
};

// The full development migration chain with synthetic factory records seeded while source triggers are
// suspended. Every scenario then runs with all production triggers and guards enabled.
export async function createNov5Fixture() {
  const replay = await replayMigrationChain();
  if (replay.failures.length) { await replay.db.close(); throw Error(JSON.stringify(replay.failures)); }
  const db = replay.db, ids = nids;
  await db.exec("set session_replication_role = replica");
  await db.query("insert into companies(id,name,gst_state_code) values($1,'November batch 5 factory','07'),($2,'Other synthetic company','07')", [ids.company, ids.foreignCompany]);
  for (const [key, role] of [["owner", "owner"], ["admin", "admin"], ["salesManager", "sales_manager"], ["sales", "sales"], ["accounts", "accounts"], ["productionManager", "production_manager"],
    ["production", "production"], ["production2", "production"], ["quality", "quality"], ["viewer", "viewer"], ["foreign", "owner"], ["inventory", "inventory_manager"], ["dispatch", "dispatch"],
    ["factory", "factory_manager"], ["dealer", "dealer_admin"], ["dispatchManager", "dispatch_manager"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [ids[key], `${key}@nov5.invalid`]);
    await db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,$3,$4,$5,true)", [ids[key], key === "foreign" ? ids.foreignCompany : ids.company, `Fixture ${key}`, `${key}@nov5.invalid`, role]);
  }
  await db.query("insert into customers(id,company_id,customer_name,customer_type) values($1,$2,'Fixture fabricator','fabricator')", [ids.customer, ids.company]);
  await db.query(`insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper,drawing_approval_status,compatible_presses)
    values($1,$2,'AL-NOV5','Sliding track',1.2,'6063','T6','approved','{}'),($3,$2,'AL-NOV5B','Casement frame',1.0,'6063','T6','approved','{PRESS-A}')`, [ids.profile, ids.company, ids.profile2]);
  for (const [id, number, company] of [[ids.order, "SO-NOV5-01", ids.company], [ids.order2, "SO-NOV5-02", ids.company], [ids.foreignOrder, "SO-FOREIGN", ids.foreignCompany]]) {
    await db.query("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,$3,$4,current_date,current_date+10,'normal','extrusion_planned',1600,1600)", [id, company, number, ids.customer]);
  }
  for (const [id, order, profile, kg, label] of [[ids.line1, ids.order, ids.profile, 1000, "Track 6 m"], [ids.line2, ids.order2, ids.profile2, 600, "Frame 3 m"]]) {
    await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,drawing_revision,cut_length,packing_instruction,section_weight_kg_per_m,finishing_type,pieces_per_bundle)
      values($1,$2,$3,$4,$5,100,6,$6,$6,'R1',6000,'Wrap each bundle',1.2,'anodizing',10)`, [id, ids.company, order, profile, label, kg]);
  }
  const job = (id, order, line, profile, status, number, company = ids.company) => db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,
      drawing_revision,cut_length,packing_instruction,section_weight_kg_per_m,finishing_type,planned_date) values($1,$2,$3,$4,$5,500,0,$6,$7,'R1',6000,'Wrap each bundle',1.2,'anodizing',current_date)`,
    [id, company, order, profile, status, number, line]);
  await job(ids.job1, ids.order, ids.line1, ids.profile, "planned", "J-NOV5-1");
  await job(ids.job2, ids.order, ids.line1, ids.profile, "in_progress", "J-NOV5-2");
  await job(ids.job3, ids.order2, ids.line2, ids.profile2, "planned", "J-NOV5-3");
  await job(ids.foreignJob, ids.foreignOrder, null, ids.profile, "planned", "J-FOREIGN", ids.foreignCompany);
  await db.query("insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Billet Metals','aluminum_billets')", [ids.vendor, ids.company]);
  await db.query("insert into technical_drawings(id,company_id,drawing_number,title,related_entity_type,related_entity_id,approval_status) values($1,$2,'DWG-NOV5-1','Sliding track section','profile',$3,'draft'),($4,$5,'DWG-F','Foreign','general',null,'draft')",
    [ids.drawing, ids.company, ids.profile, ids.foreignDrawing, ids.foreignCompany]);
  await db.query("insert into purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,status,idempotency_key,request_hash,created_by,updated_by) values($1,$2,$3,'Billet Metals','PO-NOV5-1',current_date,'open',$4,'x',$5,$5)", [ids.po, ids.company, ids.vendor, nid(9999), ids.owner]);
  await db.query("insert into purchase_order_lines(id,company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent) values($1,$2,$3,1,'6063 billet 7 inch','6063 F','kg',2000,210,18),($4,$2,$3,2,'Packing film','LDPE','m',500,10,18)", [ids.poLine, ids.company, ids.po, ids.poLineMetres]);
  await db.query("insert into purchase_receipts(id,company_id,purchase_order_id,receipt_date,reference,idempotency_key,request_hash,created_by) values($1,$2,$3,current_date-1,'GRN-1',$4,'x',$5)", [ids.receipt, ids.company, ids.po, nid(9998), ids.inventory]);
  await db.query("insert into purchase_receipt_lines(id,company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity) values($1,$2,$3,$4,$5,1000,0,50,950),($6,$2,$3,$4,$7,200,0,0,200)",
    [ids.receiptLine, ids.company, ids.receipt, ids.po, ids.poLine, ids.receiptLineMetres, ids.poLineMetres]);
  for (const [id, number, departed] of [[ids.dispatch1, "D-NOV5-1", true], [ids.dispatch2, "D-NOV5-2", true]]) {
    await db.query(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg,delivery_status,actual_dispatched_at,last_status_changed_at)
      values($1,$2,$3,$4,current_date,2,0,'delivered',$5,now())`, [id, ids.company, ids.order, number, departed ? new Date(Date.now() - 86400000).toISOString() : null]);
  }
  for (const [id, dispatch, bundle, net] of [[ids.bundle1, ids.dispatch1, "B1", 300], [ids.bundle2, ids.dispatch1, "B2", 200], [ids.bundle3, ids.dispatch2, "B3", 250]]) {
    await db.query(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,order_item_id,drawing_revision,net_length_m)
      values($1,$2,$3,$4,$5,10,$6,2,$7,'R1',60)`, [id, ids.company, dispatch, ids.profile, bundle, net + 2, ids.line1]);
  }
  for (const [id, name, code] of [[ids.press1, "Press A", "PRESS-A"], [ids.press2, "Press B", "PRESS-B"]]) {
    await db.query("insert into machines(id,company_id,machine_name,machine_type,status,is_active,machine_code) values($1,$2,$3,'extrusion_press','active',true,$4)", [id, ids.company, name, code]);
    for (let weekday = 1; weekday <= 7; weekday++) await db.query("insert into factory_shift_capacities(company_id,machine_id,weekday,shift_name,starts_local,ends_local,capacity_kg,created_by) values($1,$2,$3,'Day','00:00','23:59',100000,$4)", [ids.company, id, weekday, ids.owner]);
  }
  await db.query("insert into operating_procedures(id,company_id,title,purpose,scope_label,owner_id,owner_name,routine_kind,prompts,created_by,request_payload) values($1,$2,'Press start-up','Safe die loading','Extrusion',$3,'Fixture factory','none','[]',$3,'{}')", [ids.procedure, ids.company, ids.factory]);
  await db.query("insert into competencies(id,company_id,code,name,procedure_id,validity_months,is_active,created_by) values($1,$2,'PRESS-START','Press start-up',null,12,true,$3)", [ids.competency, ids.company, ids.factory]);
  await db.query("insert into inspection_plans(id,company_id,profile_id,version,status,sampling_instruction,created_by,approved_by,approved_by_name,approved_at) values($1,$2,$3,1,'approved','First and last bundle',$4,$4,'Fixture quality',now())", [ids.plan, ids.company, ids.profile, ids.quality]);
  await db.query("insert into inspection_plan_items(id,plan_id,company_id,seq,characteristic,unit,nominal,lower_limit,upper_limit) values($1,$2,$3,1,'Wall thickness','mm',1.4,1.3,1.5),($4,$2,$3,2,'Flange width','mm',20,19.8,20.2),($5,$2,$3,3,'Web thickness','mm',1.4,1.3,1.5)", [ids.planItem, ids.plan, ids.company, ids.planItem2, ids.planItem3]);
  await db.query("insert into quality_inspections(id,company_id,production_job_id,profile_id,batch_number,quantity_checked_kg,status) values($1,$2,$3,$4,'QC-NOV5',300,'pending')", [ids.inspection, ids.company, ids.job2, ids.profile]);
  await db.query("insert into inspection_results(id,company_id,inspection_id,plan_id,item_id,observed,outcome,recorded_by,recorded_by_name,recorded_at) values($1,$2,$3,$4,$5,1.42,'pass',$6,'Fixture quality',now()-interval '2 hours'),($7,$2,$3,$4,$8,20.1,'pass',$6,'Fixture quality',now()-interval '1 hour')",
    [ids.result1, ids.company, ids.inspection, ids.plan, ids.planItem, ids.quality, ids.result2, ids.planItem2]);
  await db.query("insert into customer_compliance_requirements(id,company_id,customer_id,certificate_type,description,is_mandatory,is_active,work_stages) values($1,$2,$3,'Mill test certificate','EN 573 chemistry',true,true,'{quality,dispatch}')", [ids.requirement, ids.company, ids.customer]);
  await db.query("insert into technical_documents(id,company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,approval_status) values($1,$2,'material_test_certificate','dispatch',$3,'mtc-d1.pdf','x','approved'),($4,$2,'material_test_certificate','order',$5,'mtc-draft.pdf','x','pending')",
    [ids.document, ids.company, ids.dispatch1, ids.documentPending, ids.order]);
  for (const [id, bundle, pieces, kg] of [[ids.stock1, "S1", 10, 72], [ids.stock2, "S2", 20, 144], [ids.stock3, "S3", 5, 36]]) {
    await db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,origin_type,qc_status,piece_length_m,updated_at)
      values($1,$2,$3,'mill_finish',$4,$5,$6,$7,'Rack 4','available','opening_balance','released',6,now()-interval '1 day')`, [id, ids.company, ids.profile, pieces * 6, pieces, kg, bundle]);
  }
  await db.exec("set session_replication_role = origin");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.owner]);

  let sequence = 1000;
  const nextId = () => nid(sequence++);
  async function asUser(sql, parameters = [], actor = ids.owner) {
    const previousActor = (await db.query("select current_setting('request.jwt.claim.sub',true) actor")).rows[0].actor;
    await db.exec("savepoint nov5_operation");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor]);
      await db.exec("set local role authenticated");
      const result = await db.query(sql, parameters);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [previousActor ?? ""]);
      await db.exec("release savepoint nov5_operation");
      return result.rows;
    } catch (error) {
      await db.exec("rollback to savepoint nov5_operation; reset role; release savepoint nov5_operation");
      throw error;
    }
  }
  /** Source writes performed by existing guarded workflows, with triggers enabled. */
  async function asSystem(sql, parameters = [], actor = ids.owner) {
    await db.exec("savepoint nov5_system");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      const result = await db.query(sql, parameters);
      await db.exec("release savepoint nov5_system");
      return result.rows;
    } catch (error) {
      await db.exec("rollback to savepoint nov5_system; release savepoint nov5_system");
      throw error;
    }
  }
  /** Seeds an additional source row without running source-side workflow triggers. */
  async function seed(sql, parameters = []) {
    await db.exec("set local session_replication_role = replica");
    try { return (await db.query(sql, parameters)).rows; } finally { await db.exec("set local session_replication_role = origin"); }
  }
  const command = async (name, payload, actor = ids.owner) => (await asUser("select public.assurance_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  const start = () => db.exec("begin"); const rollback = () => db.exec("rollback");
  return { db, ids, nextId, asUser, asSystem, seed, command, prepare, commit, apply, start, rollback, applied: replay.applied, close: () => db.close() };
}
