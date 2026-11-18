import { addBatch6Helpers, createBatch6Fixture, ids as baseIds, istDay } from "./autopilot-batch6-fixture.mjs";

export { istDay };
export const ids = baseIds;

/** First and last day of the IST month before this one, as YYYY-MM-DD. */
export function lastMonthRange() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), period: start.toISOString().slice(0, 7) };
}

// Autopilot batch 7 fixture. Builds on the batch 6 fixture (full migration chain, synthetic Omalco company, one user per
// role, customers with GSTINs and open invoices, approved billet rate) and adds helpers for decided proposals, purchase
// orders written through the real purchase command, red order-line predictions and receipts dated in a chosen month.
export async function createBatch7Fixture() {
  const f = addBatch6Helpers(await createBatch6Fixture());
  return addBatch7Helpers(f);
}

export function addBatch7Helpers(f) {
  const i = baseIds;
  /** A proposal created `daysAgo` and decided `minutes` later (status open/accepted/edited/rejected/expired/stale). */
  async function proposal({ type = "quote.reprice", status = "accepted", daysAgo = 3, minutes = 30, decidedBy = i.owner, role = "owner", edited = [], payload = { quotes: 1, lines: 1, rate_day: "x" }, decision = null, rule = "rule-v1", target } = {}) {
    const id = f.next();
    const decided = ["accepted", "edited", "rejected"].includes(status);
    await f.seed(`insert into proposals(id,company_id,proposal_type,target_key,title,payload,inputs,inputs_fingerprint,rule_key,reason,decide_roles,status,created_at,expires_at,decided_by,decided_at,decision_payload,edited_fields,decided_role)
      values($1,$2,$3,$4,'Fixture proposal',$5,'{}','fp',$6,'Fixture reason',array['owner','admin','sales_manager'],$7,now()-make_interval(days=>$8::int),now()+interval '3 days',
        $9,case when $10 then now()-make_interval(days=>$8::int)+make_interval(mins=>$11::int) end,$12,$13,$14)`,
      [id, i.company, type, target ?? `fx:${id}`, payload, rule, status, daysAgo, decided ? decidedBy : null, decided, minutes, decision, edited, decided ? role : null]);
    return id;
  }
  /** A purchase order created through the real purchase command (price checks fire), optionally issued. */
  async function purchaseOrder({ vendor = i.vendor, lines = [{ description: "Stretch film 23 micron", unit: "kg", rate: 100 }], issue = true, reasons, actor = i.accounts, daysAgo = 0 } = {}) {
    const created = await f.call("purchase_lifecycle_command", "order.create", {
      idempotency_key: f.next(), vendor_id: vendor, order_date: istDay(-daysAgo), expected_freight_amount: 0, expected_discount_amount: 0,
      lines: lines.map(l => ({ description: l.description, specification: l.specification ?? "Standard grade", unit: l.unit, quantity: l.quantity ?? 10, rate: l.rate, gst_percent: 18 })),
      ...(reasons ? { price_reasons: reasons } : {})
    }, actor);
    if (issue) await f.call("purchase_lifecycle_command", "order.issue", { purchase_order_id: created.id }, actor);
    return created.id;
  }
  /** Today's red prediction for an open order line (as the nightly AP-063 run writes it). */
  async function redLine({ kg = 600, due = 2, estimate = 6, blocker = "planned production", order } = {}) {
    const o = order ?? await f.order({ kg, pieces: 100 });
    await f.seed(`insert into order_line_predictions(company_id,order_item_id,order_id,predicted_on,due_date,estimated_date,blocker,is_red,basis)
      values($1,$2,$3,(now() at time zone 'Asia/Kolkata')::date,current_date+$4::int,case when $5::int is null then null else current_date+$5::int end,$6,true,'{"rule":"fixture"}')
      on conflict (company_id,order_item_id,predicted_on) do update set estimated_date=excluded.estimated_date, blocker=excluded.blocker, is_red=true`,
      [i.company, o.line, o.order, due, estimate, blocker]);
    return o;
  }
  const ap = (rpc, command, payload = {}, actor = i.owner) => f.call(rpc, command, payload, actor);
  return { ...f, proposal, purchaseOrder, redLine, ap };
}
