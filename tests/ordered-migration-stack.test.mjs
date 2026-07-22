import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationNames = [
  "20260718020000_production_quality_packaging_handoffs.sql",
  "20260718020500_finishing_route_and_quality_yield.sql",
  "20260718021000_dispatch_readiness_and_delivery.sql",
  "20260718021500_floor_output_and_finishing_workflows.sql",
  "20260718040000_report_builder_data_sources.sql",
  "20260718050000_customer_accepted_quote_orders.sql",
  "20260718051000_quote_status_transitions.sql",
  "20260718052000_invoice_packing_line_parity.sql",
  "20260718053000_reservation_consumption_safety.sql"
];

const migrations = Object.fromEntries(
  migrationNames.map((name) => [
    name,
    readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8")
  ])
);

const sql = (name) => migrations[name];

test("ordered migration stack has balanced function bodies and transaction wrappers", () => {
  for (const [name, body] of Object.entries(migrations)) {
    const dollarQuotes = body.match(/\$\$/g)?.length ?? 0;
    assert.equal(dollarQuotes % 2, 0, `${name} has an unbalanced $$ body`);
  }

  for (const name of [
    migrationNames[0],
    migrationNames[1],
    migrationNames[2],
    migrationNames[3],
    migrationNames[8]
  ]) {
    assert.match(sql(name).trimStart(), /^begin;/i, `${name} must begin transactionally`);
    assert.match(sql(name).trimEnd(), /commit;$/i, `${name} must commit transactionally`);
  }
});

test("production completion reconciles linked billet input and permits only requirement-free legacy jobs", () => {
  const body = sql(migrationNames[3]);
  assert.match(body, /from public\.foundry_billets[\s\S]*production_job_id = p_job_id[\s\S]*for update;/);
  assert.match(body, /from public\.order_billet_requirements requirement/);
  assert.match(body, /coalesce\(v_job\.required_billet_count, 0\) > 0 or v_has_allocation_requirement/);
  assert.match(body, /p_actual_weight_kg \+ v_existing_scrap_kg \+ coalesce\(p_scrap_weight_kg, 0\)/);
  assert.match(body, /greatest\(0\.5, round\(\(v_input_weight_kg \* 0\.01\)/);
  assert.match(body, /abs\(v_input_weight_kg - v_accounted_weight_kg\) > v_tolerance_kg/);
  assert.match(body, /Production scrap records cannot contain negative weight/);
});

test("terminal QC and packaging records cannot be silently rewritten", () => {
  const qc = sql(migrationNames[1]);
  const packaging = sql(migrationNames[0]);
  assert.match(qc, /guard_terminal_quality_inspection/);
  assert.match(qc, /old\.status in \('approved', 'rejected', 'rework'\)/);
  assert.match(qc, /before update or delete on public\.quality_inspections/);
  assert.match(qc, /qc-disposition:/);

  assert.match(packaging, /packaging_jobs_one_active_production_source_idx/);
  assert.match(packaging, /guard_terminal_packaging_job/);
  assert.match(packaging, /guard_terminal_packaging_material/);
  assert.match(packaging, /Packaging cannot be cancelled after its production output is allocated/);
  assert.match(packaging, /v_existing_status in \('completed', 'cancelled'\)/);
  assert.match(packaging, /coalesce\(nullif\(new\.actual_pieces, 0\), new\.pieces, 0\)/);
  assert.ok(
    packaging.indexOf("delete from public.packaging_job_materials")
      < packaging.indexOf("set status = v_requested_status"),
    "packaging materials must be finalized before terminal status"
  );
});

test("activated dispatches freeze weight and packing allocation while atomic creation remains possible", () => {
  const body = sql(migrationNames[2]);
  assert.match(body, /old\.delivery_status <> 'pending'[\s\S]*new\.total_weight_kg is distinct from old\.total_weight_kg/);
  assert.match(body, /guard_active_dispatch_packing/);
  assert.match(body, /Packing allocation is immutable after dispatch activation/);
  assert.match(body, /delivery_status', 'pending'/);
  assert.ok(
    body.indexOf("private.save_dispatch_atomic(")
      < body.indexOf("set delivery_status = 'dispatched'"),
    "ready dispatch must write packing while pending, then activate"
  );
  assert.match(body, /count\(\*\) filter \(where delivery_status <> 'pending'\)/);
  assert.match(body, /sum\(pli\.net_weight_kg\)/);
});

test("quote-linked order insertion enforces role, customer acceptance, nonempty lines, and drawings", () => {
  const orderGate = sql(migrationNames[5]);
  const quoteTransitions = sql(migrationNames[6]);
  assert.match(orderGate, /private\.get_current_user_role\(\) not in/);
  assert.match(orderGate, /Permission denied for orders/);
  assert.match(orderGate, /v_quote_status <> 'customer_approved'/);
  assert.match(orderGate, /A customer-approved quote must contain at least one item/);
  assert.match(orderGate, /lower\(coalesce\(item\.drawing_approval_status, ''\)\) <> 'approved'/);
  assert.match(orderGate, /mark_linked_quote_converted/);
  assert.match(quoteTransitions, /new\.low_margin_approval_required/);
  assert.match(quoteTransitions, /order-quote:/);
  assert.match(quoteTransitions, /converted_to_order/);
});

test("rejected finishing has evidence and a bounded one-time server-owned retry", () => {
  const body = sql(migrationNames[3]);
  assert.match(body, /Rejected finishing requires a positive rejection weight/);
  assert.match(body, /Rejected finishing requires remarks explaining the disposition/);
  assert.match(body, /finishing_jobs_one_retry_per_rejection_idx/);
  assert.match(body, /retry_rejected_finishing_job_atomic/);
  assert.match(body, /Only a rejected finishing job can create a retry/);
  assert.match(body, /v_recoverable_weight_kg := least/);
  assert.match(body, /retry_of_finishing_job_id/);
  assert.match(body, /grant execute on function public\.retry_rejected_finishing_job_atomic\(uuid, date, text\)/);
});

test("invoice packing lineage is serialized and reservation consumption remains server-owned", () => {
  const invoice = sql(migrationNames[7]);
  const reservations = sql(migrationNames[8]);
  assert.match(invoice, /invoice-packing:/);
  assert.match(invoice, /dispatch-invoice:/);
  assert.match(invoice, /Invoice source cannot be changed after packing lines are created/);
  assert.match(invoice, /Invoice order and customer must match the selected dispatch/);
  assert.match(invoice, /packing_list_items_tenant_read/);
  assert.match(reservations, /drop policy if exists "profile_stock_consumptions tenant insert"/);
  assert.doesNotMatch(reservations, /create policy[\s\S]*profile_stock_consumptions[\s\S]*for insert/i);
});
