import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCommercialFixture, commercialIds as ids, cid } from "../scripts/lib/commercial-upgrade-fixture.mjs";

const sourceHash = (text) => createHash("sha256").update(text, "utf8").digest("hex");

test('58/59/95/98: draft correction changes PO atomically, mixed-case duplicate lines fail, and a retired supplier can finish an existing PO',async()=>{
  const f=await createCommercialFixture();
  const vendor=cid(5800),canonical=cid(5801);
  const call=(command,payload)=>f.command('purchase_lifecycle_command',command,payload);
  try{
    for(const [id,name] of [[vendor,'Recorded supplier'],[canonical,'Canonical supplier']])await f.db.query("insert into vendors(id,company_id,vendor_name,vendor_type,gst_number) values($1,$2,$3,'aluminum_billets','27AAACX1234A1Z1')",[id,ids.company,name]);
    const createOrder=async key=>{
      const po=await call('order.create',{idempotency_key:cid(key),vendor_id:vendor,order_date:'2026-10-29',expected_freight_amount:0,expected_discount_amount:0,
        lines:[{description:'6063 billet',specification:'6063 T6 seven inch',unit:'kg',quantity:100,rate:10,gst_percent:18}]});
      await call('order.issue',{purchase_order_id:po.id});
      return {...po,line:(await f.db.query('select id from purchase_order_lines where purchase_order_id=$1',[po.id])).rows[0].id};
    };
    const a=await createOrder(5802),b=await createOrder(5803);
    const doc=await call('document.create',{source_hash:sourceHash('Corrected PO invoice'),source_name:'corrected.txt',proposal:{},uncertain_fields:['purchase_order_id']});
    const reviewed=po=>({vendor_id:vendor,purchase_order_id:po.id,invoice_number:'CORRECT-001',invoice_date:'2026-10-29',due_date:null,
      tax_amount:18,freight_amount:0,discount_amount:0,total_amount:118,lines:[{purchase_order_line_id:po.line,quantity:10,unit:'kg',rate:10,base_amount:100,tax_amount:18}]});
    const original=await call('document.review',{source_id:doc.id,source_hash:doc.source_hash,expected_revision:0,reviewed:reviewed(a)});
    const bill=await call('bill.create',{source_id:doc.id,source_hash:doc.source_hash,review_revision:original.review_revision,review_hash:original.review_hash});
    const duplicate=reviewed(a);duplicate.lines.push({...duplicate.lines[0],purchase_order_line_id:a.line.toUpperCase()});duplicate.tax_amount=36;duplicate.total_amount=236;
    await assert.rejects(call('document.review',{source_id:doc.id,source_hash:doc.source_hash,expected_revision:1,reviewed:duplicate}),/only once/);
    const corrected=await call('document.review',{source_id:doc.id,source_hash:doc.source_hash,expected_revision:1,reviewed:reviewed(b)});
    assert.equal(corrected.bill_id,bill.id);
    assert.equal((await f.db.query('select purchase_order_id from supplier_purchase_bills where id=$1',[bill.id])).rows[0].purchase_order_id,b.id);
    assert.equal((await f.db.query('select purchase_order_line_id from supplier_purchase_bill_lines where supplier_bill_id=$1',[bill.id])).rows[0].purchase_order_line_id,b.line);
    const preview=await f.command('master_cleanup_command','review.preview',{entity_type:'vendors',source_id:vendor,target_id:canonical});
    await f.command('master_cleanup_command','review.propose',{id:cid(5804),entity_type:'vendors',source_id:vendor,target_id:canonical,reason:'Same verified GST registration',fingerprint:preview.fingerprint});
    await f.actor(ids.admin);await f.command('master_cleanup_command','review.approve',{id:cid(5804),entity_type:'vendors'});await f.actor();
    const receipt={idempotency_key:cid(5805),purchase_order_id:b.id,receipt_date:'2026-10-29',reference:'GRN-CORRECT',lines:[{purchase_order_line_id:b.line,received_quantity:10,accepted_quantity:10,rejected_quantity:0,held_quantity:0,note:null}]};
    await assert.rejects(call('receipt.record',{...receipt,lines:[{...receipt.lines[0],received_quantity:10.0004,accepted_quantity:10.0004}]}),/three decimals/);
    await call('receipt.record',receipt);
    const finalReview=await call('document.review',{source_id:doc.id,source_hash:doc.source_hash,expected_revision:2,reviewed:reviewed(b)});
    const matched=await call('bill.match',{bill_id:bill.id});assert.equal(matched.match_status,'matched');
    const posted=await call('bill.post',{bill_id:bill.id,source_hash:doc.source_hash,review_revision:finalReview.review_revision,review_hash:finalReview.review_hash});
    assert.ok(posted.expense_ledger_id);
    assert.equal((await f.db.query('select vendor_name_snapshot from supplier_purchase_bills where id=$1',[bill.id])).rows[0].vendor_name_snapshot,'Recorded supplier');
  }finally{await f.close();}
});

