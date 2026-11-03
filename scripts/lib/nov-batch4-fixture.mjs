import { replayMigrationChain } from "./migration-chain-replay.mjs";

export const nid = n => `be000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const nids = {
  company: nid(1), foreignCompany: nid(2), owner: nid(10), admin: nid(11), salesManager: nid(12), sales: nid(13), accounts: nid(14), productionManager: nid(15),
  production: nid(16), production2: nid(17), quality: nid(18), viewer: nid(19), foreign: nid(20), inventory: nid(21), dispatch: nid(22), factory: nid(23), dealer: nid(24),
  customer: nid(30), profile: nid(40), order: nid(50), order2: nid(51), foreignOrder: nid(52), line1: nid(55), line2: nid(56), line3: nid(57),
  job1: nid(60), job2: nid(61), job3: nid(62), jobUnlinked: nid(63), foreignJob: nid(64), vendor: nid(70), finishing: nid(71), finishing2: nid(72),
  inspection: nid(80), packaging: nid(85), dispatch1: nid(90), dispatch2: nid(91), location: nid(95), foreignLocation: nid(96), po: nid(100), poLine: nid(101), poLineMetres: nid(102),
  procedure: nid(110), version1: nid(111), version2: nid(112), alloy: nid(120), temper: nid(121)
};

// The full development migration chain, with synthetic factory records seeded while source triggers are
// suspended. Every scenario then runs with all production triggers and guards enabled.
export async function createNov4Fixture() {
  const replay = await replayMigrationChain();
  if (replay.failures.length) { await replay.db.close(); throw Error(JSON.stringify(replay.failures)); }
  const db = replay.db, ids = nids;
  await db.exec("set session_replication_role = replica");
  await db.query("insert into companies(id,name,gst_state_code) values($1,'November batch 4 factory','07'),($2,'Other synthetic company','07')", [ids.company, ids.foreignCompany]);
  for (const [key, role] of [["owner", "owner"], ["admin", "admin"], ["salesManager", "sales_manager"], ["sales", "sales"], ["accounts", "accounts"], ["productionManager", "production_manager"],
    ["production", "production"], ["production2", "production"], ["quality", "quality"], ["viewer", "viewer"], ["foreign", "owner"], ["inventory", "inventory_manager"], ["dispatch", "dispatch"],
    ["factory", "factory_manager"], ["dealer", "dealer_admin"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [ids[key], `${key}@nov4.invalid`]);
    await db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,$3,$4,$5,true)", [ids[key], key === "foreign" ? ids.foreignCompany : ids.company, `Fixture ${key}`, `${key}@nov4.invalid`, role]);
  }
  await db.query("insert into customers(id,company_id,customer_name,customer_type) values($1,$2,'Fixture fabricator','fabricator')", [ids.customer, ids.company]);
  await db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper,drawing_approval_status) values($1,$2,'AL-NOV4','Sliding track',1.2,'6063','T6','approved')", [ids.profile, ids.company]);
  for (const [id, number, company] of [[ids.order, "SO-NOV4-01", ids.company], [ids.order2, "SO-NOV4-02", ids.company], [ids.foreignOrder, "SO-FOREIGN", ids.foreignCompany]]) {
    await db.query("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,requested_weight_kg,manufacturing_weight_kg) values($1,$2,$3,$4,current_date,current_date+10,'normal','extrusion_planned',1600,1600)", [id, company, number, ids.customer]);
  }
  for (const [id, order, kg, pieces, label] of [[ids.line1, ids.order, 1000, 500, "Track 6 m"], [ids.line2, ids.order, 600, 300, "Track 3 m"], [ids.line3, ids.order2, null, 100, "Unquantified line"]]) {
    await db.query(`insert into order_items(id,company_id,order_id,profile_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,drawing_revision,cut_length,packing_instruction,section_weight_kg_per_m,finishing_type)
      values($1,$2,$3,$4,$5,$6,6,$7::numeric,coalesce($7::numeric,0),'R1',6000,'Wrap each bundle',1.2,'mill_finish')`, [id, ids.company, order, ids.profile, label, pieces, kg]);
  }
  const job = (id, order, line, status, planned, actual, number) => db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,
      drawing_revision,cut_length,packing_instruction,section_weight_kg_per_m,finishing_type,planned_date) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'R1',6000,'Wrap each bundle',1.2,'mill_finish',current_date)`,
    [id, order === ids.foreignOrder ? ids.foreignCompany : ids.company, order, ids.profile, status, planned, actual, number, line]);
  await job(ids.job1, ids.order, ids.line1, "completed", 600, 610, "J-NOV4-1");
  await job(ids.job2, ids.order, ids.line2, "planned", 600, 0, "J-NOV4-2");
  await job(ids.job3, ids.order, ids.line1, "in_progress", 400, 0, "J-NOV4-3");
  await job(ids.jobUnlinked, ids.order, null, "completed", 50, 50, "J-NOV4-U");
  await job(ids.foreignJob, ids.foreignOrder, null, "completed", 50, 50, "J-FOREIGN");
  await db.query("update production_jobs set completed_at=now()-interval '30 hours' where status='completed'");
  await db.query("update order_items set finishing_type='anodizing' where id=$1", [ids.line1]);
  await db.query("update production_jobs set finishing_type='anodizing' where id = any($1)", [[ids.job1, ids.job3, ids.jobUnlinked]]);
  await db.query("insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Shine Anodisers','anodizing')", [ids.vendor, ids.company]);
  await db.query("insert into inventory_locations(id,company_id,location_code,location_name,location_type) values($1,$2,'BAY-2','Bay 2 ageing rack','factory'),($3,$4,'X','Foreign bay','factory')", [ids.location, ids.company, ids.foreignLocation, ids.foreignCompany]);
  await db.query("insert into purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,status,idempotency_key,request_hash,created_by,updated_by) values($1,$2,$3,'Billet supplier','PO-NOV4-1',current_date,'open',$4,'x',$5,$5)", [ids.po, ids.company, ids.vendor, nid(9999), ids.owner]);
  await db.query("insert into purchase_order_lines(id,company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent) values($1,$2,$3,1,'6063 billet 7 inch','6063','kg',800,210,18),($4,$2,$3,2,'Extrusion offcuts','scrap','m',20,10,18)", [ids.poLine, ids.company, ids.po, ids.poLineMetres]);
  await db.query("insert into operating_procedures(id,company_id,title,purpose,scope_label,owner_id,owner_name,routine_kind,prompts,created_by,request_payload) values($1,$2,'Bundle wrapping','Protect finished surfaces','Packing',$3,'Fixture factory','none','[]',$3,'{}')", [ids.procedure, ids.company, ids.factory]);
  await db.exec("set session_replication_role = origin");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.owner]);

  let sequence = 1000;
  const nextId = () => nid(sequence++);
  async function asUser(sql, parameters = [], actor = ids.owner) {
    const previousActor = (await db.query("select current_setting('request.jwt.claim.sub',true) actor")).rows[0].actor;
    await db.exec("savepoint nov4_operation");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor]);
      await db.exec("set local role authenticated");
      const result = await db.query(sql, parameters);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [previousActor ?? ""]);
      await db.exec("release savepoint nov4_operation");
      return result.rows;
    } catch (error) {
      await db.exec("rollback to savepoint nov4_operation; reset role; release savepoint nov4_operation");
      throw error;
    }
  }
  /** Source writes performed by existing guarded workflows, with triggers enabled. */
  async function asSystem(sql, parameters = [], actor = ids.owner) {
    await db.exec("savepoint nov4_system");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      const result = await db.query(sql, parameters);
      await db.exec("release savepoint nov4_system");
      return result.rows;
    } catch (error) {
      await db.exec("rollback to savepoint nov4_system; release savepoint nov4_system");
      throw error;
    }
  }
  /** Seeds an additional source row without running source-side workflow triggers. */
  async function seed(sql, parameters = []) {
    await db.exec("set local session_replication_role = replica");
    try { return (await db.query(sql, parameters)).rows; } finally { await db.exec("set local session_replication_role = origin"); }
  }
  const command = async (name, payload, actor = ids.owner) => (await asUser("select public.control_command($1,$2) data", [name, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => commit(await prepare(mutation, actor), actor);
  const start = () => db.exec("begin"); const rollback = () => db.exec("rollback");
  return { db, ids, nextId, asUser, asSystem, seed, command, prepare, commit, apply, start, rollback, applied: replay.applied, close: () => db.close() };
}
