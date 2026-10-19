import {existsSync,readFileSync} from "node:fs";
import {createOrderCancellationStockFixture,cancellationIds as f} from "./order-cancellation-stock-fixture.mjs";
import {createHistoricalTables,sqlDefinition} from "./historical-schema-fixture.mjs";
import {fixtureId as id} from "./direct-order-fixture.mjs";

export const retainedInvoiceCandidate="20261019000000_retained_dispatch_invoices.sql";
const candidateUrl=new URL(`../../supabase/migrations/${retainedInvoiceCandidate}`,import.meta.url);
export const invoiceFixtureIds={...f,packing:id(400)};
const read=file=>readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8");

export async function installRetainedInvoiceObjects(db){
  const source=readFileSync(candidateUrl,"utf8");
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(retainedInvoiceCandidate,name));
  const statements=source.match(/(?:drop trigger|create trigger|revoke|grant)[^;]+;/gi)??[];
  for(const statement of statements)await db.exec(statement);
  return {functions:names.length,triggers:statements.filter(value=>/^create trigger/i.test(value)).length};
}

export async function createRetainedInvoiceFixture({candidate=existsSync(candidateUrl)}={}){
  const db=await createOrderCancellationStockFixture();
  try{
    await createHistoricalTables(db,["company_settings","payments"],retainedInvoiceCandidate);
    await db.exec(`alter table order_stage_history alter column changed_at set default now();
      alter table invoices alter column amount_paid set default 0,alter column credited_amount set default 0;
      update companies set gst_state_code='24',gst_number='24ABCDE1234F1Z5',name='Synthetic supplier' where id='${f.company}';
      insert into company_settings(company_id,invoice_prefix,default_gst_percent) values('${f.company}','INV',18);
      update orders set order_date=current_date-1 where id='${f.order}';
      update dispatches set dispatch_number='D-RETAINED-001',dispatch_date=current_date-1,
        created_at=now()-interval '2 hours',actual_dispatched_at=now()-interval '1 hour',delivered_at=now()-interval '30 minutes'
        where id='${f.dispatch}';
      update profile_stock_consumptions set created_at=now()-interval '1 hour' where dispatch_id='${f.dispatch}';
      update quote_items set gst_percent=18,hsn_code='760421' where id='${f.quoteLine}';
      insert into packing_list_items(id,company_id,dispatch_id,source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,
        profile_id,order_item_id,quote_item_id,finishing_type,net_weight_kg,gross_weight_kg,tare_weight_kg,net_length_m,number_of_pieces,
        net_rate,gst_percent,bundle_number,operator_verified_at,operator_verified_by)
        values('${id(400)}','${f.company}','${f.dispatch}','reservation','${f.order}','${f.reservation}','${f.reservation}','${f.batch}',
          '${f.profile}','${f.orderLine}','${f.quoteLine}','mill_finish',10,10,0,5,1,100,18,'B-RETAINED-001',now()-interval '90 minutes','${f.actor}');`);
    for(const [file,names] of [
      ["20260929000000_business_logic_fixes.sql",["private.save_invoice_atomic","private.recalculate_invoice_totals","private.canonicalize_invoice_supply"]],
      ["20260718010000_financial_closure.sql",["private.replace_invoice_items_atomic"]],
      ["20260715000000_atomic_business_workflows.sql",["public.save_invoice_atomic","public.replace_invoice_items_atomic"]],
      ["20260723040000_returned_dispatch_invoice_guard.sql",["public.validate_invoice_dispatch_billable"]],
      ["20260718052000_invoice_packing_line_parity.sql",["private.canonicalize_invoice_packing_line","private.assert_invoice_packing_coverage","private.lock_invoiced_packing_list","private.enforce_one_active_dispatch_invoice"]],
      ["20260930000000_astra_audit_fixes.sql",["private.snapshot_invoice_parties"]]
    ])for(const name of names)await db.exec(sqlDefinition(file,name));
    const parity=read("20260718052000_invoice_packing_line_parity.sql");
    for(const statement of parity.match(/(?:create (?:constraint )?trigger|revoke)[^;]+;/gi)??[])await db.exec(statement);
    await db.exec(`create trigger validate_invoice_dispatch_billable before insert or update of company_id,order_id,dispatch_id,status on invoices
        for each row execute function public.validate_invoice_dispatch_billable();
      create trigger zzz_canonicalize_invoice_supply before insert or update on invoices for each row execute function private.canonicalize_invoice_supply();
      create trigger zzzz_snapshot_invoice_parties before insert or update on invoices for each row execute function private.snapshot_invoice_parties();
      revoke all on function private.save_invoice_atomic(uuid,jsonb,jsonb,boolean),private.replace_invoice_items_atomic(uuid,jsonb),
        private.recalculate_invoice_totals(uuid,uuid) from public,anon,authenticated;
      revoke all on function public.save_invoice_atomic(uuid,jsonb,jsonb,boolean),public.replace_invoice_items_atomic(uuid,jsonb) from public,anon;
      grant execute on function public.save_invoice_atomic(uuid,jsonb,jsonb,boolean),public.replace_invoice_items_atomic(uuid,jsonb) to authenticated;
      grant all on all tables in schema public to authenticated;
      alter table invoices enable row level security;
      alter table invoice_items enable row level security;
      alter table payments enable row level security;`);
    const finance=read("20260718010000_financial_closure.sql");
    for(const statement of finance.match(/create policy (?:invoices_finance_read|invoice_items_finance_read|payments_finance_read)[\s\S]*?;/g)??[])await db.exec(statement);
    if(candidate)await installRetainedInvoiceObjects(db);
    return db;
  }catch(error){await db.close();throw error;}
}

