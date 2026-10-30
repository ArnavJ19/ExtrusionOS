import { build } from "esbuild";

const hash = "a".repeat(64);
const lineId = "bc000000-0000-4000-8000-000000000930";
const orderId = "bc000000-0000-4000-8000-000000000940";
const vendorId = "bc000000-0000-4000-8000-000000000950";
const billId = "bc000000-0000-4000-8000-000000000960";
const matchSnapshot = {
  matched: false,
  exceptions: ["Accepted receipt quantity is short for 6063 billet."],
  lines: [{ description: "6063 billet", unit: "kg", quantity: 20, accepted_received: 10, previously_billed: 0, rate: 10, po_rate: 10, base_amount: 200, tax_amount: 36 }],
  expected: { base_amount: 200, tax_amount: 36, freight_amount: 20, discount_amount: 0, total_amount: 256 },
  actual: { base_amount: 200, tax_amount: 36, freight_amount: 20, discount_amount: 0, total_amount: 256 }
};
const matchedSnapshot = { ...matchSnapshot, matched: true, exceptions: [], lines: [{ ...matchSnapshot.lines[0], accepted_received: 20 }] };
const dashboard = {
  kind: "dashboard",
  vendors: [{ id: vendorId, vendor_name: "Fixture Aluminium Supply" }],
  orders: [{ id: orderId, po_number: "PO-2026-00001", vendor_id: vendorId, vendor_name: "Fixture Aluminium Supply", order_date: "2026-10-29", status: "open",
    expected_freight_amount: 20, expected_discount_amount: 0,
    lines: [{ id: lineId, line_number: 1, description: "6063 billet", specification: "6063 T6 billet", unit: "kg", ordered_quantity: 100, unit_rate: 10, gst_percent: 18,
      received_quantity: 10, accepted_quantity: 10, rejected_quantity: 0, held_quantity: 0, billed_quantity: 0 }] }],
  bills: []
};

const actionStub = `
  const fixtureHash=${JSON.stringify(hash)}, vendorId=${JSON.stringify(vendorId)}, orderId=${JSON.stringify(orderId)}, lineId=${JSON.stringify(lineId)}, billId=${JSON.stringify(billId)};
  const matchSnapshot=${JSON.stringify(matchSnapshot)}, matchedSnapshot=${JSON.stringify(matchedSnapshot)};
  export async function purchaseLifecycleAction(input) {
    window.fixture.calls.push(input);
    if (window.fixture.failCommand===input.command) {
      const failure=window.fixture.failure;
      window.fixture.failCommand=null;
      if(failure==='throw') throw new Error('Response lost after submission');
      return {success:false,uncertain:true,error:'Response unavailable; retry the exact request.'};
    }
    if(input.command==='order.load') return {success:true,data:{kind:'order_loaded',order:${JSON.stringify(dashboard.orders[0])}}};
    if(input.command==='document.review') return {success:true,data:{kind:'document_reviewed',source_id:'bc000000-0000-4000-8000-000000000970',review_revision:1,review_hash:'b'.repeat(32),bill_id:null,idempotent_replay:false}};
    if(input.command==='bill.create') return {success:true,data:{kind:'bill_created',id:billId,status:'draft',match_status:'unmatched',match_snapshot:matchSnapshot,idempotent_replay:false}};
    if(input.command==='bill.match') return {success:true,data:{kind:'bill_match',id:billId,status:'draft',match_status:'matched',match_snapshot:matchedSnapshot,idempotent_replay:false}};
    if(input.command==='bill.post') return {success:true,data:{kind:'bill_posted',id:billId,expense_ledger_id:'bc000000-0000-4000-8000-000000000980',approval_status:'pending_approval',idempotent_replay:false}};
    if(input.command==='receipt.record') return {success:true,data:{kind:'receipt_recorded',id:'bc000000-0000-4000-8000-000000000990',idempotent_replay:false}};
    if(input.command==='order.issue') return {success:true,data:{kind:'order_issued',id:orderId,po_number:'PO-2026-00001',status:'open',idempotent_replay:false}};
    if(input.command==='dashboard.load') return {success:true,data:${JSON.stringify(dashboard)}};
    return {success:true,data:{kind:'order_created',id:orderId,po_number:'PO-2026-00001',status:'draft',idempotent_replay:false}};
  }
  export async function extractSupplierDocumentAction(input) {
    window.fixture.uploads.push(input);
    return {success:true,data:{source_id:'bc000000-0000-4000-8000-000000000970',source_hash:fixtureHash,source_name:input.fileName,
      proposal:{vendor_name:'Fixture Aluminium Supply',invoice_number:'INV-001',invoice_date:'2026-10-29',quantity:20,unit:'kg',rate:10,description:'6063 billet',base_amount:200,tax_amount:36,freight_amount:20,discount_amount:0,total_amount:256,
        lines:[{description:'6063 billet',quantity:20,unit:'kg',rate:10,base_amount:200,tax_amount:36}]},
      uncertain_fields:['vendor_id','purchase_order_id'],review_revision:0,review_hash:null,reviewed_payload:null}};
  }
`;

export async function buildPurchaseLifecycleBrowserBundle() {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "purchase-lifecycle-browser.tsx", loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { PurchaseLifecycle } from "./components/modules/vendors/purchase-lifecycle";
      window.fixture={calls:[],uploads:[],failCommand:null,failure:'throw'};
      const root=createRoot(document.getElementById("app"));
      window.mountPurchaseLifecycle=()=>root.render(<PurchaseLifecycle initialData={${JSON.stringify(dashboard)}} initialError={null} role="owner"/>);
      window.mountPurchaseLifecycle();
    ` },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    plugins: [{ name: "purchase-lifecycle-browser-actions", setup(api) {
      api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture-link" }));
      api.onLoad({ filter: /.*/, namespace: "fixture-link" }, () => ({ contents: "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}", loader: "js", resolveDir: process.cwd() }));
      api.onResolve({ filter: /^@\/lib\/actions\/purchase-lifecycle$/ }, () => ({ path: "purchase-lifecycle-actions", namespace: "fixture" }));
      api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: actionStub, loader: "js", resolveDir: process.cwd() }));
    } }]
  });
  return bundle.outputFiles[0].text;
}
