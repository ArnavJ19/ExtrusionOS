// R03: owner/admin hard deletes of maintenance / die / calibration history (no audit trigger on these tables).
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const ctx = await current();
const auditCount = (id) => ctx.q(`select (select count(*) from public.audit_logs_enterprise where entity_id='${id}') ent, (select count(*) from public.audit_logs where entity_id='${id}') basic, (select count(*) from public.sensitive_action_logs where entity_id='${id}') sens`);

// a) open breakdown with a repair bill locks press B
const [bd] = await ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, start_time, issue_description, status, cost, vendor_id, bill_number, bill_date)
  values ('${ids.company}', 'PB', 'extrusion_press', current_date, now() - interval '5 hours', 'Container liner cracked', 'open', 25000, '${ids.vendor}', 'RB-77', current_date) returning id`);
out("R03a press after breakdown", await ctx.q(`select status from public.machines where id='${ids.pressB}'`));
out("R03a repair expense", await ctx.q(`select total_amount, approval_status, payment_status from public.expense_ledger where source_record_id='${bd.id}'`));
const early = await ctx.attempt(() => ctx.as(ids.productionManager, `select public.return_machine_to_service_atomic('${ids.pressB}', 'ok') id`));
out("R03a control: sign-off while breakdown open", early.ok ? "accepted" : early.error);
const del = await ctx.attempt(() => ctx.asExec(ids.admin ?? ids.owner, `delete from public.breakdown_logs where id='${bd.id}'`));
out("R03a owner deletes the open breakdown", del.ok ? "accepted" : del.error);
out("R03a after delete", { rows: await ctx.q(`select count(*) n from public.breakdown_logs where id='${bd.id}'`), expense: await ctx.q(`select total_amount, approval_status, deleted_at is not null deleted from public.expense_ledger where source_record_id='${bd.id}'`), audit: await auditCount(bd.id) });
const signoff = await ctx.attempt(() => ctx.as(ids.productionManager, `select public.return_machine_to_service_atomic('${ids.pressB}', 'Back in service') id`));
out("R03a sign-off after the delete (no root cause / repair ever recorded)", signoff.ok ? "accepted" : signoff.error);
out("R03a press now", await ctx.q(`select status from public.machines where id='${ids.pressB}'`));

// b) resolved breakdown (downtime history) deleted
const [bd2] = await ctx.as(ids.productionManager, `insert into public.breakdown_logs (company_id, machine_id, machine_type, breakdown_date, start_time, issue_description, status)
  values ('${ids.company}', 'PA', 'extrusion_press', current_date, now() - interval '8 hours', 'Hydraulic pump failure', 'open') returning id`);
await ctx.asExec(ids.productionManager, `update public.breakdown_logs set status='resolved', root_cause='Pump wear', action_taken='Pump replaced' where id='${bd2.id}'`);
out("R03b downtime recorded", await ctx.q(`select downtime_minutes from public.breakdown_logs where id='${bd2.id}'`));
const del2 = await ctx.attempt(() => ctx.asExec(ids.owner, `delete from public.breakdown_logs where id='${bd2.id}'`));
out("R03b owner deletes resolved breakdown", del2.ok ? "accepted" : del2.error);
out("R03b trace left", await auditCount(bd2.id));

// c) calibration record and die correction deleted
const [cal] = await ctx.as(ids.quality, `insert into public.calibration_records (company_id, equipment_name, equipment_id_code, calibration_date, next_due_date, status, calibrated_by)
  values ('${ids.company}', 'Spectrometer', 'SPEC-1', current_date - 400, current_date - 35, 'overdue', 'NABL lab') returning id`).catch(async (e) => { out("R03c quality insert calibration", e.message); return ctx.as(ids.owner, `insert into public.calibration_records (company_id, equipment_name, equipment_id_code, calibration_date, next_due_date, status, calibrated_by) values ('${ids.company}', 'Spectrometer', 'SPEC-1', current_date - 400, current_date - 35, 'overdue', 'NABL lab') returning id`); });
const del3 = await ctx.attempt(() => ctx.asExec(ids.owner, `delete from public.calibration_records where id='${cal.id}'`));
out("R03c owner deletes overdue spectrometer calibration", del3.ok ? "accepted" : del3.error);
out("R03c trace left", await auditCount(cal.id));
const [dc] = await ctx.as(ids.productionManager, `insert into public.die_corrections (company_id, die_id, correction_date, correction_reason, cost, result_status) values ('${ids.company}', '${ids.die}', current_date, 'bearing_issue', 8000, 'failed') returning id`);
const del4 = await ctx.attempt(() => ctx.asExec(ids.owner, `delete from public.die_corrections where id='${dc.id}'`));
out("R03c owner deletes a failed die correction", del4.ok ? "accepted" : del4.error);
out("R03c trace left", await auditCount(dc.id));
