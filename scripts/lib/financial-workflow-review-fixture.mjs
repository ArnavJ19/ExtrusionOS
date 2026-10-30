import { createCommercialFixture, cid } from "./commercial-upgrade-fixture.mjs";

export async function createFinancialWorkflowFixture() {
  const fixture = await createCommercialFixture();
  const { db, ids } = fixture;
  const invoiceA = cid(1101);
  const invoiceB = cid(1102);
  const foreignOwner = cid(1103);
  const foreignCustomer = cid(1104);
  const foreignInvoice = cid(1105);

  await db.query("update companies set gst_state_code='24' where id in ($1,$2)", [ids.company, ids.foreign]);
  await db.query("insert into auth.users(id,email) values($1,$2)", [foreignOwner, "foreign-owner@financial.invalid"]);
  await db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'Foreign owner',$3,'owner',true)", [foreignOwner, ids.foreign, "foreign-owner@financial.invalid"]);
  await db.query("insert into customers(id,company_id,customer_name,customer_type,payment_terms) values($1,$2,'Foreign customer','fabricator','30 days')", [foreignCustomer, ids.foreign]);
  await db.query(`insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,subtotal,tax_total,grand_total,amount_paid,status,place_of_supply_state_code)
    values($1,$2,$3,'INV-1101',current_date-20,current_date-5,100,18,118,0,'generated','24'),
          ($4,$2,$3,'INV-1102',current_date-10,current_date+20,200,36,236,0,'generated','24'),
          ($5,$6,$7,'FOREIGN-1105',current_date-2,current_date+28,50,9,59,0,'generated','24')`,
  [invoiceA, ids.company, ids.customer, invoiceB, foreignInvoice, ids.foreign, foreignCustomer]);
  await db.query("update invoices set issued_at=now(),issued_snapshot='{}'::jsonb,source_fingerprint=repeat('0',64) where id in ($1,$2,$3)", [invoiceA, invoiceB, foreignInvoice]);
  const invoiceNumbers = Object.fromEntries((await db.query("select id,invoice_number from invoices where id in ($1,$2) order by id", [invoiceA, invoiceB])).rows.map((row) => [row.id, row.invoice_number]));

  return {
    ...fixture,
    ids: { ...ids, invoiceA, invoiceB, foreignOwner, foreignCustomer, foreignInvoice },
    invoiceNumbers: { a: invoiceNumbers[invoiceA], b: invoiceNumbers[invoiceB] },
    actor: async (id = ids.accounts) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  };
}