test("purchase lifecycle keeps partial receipts, reviewed source versions, invoice identity, and expense posting atomic", async () => {
  const f = await createCommercialFixture();
  const vendorId = cid(500);
  const orderKey = cid(501);
  try {
    await f.actor();
    await f.db.query("insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Fixture Billet Supply','aluminum_billets')", [vendorId, ids.company]);

    const orderPayload = {
      idempotency_key: orderKey, vendor_id: vendorId, order_date: "2026-10-29",
      expected_freight_amount: 100, expected_discount_amount: 0,
      lines: [{ description: "6063 billet", specification: "6063 T6, 7 inch billet", unit: "kg", quantity: 100, rate: 10, gst_percent: 18 }]
    };
    const order = await f.command("purchase_lifecycle_command", "order.create", orderPayload);
    assert.equal(order.kind, "order_created");
    assert.equal(order.status, "draft");
    assert.equal((await f.command("purchase_lifecycle_command", "order.create", orderPayload)).id, order.id);
    await assert.rejects(f.command("purchase_lifecycle_command", "order.create", { ...orderPayload, lines: [{ ...orderPayload.lines[0], rate: 11 }] }), /retry key was used for different details/);
    await f.command("purchase_lifecycle_command", "order.issue", { purchase_order_id: order.id });

    const orderLineId = (await f.db.query("select id from purchase_order_lines where purchase_order_id=$1", [order.id])).rows[0].id;
    const firstReceipt = { idempotency_key: cid(502), purchase_order_id: order.id, receipt_date: "2026-10-29", reference: "GRN-001",
      lines: [{ purchase_order_line_id: orderLineId, received_quantity: 40, accepted_quantity: 35, rejected_quantity: 2, held_quantity: 3, note: "Three kg held for certificate check" }] };
    const firstReceiptResult = await f.command("purchase_lifecycle_command", "receipt.record", firstReceipt);
    assert.equal(firstReceiptResult.kind, "receipt_recorded");
    const uncertainReplay = await f.command("purchase_lifecycle_command", "receipt.record", firstReceipt);
    assert.equal(uncertainReplay.id, firstReceiptResult.id);
    assert.equal(uncertainReplay.idempotent_replay, true);
    assert.equal((await f.db.query("select count(*)::int as count from purchase_receipts where company_id=$1 and idempotency_key=$2", [ids.company, firstReceipt.idempotency_key])).rows[0].count, 1);
    assert.equal((await f.db.query("select count(*)::int as count from purchase_receipt_lines where receipt_id=$1", [firstReceiptResult.id])).rows[0].count, 1);
    await assert.rejects(f.command("purchase_lifecycle_command", "receipt.record", { ...firstReceipt, reference: "Changed retry" }), /retry key was used for different details/);
    await assert.rejects(f.command("purchase_lifecycle_command", "receipt.record", { ...firstReceipt, idempotency_key: cid(503), lines: [{ ...firstReceipt.lines[0], received_quantity: 61, accepted_quantity: 61, rejected_quantity: 0, held_quantity: 0 }] }), /exceeds remaining ordered quantity/);
    await assert.rejects(f.command("purchase_lifecycle_command", "receipt.record", { ...firstReceipt, idempotency_key: cid(507), receipt_date: "2999-01-01" }), /future \(Asia\/Kolkata\)/);

    const invoiceText1 = "Vendor: Fixture Billet Supply\nInvoice Number: INV-001\nInvoice Date: 2026-10-29\nLine: 6063 billet | 40 | kg | 10 | 400 | 72\nFreight: 40\nTotal: 512";
    const document1 = await f.command("purchase_lifecycle_command", "document.create", {
      source_hash: sourceHash(invoiceText1), source_name: "invoice-one.txt",
      proposal: { invoice_number: "INV-001" }, uncertain_fields: ["vendor_id", "purchase_order_id"]
    });
    assert.equal(document1.kind, "document");
    assert.equal((await f.command("purchase_lifecycle_command", "document.create", {
      source_hash: sourceHash(invoiceText1), source_name: "renamed-copy.txt", proposal: { invoice_number: "INV-001" }, uncertain_fields: []
    })).id, document1.id);

    const reviewed1 = {
      vendor_id: vendorId, purchase_order_id: order.id, invoice_number: "INV-001", invoice_date: "2026-10-29", due_date: null,
      tax_amount: 72, freight_amount: 40, discount_amount: 0, total_amount: 512,
      lines: [{ purchase_order_line_id: orderLineId, quantity: 40, unit: "kg", rate: 10, base_amount: 400, tax_amount: 72 }]
    };
    const review1 = await f.command("purchase_lifecycle_command", "document.review", {
      source_id: document1.id, source_hash: document1.source_hash, expected_revision: 0, reviewed: reviewed1
    });
    assert.equal(review1.review_revision, 1);
    const bill1 = await f.command("purchase_lifecycle_command", "bill.create", {
      source_id: document1.id, source_hash: document1.source_hash, review_revision: review1.review_revision, review_hash: review1.review_hash
    });
    const reopenedBill = await f.command("purchase_lifecycle_command", "bill.load", { bill_id: bill1.id });
    assert.equal(reopenedBill.kind, "bill_loaded");
    assert.equal(reopenedBill.bill.source.source_hash, document1.source_hash);
    assert.equal(reopenedBill.bill.source.reviewed_payload.invoice_number, "INV-001");
    assert.equal(reopenedBill.bill.lines[0].purchase_order_line_id, orderLineId);
    assert.equal(reopenedBill.bill.order.id, order.id);
    assert.equal((await f.command("purchase_lifecycle_command", "order.load", { purchase_order_id: order.id })).order.lines[0].id, orderLineId);
    assert.equal(bill1.status, "draft");
    assert.equal(bill1.match_status, "unmatched");
    assert.ok(bill1.match_snapshot.exceptions.some((value) => /accepted receipt quantity is short/i.test(value)));
    await assert.rejects(f.command("purchase_lifecycle_command", "bill.post", {
      bill_id: bill1.id, source_hash: document1.source_hash, review_revision: review1.review_revision, review_hash: review1.review_hash
    }), /unmatched and cannot be posted/);

    const secondReceipt = { idempotency_key: cid(504), purchase_order_id: order.id, receipt_date: "2026-10-29", reference: "GRN-002",
      lines: [{ purchase_order_line_id: orderLineId, received_quantity: 25, accepted_quantity: 25, rejected_quantity: 0, held_quantity: 0, note: null }] };
    await f.actor();
    await f.command("purchase_lifecycle_command", "receipt.record", secondReceipt);
    const matched1 = await f.command("purchase_lifecycle_command", "bill.match", { bill_id: bill1.id });
    assert.equal(matched1.match_status, "matched");
    const posted1 = await f.command("purchase_lifecycle_command", "bill.post", {
      bill_id: bill1.id, source_hash: document1.source_hash, review_revision: review1.review_revision, review_hash: review1.review_hash
    });
    assert.equal(posted1.kind, "bill_posted");
    assert.equal(posted1.approval_status, "pending_approval");
    assert.equal((await f.command("purchase_lifecycle_command", "bill.post", {
      bill_id: bill1.id, source_hash: document1.source_hash, review_revision: review1.review_revision, review_hash: review1.review_hash
    })).expense_ledger_id, posted1.expense_ledger_id);
    assert.equal((await f.db.query("select source_table,approval_status,total_amount,invoice_number from expense_ledger where id=$1", [posted1.expense_ledger_id])).rows[0].source_table, "supplier_purchase_bills");

    const thirdReceipt = { idempotency_key: cid(505), purchase_order_id: order.id, receipt_date: "2026-10-30", reference: "GRN-003",
      lines: [{ purchase_order_line_id: orderLineId, received_quantity: 35, accepted_quantity: 35, rejected_quantity: 0, held_quantity: 0, note: null }] };
    await f.command("purchase_lifecycle_command", "receipt.record", thirdReceipt);

    const invoiceText2 = "Vendor: Fixture Billet Supply\nInvoice Number: INV-002\nInvoice Date: 2026-10-30\nLine: 6063 billet | 55 | kg | 10 | 550 | 99\nFreight: 55\nTotal: 704";
    const document2 = await f.command("purchase_lifecycle_command", "document.create", {
      source_hash: sourceHash(invoiceText2), source_name: "invoice-two.csv", proposal: { invoice_number: "INV-002" }, uncertain_fields: []
    });
    const reviewed2 = { ...reviewed1, invoice_number: "INV-002", invoice_date: "2026-10-30", tax_amount: 99, freight_amount: 55, total_amount: 704,
      lines: [{ purchase_order_line_id: orderLineId, quantity: 55, unit: "kg", rate: 10, base_amount: 550, tax_amount: 99 }] };
    const review2 = await f.command("purchase_lifecycle_command", "document.review", {
      source_id: document2.id, source_hash: document2.source_hash, expected_revision: 0, reviewed: reviewed2
    });
    const bill2 = await f.command("purchase_lifecycle_command", "bill.create", {
      source_id: document2.id, source_hash: document2.source_hash, review_revision: review2.review_revision, review_hash: review2.review_hash
    });
    assert.equal(bill2.match_status, "matched");
    const posted2 = await f.command("purchase_lifecycle_command", "bill.post", {
      bill_id: bill2.id, source_hash: document2.source_hash, review_revision: review2.review_revision, review_hash: review2.review_hash
    });
    assert.equal(posted2.kind, "bill_posted");

    const duplicateDocument = await f.command("purchase_lifecycle_command", "document.create", {
      source_hash: sourceHash("re-upload with a changed scan"), source_name: "duplicate-invoice.txt", proposal: { invoice_number: "INV/001" }, uncertain_fields: []
    });
    const duplicateReview = await f.command("purchase_lifecycle_command", "document.review", {
      source_id: duplicateDocument.id, source_hash: duplicateDocument.source_hash, expected_revision: 0,
      reviewed: { ...reviewed1, invoice_number: "INV/001" }
    });
    await assert.rejects(f.command("purchase_lifecycle_command", "bill.create", {
      source_id: duplicateDocument.id, source_hash: duplicateDocument.source_hash, review_revision: duplicateReview.review_revision, review_hash: duplicateReview.review_hash
    }), /normalized supplier invoice number and date are already recorded/);
    assert.equal((await f.db.query("select count(*)::int as count from expense_ledger where company_id=$1 and vendor_id=$2 and invoice_date='2026-10-29'", [ids.company, vendorId])).rows[0].count, 1);

    await assert.rejects(f.db.query("select public.save_manual_expense_atomic(null,$1,$2)", [{
      expense_category: "raw_material", vendor_id: vendorId, description: "Duplicate invoice through manual entry", invoice_number: "INV 001",
      invoice_date: "2026-10-29", base_amount: 1, total_amount: 1
    }, cid(506)]), /already recorded as expense/);

    await f.db.query("update vendors set vendor_name='Later master name', is_active=false where id=$1", [vendorId]);
    const dashboard = await f.command("purchase_lifecycle_command", "dashboard.load", {});
    assert.equal(dashboard.orders.find((row) => row.id === order.id).vendor_name, "Fixture Billet Supply");
    assert.equal(dashboard.bills.find((row) => row.id === bill1.id).vendor_name, "Fixture Billet Supply");

    const otherCompanyOwner = cid(700);
    await f.db.query("insert into auth.users(id,email) values($1,'foreign-purchase@commercial.invalid')", [otherCompanyOwner]);
    await f.db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'foreign owner','foreign-purchase@commercial.invalid','owner',true)", [otherCompanyOwner, ids.foreign]);
    await f.actor(otherCompanyOwner);
    assert.deepEqual((await f.command("purchase_lifecycle_command", "dashboard.load", {})).orders, []);
    await assert.rejects(f.command("purchase_lifecycle_command", "document.load", { source_id: document1.id, source_hash: document1.source_hash }), /unavailable/);

    await f.actor(ids.sales);
    await assert.rejects(f.command("purchase_lifecycle_command", "bill.match", { bill_id: bill1.id }), /not permitted/);

    await f.actor();
    const protectedTables = ["purchase_orders", "purchase_order_lines", "purchase_receipts", "purchase_receipt_lines", "supplier_purchase_documents", "supplier_purchase_bills", "supplier_purchase_bill_lines", "purchase_lifecycle_events"];
    const tableAcl = (await f.db.query("select relname,relrowsecurity,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') direct_access from pg_class where relnamespace='public'::regnamespace and relname=any($1)", [protectedTables])).rows;
    assert.equal(tableAcl.length, protectedTables.length);
    for (const table of tableAcl) { assert.equal(table.relrowsecurity, true, table.relname); assert.equal(table.direct_access, false, table.relname); }
    const rpcAcl = (await f.db.query("select has_function_privilege('anon','public.purchase_lifecycle_command(text,jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.purchase_lifecycle_command(text,jsonb)','EXECUTE') authenticated")).rows[0];
    assert.deepEqual(rpcAcl, { anon: false, authenticated: true });
    const helperAcl = (await f.db.query("select proname,has_function_privilege('authenticated',p.oid,'EXECUTE') executable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and proname=any($1)", [["purchase_lifecycle_event", "guard_supplier_invoice_identity", "purchase_bill_match", "purchase_order_view"]])).rows;
    assert.equal(helperAcl.length, 4);
    for (const helper of helperAcl) assert.equal(helper.executable, false, helper.proname);
  } finally {
    await f.close();
  }
});

