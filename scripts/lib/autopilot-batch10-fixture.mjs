import { addBatch9Helpers, createBatch9Fixture, ids as baseIds, istDay } from "./autopilot-batch9-fixture.mjs";

export { istDay };
export const ids = baseIds;

// Autopilot batch 10 fixture. Builds on the batch 9 fixture (full migration chain, synthetic Omalco company, one user per
// role, customers, profiles, die, presses and jobs) and adds helpers for recorded pushes, powder-coating jobs, a second
// profile, billet stock and a configurator project with a cutting list. Synthetic data only.
export async function createBatch10Fixture() {
  return addBatch10Helpers(await createBatch9Fixture());
}

/** An IST wall-clock time on a day offset from today, as an ISO instant. */
export function istAt(offsetDays, hhmm) {
  return new Date(`${istDay(offsetDays)}T${hhmm}:00+05:30`).toISOString();
}

export function addBatch10Helpers(f0) {
  const f = f0.rate ? f0 : addBatch9Helpers(f0);
  const i = baseIds;
  /** Recorded pushes of a job on a press at the given instants (as the workstation records them), each of `kg` billet. */
  async function pushes({ job, machine, die = i.die, at, kg = 30, basis = "linked_billet", operator = i.production }) {
    const last = (await f.db.query("select coalesce(max(seq),0) n from production_push_events where production_job_id=$1", [job])).rows[0].n;
    let seq = Number(last);
    for (const when of at) {
      seq += 1;
      await f.seed(`insert into production_push_events(id,company_id,production_job_id,machine_id,die_id,kind,source,seq,operator_id,billet_kg,billet_kg_basis,event_at)
        values($1,$2,$3,$4,$5,'push','tap',$6,$7,$8,$9,$10)`, [f.next(), i.company, job, machine, die, seq, operator, kg, kg === null ? null : basis, when]);
    }
  }
  /** A second catalogue profile (same section under another code by default). */
  async function profile({ code = `OM-EQ-${f.next().slice(-4)}`, name = "Sliding track (alternate code)", kgm = 0.95, alloy = "6063" } = {}) {
    const id = f.next();
    await f.seed("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper,hsn_code) values($1,$2,$3,$4,$5,$6,'T5','7604')", [id, i.company, code, name, kgm, alloy]);
    return id;
  }
  /** A powder-coating job waiting on the in-house line, on an order promised `due` days from today. */
  async function coatingJob({ shade = "RAL 9010", kg = 400, due = 5, status = "planned", vendor = null, priority = "normal" } = {}) {
    const o = await f.order({ kg: kg ?? 300 });
    await f.seed("update orders set expected_dispatch_date=current_date+$2::int, priority=$3 where id=$1", [o.order, due, priority]);
    const id = f.next();
    await f.seed("insert into finishing_jobs(id,company_id,order_id,finishing_type,color_code,input_weight_kg,status,vendor_id) values($1,$2,$3,'powder_coating',$4,$5,$6,$7)", [id, i.company, o.order, shade, kg ?? 0, status, vendor]);
    return { ...o, finishing: id };
  }
  /** Billets in stock of an alloy. */
  async function billets({ kg = 5000, alloy = "6063" } = {}) {
    const id = f.next();
    await f.seed("insert into billet_batches(id,company_id,batch_number,alloy,temper,total_weight_kg,available_weight_kg,received_date,status) values($1,$2,$3,$4,'F',$5,$5,current_date-3,'available')", [id, i.company, `BB-10-${id.slice(-4)}`, alloy, kg]);
    return id;
  }
  /** Press billet and run-out settings (AP-029), as planning saves them. */
  async function pressSettings(machine, { min = 400, max = 900, standard = 700, butt = 25, runout = 45, front = 0.5, back = 0.5 } = {}) {
    await f.seed(`insert into press_billet_settings(company_id,machine_id,min_billet_mm,max_billet_mm,standard_billet_mm,butt_mm,runout_m,front_crop_m,back_crop_m,updated_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (company_id,machine_id) do update set standard_billet_mm=excluded.standard_billet_mm`, [i.company, machine, min, max, standard, butt, runout, front, back, i.owner]);
  }
  /** A calculated configurator project for a customer with a cutting list of [profile, cut mm, quantity] rows on 6 m stock. */
  async function configuration({ customer = i.customer2, status = "calculated", cuts = [], hardware = [["H-101", "Roller", 4]] } = {}) {
    const id = f.next();
    const role = (await f.db.query("select e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_attribute a on a.atttypid=t.oid join pg_class c on c.oid=a.attrelid where c.relname='system_profile_cuts' and a.attname='component_role' order by e.enumsortorder limit 1")).rows[0].enumlabel;
    const category = (await f.db.query("select e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_attribute a on a.atttypid=t.oid join pg_class c on c.oid=a.attrelid where c.relname='system_hardware_bom' and a.attname='hardware_category' order by e.enumsortorder limit 1")).rows[0].enumlabel;
    const series = f.next();
    await f.seed("insert into system_series(id,company_id,series_code,series_name,system_type) values($1,$2,$3,'Fixture sliding series','sliding_window')", [series, i.company, `SER-${series.slice(-4)}`]);
    await f.seed("insert into system_configurations(id,company_id,customer_id,series_id,width_mm,height_mm,status,configuration_number,project_name,finish_type,created_by) values($1,$2,$3,$4,1800,1500,$5,$6,'Villa 12 sliding window','mill_finish',$7)",
      [id, i.company, customer, series, status, `SYS-10-${id.slice(-4)}`, i.sales]);
    let order = 0;
    for (const [profileId, mm, quantity, code = "OM-2045", stock = 6000] of cuts) {
      await f.seed(`insert into system_profile_cuts(id,company_id,configuration_id,profile_id,component_role,profile_code,profile_name,cut_length_mm,quantity,total_length_m,section_weight_kg_per_m,total_weight_kg,stock_length_mm,sort_order)
        values($1,$2,$3,$4,$5::system_component_role,$6,'Sliding track',$7,$8,$9,0.95,$10,$11,$12)`.replace("::system_component_role", ""),
        [f.next(), i.company, id, profileId, role, code, mm, quantity, (mm * quantity) / 1000, (mm * quantity * 0.95) / 1000, stock, order++]);
    }
    for (const [code, name, quantity] of hardware) {
      await f.seed("insert into system_hardware_bom(id,company_id,configuration_id,item_code,item_name,hardware_category,quantity,unit) values($1,$2,$3,$4,$5,$6,$7,'pcs')", [f.next(), i.company, id, code, name, category, quantity]);
    }
    return id;
  }
  return { ...f, pushes, profile, coatingJob, billets, pressSettings, configuration };
}
