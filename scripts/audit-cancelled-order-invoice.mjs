import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createRetainedInvoiceFixture,invoiceFixtureIds as f} from "./lib/retained-invoice-fixture.mjs";
import {createInvoiceActionFixture} from "./lib/retained-invoice-actions-fixture.mjs";

// Current candidate smoke. The original failing diagnostic is retained in the R10 report/artifact.
const db=await createRetainedInvoiceFixture();
try{
  const fixture=createInvoiceActionFixture(db);
  await db.exec(`set test.actor='${f.actor}';set role authenticated;`);
  await db.query("update orders set current_stage='cancelled' where id=$1",[f.order]);
  const result=await fixture.invoke("saveInvoiceAction",{order_id:f.order,dispatch_id:f.dispatch,invoice_date:"2026-10-19",place_of_supply_state_code:"24",status:"draft"});
  assert.equal(result.success,true,JSON.stringify(result));
  const invoice=(await db.query("select order_id,dispatch_id,subtotal,tax_total,grand_total,amount_paid from invoices where id=$1",[result.invoiceId])).rows[0];
  assert.equal(invoice.grand_total,"1180.00");
  await db.exec("reset role;");
  const physical=(await db.query("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[f.batch])).rows[0];
  assert.deepEqual(physical,{total_weight_kg:"40.000",length_m:"20.000",quantity_pieces:4});
  const report={localCandidateSmokePassed:true,proof:"Actual invoice action and extracted candidate SQL in disposable PGlite with a synthetic active session/transport",
    boundary:"No Supabase migration, hosted JWT/RLS, independent-session concurrency or deployment proof",invoice,physical};
  if(process.argv[2]){const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});writeFileSync(resolve(output,"retained-invoice-smoke.json"),JSON.stringify(report,null,2)+"\n");}
  console.log(JSON.stringify(report,null,2));
}finally{await db.close();}
