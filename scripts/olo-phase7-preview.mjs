// Order lifecycle Phase 7 screens on a replayed local database with synthetic records only: one order with a delivered
// dispatch of two bundles (proof of delivery on file, no receipt yet), an overdue invoice, and a complaint logged by
// sales for QA to work. Prints the screen URLs. Usage: node --experimental-strip-types scripts/olo-phase7-preview.mjs
import { createOloPhase7BrowserFixture } from "./lib/olo-phase7-browser-fixture.mjs";

process.env.OLO_PHASE7_FIXTURE_PORT ??= "4195";
const fx = await createOloPhase7BrowserFixture();
await fx.start();
const i = fx.ids;
const data = await fx.run(async () => {
  const f = fx.f;
  const o = await f.order({ kg: 228 });
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 228, number: "JOB-P7-A" });
  for (const tag of ["P7-B1", "P7-B2"]) await f.bundle({ order: o.order, job, tag });
  const s = await f.call("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234", transporter_id: i.transporter }, i.dispatchUser);
  for (const tag of ["P7-B1", "P7-B2"]) await f.call("ap_dispatch", "scan", { session_id: s.id, tag }, i.dispatchUser);
  const d = await f.writeDispatch(s.id);
  await f.call("ap_dispatch", "complete", { id: s.id, dispatch_id: d }, i.dispatchUser);
  const pod = `${i.company}/dispatches/${d}/proof-of-delivery/pod.jpg`;
  await f.seed("insert into technical_documents(company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,storage_bucket,storage_path,approval_status,uploaded_by) values($1,'proof_of_delivery','dispatch',$2,'pod.jpg',$3,'documents',$3,'approved',$4)", [i.company, d, pod, i.owner]);
  await f.db.query("update dispatches set delivery_status='delivered', delivered_at=now(), proof_of_delivery_url=$2 where id=$1", [d, pod]);
  const inv = "0e7f0000-0000-4000-8000-000000000001";
  await f.seed(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code,igst_amount)
    values($1,$2,$3,$4,$5,'OMX/26-27/0145',current_date-40,current_date-10,'generated',120000,0,120000,0,'27','07',0)`, [inv, i.company, i.customer2, o.order, d]);
  const c = await f.call("customer_complaint_command", "log", { id: "0e7f0000-0000-4000-8000-000000000002", order_id: o.order, dispatch_id: d, category: "surface_finish", severity: "high",
    description: "Pitting marks on the visible face of the sash profiles" }, i.sales);
  return { dispatch: d, invoice: inv, complaint: c.complaint.id };
});
const u = (screen, user, extra = "") => `${fx.base}/?screen=${screen}&user=${user}${extra}`;
console.log(JSON.stringify({ base: fx.base, screens: [
  u("receipt", i.sales, `&id=${data.dispatch}`), u("log", i.sales), u("complaint", i.quality, `&id=${data.complaint}`), u("receivable", i.accounts, `&id=${data.invoice}`)] }, null, 2));
process.on("SIGINT", async () => { await fx.close(); process.exit(0); });
