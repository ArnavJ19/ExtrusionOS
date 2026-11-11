import { createNov3Fixture, nid, nids as nov3Ids } from "./nov-batch3-fixture.mjs";

export { nid };
export const apIds = {
  ...nov3Ids,
  inventory: nid(24), factory: nid(25), accounts2: nid(26),
  vendor: nid(80), transporter: nid(81), die: nid(82), job: nid(83), dispatch: nid(84), customer2: nid(31), profile2: nid(41), payment: nid(61)
};

/** IST calendar date offset from today, as YYYY-MM-DD. */
export function istDay(offset = 0) {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}

// Builds on the November batch 3 fixture (full migration chain, one synthetic company plus a foreign company and
// one user per role). Seeds run with triggers suspended; every scenario runs with production triggers enabled.
export async function createAutopilotFixture() {
  const base = await createNov3Fixture();
  const { db } = base, ids = apIds;
  await db.exec("set session_replication_role = replica");
  for (const [key, role] of [["inventory", "inventory_manager"], ["factory", "factory_manager"], ["accounts2", "accounts"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [ids[key], `${key}@ap1.invalid`]);
    await db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,$3,$4,$5,true)", [ids[key], ids.company, `Fixture ${key}`, `${key}@ap1.invalid`, role]);
  }
  await db.query("insert into customers(id,company_id,customer_name,customer_type,city) values($1,$2,'Sharma Fabricators','fabricator','Pune')", [ids.customer2, ids.company]);
  await db.query("insert into vendors(id,company_id,vendor_name,vendor_type,city) values($1,$2,'Shree Nitriding Works','die_maker','Pune'),($3,$2,'VRL Logistics','transporter','Hubli')", [ids.vendor, ids.company, ids.transporter]);
  await db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper) values($1,$2,'OM-2045','Sliding track',0.95,'6063','T5')", [ids.profile2, ids.company]);
  await db.query("insert into dies(id,company_id,die_number,profile_id,die_status) values($1,$2,'D-2045-A',$3,'active')", [ids.die, ids.company, ids.profile2]);
  await db.exec("set session_replication_role = origin");
  await db.query("select set_config('request.jwt.claim.sub','',false)");

  const call = async (rpc, command, payload = {}, actor = ids.owner) => (await base.asUser(`select public.${rpc}($1,$2) data`, [command, payload], actor))[0].data;
  async function asService(sql, parameters = []) {
    await db.exec("savepoint ap_service");
    try {
      await db.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true)");
      await db.exec("set local role service_role");
      const result = await db.query(sql, parameters);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.role','',true)");
      await db.exec("release savepoint ap_service");
      return result.rows;
    } catch (error) {
      await db.exec("rollback to savepoint ap_service; reset role; release savepoint ap_service");
      throw error;
    }
  }
  const cron = async schedule => (await asService("select public.ap_jobs_cron($1) data", [{ schedule }]))[0].data;
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  return { ...base, ids, call, cron, asService, one };
}