test("purchase database pages beyond ten records and selected rows reopen the exact PO or bill source", async () => {
  const f = await createCommercialFixture();
  const vendorId = cid(8000);
  const orders = [];
  const bills = [];
  try {
    await f.actor();
    await f.db.query("insert into vendors(id,company_id,vendor_name,vendor_type) values($1,$2,'Pagination Billet Supply','aluminum_billets')", [vendorId, ids.company]);

    for (let index = 1; index <= 12; index += 1) {
      const order = await f.command("purchase_lifecycle_command", "order.create", {
        idempotency_key: cid(8100 + index), vendor_id: vendorId, order_date: "2026-10-29",
        expected_freight_amount: 0, expected_discount_amount: 0,
        lines: [{ description: `6063 billet ${index}`, specification: "6063 T6 billet", unit: "kg", quantity: 100, rate: 10, gst_percent: 18 }]
      });
      const lineId = (await f.db.query("select id from purchase_order_lines where purchase_order_id=$1", [order.id])).rows[0].id;
      orders.push({ ...order, lineId });
    }
    await f.command("purchase_lifecycle_command", "order.issue", { purchase_order_id: orders[0].id });
    const firstOrders = await f.command("purchase_lifecycle_command", "orders.list", { page: 1, search: "", status: "all", sort: "number", direction: "asc" });
    const secondOrders = await f.command("purchase_lifecycle_command", "orders.list", { page: 2, search: "", status: "all", sort: "number", direction: "asc" });
    assert.equal(firstOrders.total, 12);
    assert.equal(firstOrders.items.length, 10);
    assert.equal(secondOrders.items.length, 2);
    assert.deepEqual(secondOrders.items.map((item) => item.id), orders.slice(10).map((item) => item.id));
    const selectedOrder = await f.command("purchase_lifecycle_command", "order.load", { purchase_order_id: secondOrders.items[1].id });
    assert.equal(selectedOrder.order.id, secondOrders.items[1].id);
    assert.equal(selectedOrder.order.lines.length, 1);

    for (let index = 1; index <= 11; index += 1) {
      const invoiceNumber = `PAGE-${String(index).padStart(3, "0")}`;
      const text = `Invoice Number: ${invoiceNumber}`;
      const document = await f.command("purchase_lifecycle_command", "document.create", {
        source_hash: sourceHash(text), source_name: `${invoiceNumber}.txt`, proposal: { invoice_number: invoiceNumber }, uncertain_fields: []
      });
      const reviewed = await f.command("purchase_lifecycle_command", "document.review", {
        source_id: document.id, source_hash: document.source_hash, expected_revision: 0,
        reviewed: {
          vendor_id: vendorId, purchase_order_id: orders[0].id, invoice_number: invoiceNumber, invoice_date: "2026-10-29", due_date: null,
          tax_amount: 1.8, freight_amount: 0, discount_amount: 0, total_amount: 11.8,
          lines: [{ purchase_order_line_id: orders[0].lineId, quantity: 1, unit: "kg", rate: 10, base_amount: 10, tax_amount: 1.8 }]
        }
      });
      bills.push(await f.command("purchase_lifecycle_command", "bill.create", {
        source_id: document.id, source_hash: document.source_hash, review_revision: reviewed.review_revision, review_hash: reviewed.review_hash
      }));
    }
    const firstBills = await f.command("purchase_lifecycle_command", "bills.list", { page: 1, search: "", status: "all", sort: "invoice", direction: "asc" });
    const secondBills = await f.command("purchase_lifecycle_command", "bills.list", { page: 2, search: "", status: "all", sort: "invoice", direction: "asc" });
    assert.equal(firstBills.total, 11);
    assert.equal(firstBills.items.length, 10);
    assert.equal(secondBills.items.length, 1);
    assert.equal(secondBills.items[0].invoice_number, "PAGE-011");
    const selectedBill = await f.command("purchase_lifecycle_command", "bill.load", { bill_id: secondBills.items[0].id });
    assert.equal(selectedBill.bill.id, bills[10].id);
    assert.equal(selectedBill.bill.source.reviewed_payload.invoice_number, "PAGE-011");
    assert.equal(selectedBill.bill.order.id, orders[0].id);
  } finally {
    await f.close();
  }
});