export async function installRetainedInvoiceSettlementObjects(db){
  await createHistoricalTables(db,["credit_notes"],retainedInvoiceCandidate);
  // Restore historical generated expressions, which the shared column-only fixture omits.
  await db.exec(`alter table invoices drop column balance_due,drop column customer_credit_due;
    alter table invoices add column balance_due numeric(14,2) generated always as (greatest(grand_total-amount_paid-credited_amount,0)) stored,
      add column customer_credit_due numeric(14,2) generated always as (greatest(amount_paid+credited_amount-grand_total,0)) stored;
    alter table credit_notes alter column status set default 'issued';
    create unique index fixture_payment_retry on payments(company_id,idempotency_key);
    create unique index fixture_credit_retry on credit_notes(company_id,idempotency_key);
    create unique index fixture_active_credit on credit_notes(company_id,dispatch_id) where status='issued';`);
  for(const [file,names] of [
    ["20260929000000_business_logic_fixes.sql",["private.recalculate_invoice_collection_state"]],
    ["20260718010000_financial_closure.sql",["private.record_payment_atomic","public.record_payment_atomic","private.reverse_payment_atomic","public.reverse_payment_atomic"]],
    ["20260723070000_dispatch_return_credit_notes.sql",["private.reverse_credit_note_atomic"]],
    ["20261015030000_credit_note_retry_binding.sql",["private.issue_dispatch_return_credit_note_atomic"]],
    ["20261008020000_factory_workflow_integrity.sql",["public.issue_dispatch_return_credit_note_atomic","public.reverse_credit_note_atomic"]],
    ["20261015020000_credit_settlement_exclusivity.sql",["private.enforce_invoice_credit_settlement_exclusivity"]]
  ])for(const name of names)await db.exec(sqlDefinition(file,name));
  for(const statement of read("20261015020000_credit_settlement_exclusivity.sql").match(/(?:create trigger|revoke)[^;]+;/gi)??[])await db.exec(statement);
  await db.exec(`revoke all on function private.record_payment_atomic(uuid,jsonb),private.reverse_payment_atomic(uuid,text,uuid),
      private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid),private.reverse_credit_note_atomic(uuid,text),private.recalculate_invoice_collection_state(uuid,uuid) from public,anon,authenticated;
    revoke all on function public.record_payment_atomic(uuid,jsonb),public.reverse_payment_atomic(uuid,text,uuid),public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid),public.reverse_credit_note_atomic(uuid,text) from public,anon;
    grant execute on function public.record_payment_atomic(uuid,jsonb),public.reverse_payment_atomic(uuid,text,uuid),public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid),public.reverse_credit_note_atomic(uuid,text) to authenticated;`);
}
