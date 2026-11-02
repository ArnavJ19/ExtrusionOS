import { replayMigrationChain } from "./migration-chain-replay.mjs";

export const nid = n => `bd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const nids = { company: nid(1), foreignCompany: nid(2), owner: nid(10), admin: nid(11), salesManager: nid(12), sales: nid(13), accounts: nid(14), productionManager: nid(15), production: nid(16), backup: nid(17), quality: nid(18), viewer: nid(19), foreign: nid(20), inactive: nid(21), dispatch: nid(22), dealer: nid(23), customer: nid(30), profile: nid(40), order: nid(50), order2: nid(51), foreignOrder: nid(52), invoice: nid(60), task: nid(70) };

export async function createNov3Fixture() {
  const replay = await replayMigrationChain();
  if (replay.failures.length) { await replay.db.close(); throw Error(JSON.stringify(replay.failures)); }
  const db = replay.db, ids = nids;
  await db.query("insert into companies(id,name,gst_state_code) values($1,'November synthetic factory','07'),($2,'Other synthetic company','07')", [ids.company, ids.foreignCompany]);
  for (const [key, role] of [["owner", "owner"], ["admin", "admin"], ["salesManager", "sales_manager"], ["sales", "sales"], ["accounts", "accounts"], ["productionManager", "production_manager"], ["production", "production"], ["backup", "production"], ["quality", "quality"], ["viewer", "viewer"], ["foreign", "owner"], ["inactive", "sales"], ["dispatch", "dispatch"], ["dealer", "dealer_admin"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [ids[key], `${key}@nov3.invalid`]);
    await db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,$3,$4,$5,$6)", [ids[key], key === "foreign" ? ids.foreignCompany : ids.company, `Fixture ${key}`, `${key}@nov3.invalid`, role, key !== "inactive"]);
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.owner]);
  await db.query("insert into customers(id,company_id,customer_name,customer_type) values($1,$2,'Fixture customer','fabricator')", [ids.customer, ids.company]);
  await db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper,drawing_approval_status) values($1,$2,'AL-NOV3','Window section',0.8,'6063','T6','approved')", [ids.profile, ids.company]);
  for (const [id, number] of [[ids.order, "SO-NOV3-01"], [ids.order2, "SO-NOV3-02"]]) {
    await db.query("insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority) values($1,$2,$3,$4,current_date,current_date+5,'normal')", [id, ids.company, number, ids.customer]);
  }
  await db.query("insert into invoices(id,company_id,customer_id,order_id,invoice_number,status,grand_total,subtotal,amount_paid,place_of_supply_state_code) values($1,$2,$3,$4,'INV-NOV3-01','generated',1000,1000,0,'07')", [ids.invoice, ids.company, ids.customer, ids.order]);
  await db.query("insert into tasks(id,company_id,title,task_type,status,assigned_to,created_by,due_date) values($1,$2,'Review physical bundle identity','general','open',$3,$4,current_date+1)", [ids.task, ids.company, ids.production, ids.owner]);
  let sequence = 1000;
  const nextId = () => nid(sequence++);
  async function asUser(sql, parameters = [], actor = ids.owner) {
    const previousActor = (await db.query("select current_setting('request.jwt.claim.sub',true) actor")).rows[0].actor;
    await db.exec("savepoint nov3_operation");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [actor]);
      await db.exec("set local role authenticated");
      const result = await db.query(sql, parameters);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [previousActor ?? ""]);
      await db.exec("release savepoint nov3_operation");
      return result.rows;
    } catch (error) {
      await db.exec("rollback to savepoint nov3_operation; reset role; release savepoint nov3_operation");
      throw error;
    }
  }
  const command = async (command, payload, actor = ids.owner) => (await asUser("select public.coordination_command($1,$2) data", [command, payload], actor))[0].data;
  const prepare = (mutation, actor = ids.owner, request_id = nextId()) => command("preview", { mutation, request_id }, actor);
  const commit = (preview, actor = ids.owner) => command("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint }, actor);
  const apply = async (mutation, actor = ids.owner) => { const preview = await prepare(mutation, actor); return commit(preview, actor); };
  const start = () => db.exec("begin"); const rollback = () => db.exec("rollback");
  return { db, ids, nextId, asUser, command, prepare, commit, apply, start, rollback, applied: replay.applied, close: () => db.close() };
}
