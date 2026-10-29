import { writeFileSync } from "node:fs";
import { createCommercialFixture, cid } from "./lib/commercial-upgrade-fixture.mjs";

const fixture = await createCommercialFixture();
try {
  const quote = await fixture.newQuote({ quantity_pieces: 100, minimum_billing_weight_kg: 700, expected_recovery_percent: 75 });
  for (const status of ["internal_review", "approved_for_sending", "sent", "customer_approved"]) {
    await fixture.db.query("update quotes set status=$2,approved_by=$3,approved_at=now() where id=$1", [quote, status, fixture.ids.owner]);
  }
  const review = await fixture.command("commercial_review_command", "quote.review", { quote_id: quote });
  const converted = await fixture.command("commercial_review_command", "quote.convert", { quote_id: quote, fingerprint: review.fingerprint, request_id: cid(9890) });
  const line = (await fixture.db.query("select total_weight_kg,billing_weight_kg from quote_items where quote_id=$1", [quote])).rows[0];
  const order = (await fixture.db.query("select requested_weight_kg,manufacturing_weight_kg from orders where id=$1", [converted.order_id])).rows[0];
  const orderLine = (await fixture.db.query("select quantity_kg,manufacturing_weight_kg from order_items where order_id=$1", [converted.order_id])).rows[0];
  const report = { feature: 89, scope: "Actual quote save, commercial review and order conversion in a disposable full-schema PGlite database", quote: line, order, order_line: orderLine, expected_manufacturing_kg: Number(line.total_weight_kg) };
  report.status = Number(order.manufacturing_weight_kg) === report.expected_manufacturing_kg && Number(orderLine.manufacturing_weight_kg) === report.expected_manufacturing_kg ? "passed" : "failed_acceptance";
  writeFileSync("docs/evidence/EOS_UNCHECKED_ACCEPTANCE_2026-10-29/billet-basis-after.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
} finally { await fixture.close(); }
