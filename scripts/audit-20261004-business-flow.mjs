// Diagnostic assertions describe defects, not desired regression-test behavior.
// Runs extracted repository SQL against synthetic, in-memory tables only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const definition = (file, name) => {
  const text = read(file);
  const start = text.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const body = text.indexOf('$$', start);
  const end = text.indexOf('$$;', body + 2);
  assert.ok(end > body);
  return text.slice(start, end + 3);
};
const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const db = new PGlite();
try {
  await db.exec(`create schema private; create schema auth;
    create role authenticated; create role anon;
    create function auth.uid() returns uuid language sql as $$select '${id}'::uuid$$;
    create table orders(id uuid,company_id uuid,current_stage text,production_quantity_kg numeric,updated_at timestamptz);
    create table order_items(company_id uuid,order_id uuid,quantity_kg numeric);
    create table production_jobs(id uuid,company_id uuid,order_id uuid,profile_id uuid,status text,planned_quantity_kg numeric,actual_quantity_kg numeric,finishing_type text);
    create table order_dealer_stock_fulfillments(company_id uuid,order_id uuid,fulfilled_weight_kg numeric,credited_at timestamptz);
    create table dispatches(company_id uuid,order_id uuid,delivery_status text,total_weight_kg numeric);
    create table order_stage_history(company_id uuid,order_id uuid,stage text,changed_by uuid,remarks text);
    insert into orders values('${id}','${id}','extrusion_in_progress',1000,null);
    insert into order_items values('${id}','${id}',1000);
    insert into dispatches values('${id}','${id}','delivered',200);`);
  await db.exec(definition('20260718021000_dispatch_readiness_and_delivery.sql', 'private.sync_order_delivery_stage'));
  await db.exec(`select private.sync_order_delivery_stage('${id}','${id}','Audit partial delivery');`);
  const stage = (await db.query('select current_stage from orders')).rows[0].current_stage;
  assert.equal(stage, 'dispatched');
  const productionSource = readFileSync(new URL('../lib/actions/production.ts', import.meta.url), 'utf8');
  const stageFunction = productionSource.match(/function isOpenOrderStage\(stage: unknown\) \{([\s\S]*?)\n\}/);
  assert.ok(stageFunction);
  const isOpen = new Function('stage', stageFunction[1]);
  assert.equal(isOpen(stage), false);
  assert.equal(isOpen('extrusion_in_progress'), true);
  console.log('B01 REPRODUCED: delivery of 200/1000 kg sets dispatched; real production-planning stage predicate rejects remaining work.');

  const qualityFile = '20260718020500_finishing_route_and_quality_yield.sql';
  await db.exec(`create table finishing_jobs(id uuid,company_id uuid,production_job_id uuid,status text,output_weight_kg numeric);
    create table quality_inspections(id uuid,company_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,status text,quantity_checked_kg numeric,inspector_name text,surface_finish_ok boolean);
    insert into production_jobs values('${id}','${id}','${id}','${id}','completed',100,100,'mill_finish');`);
  await db.exec(definition(qualityFile, 'public.validate_quality_production_link'));
  await db.exec(definition(qualityFile, 'public.guard_terminal_quality_inspection'));
  await db.exec(`create trigger validate_quality_production_link before insert or update on quality_inspections for each row execute function public.validate_quality_production_link();
    create trigger guard_terminal_quality_inspection before update or delete on quality_inspections for each row execute function public.guard_terminal_quality_inspection();
    insert into quality_inspections values('${id}','${id}','${id}',null,'${id}','rework',100,'Inspector',false);`);
  await assert.rejects(db.exec(`insert into quality_inspections values('${second}','${id}','${id}',null,'${id}','approved',100,'Inspector',true);`), /QC disposition exceeds available source output/);
  await assert.rejects(db.exec(`update quality_inspections set status='approved',surface_finish_ok=true where id='${id}';`), /Final quality dispositions are immutable/);
  console.log('B02 REPRODUCED: 100 kg rework prevents a new 100 kg approval, and changing the original disposition is also rejected.');

  // Stub private bodies isolate EXECUTE privileges; business validation is not exercised.
  await db.exec(`create function private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) returns uuid language sql security definer as $$select $1$$;
    create function private.reverse_credit_note_atomic(uuid,text) returns uuid language sql security definer as $$select $1$$;
    grant usage on schema private to authenticated;`);
  const creditFile = '20260723070000_dispatch_return_credit_notes.sql';
  await db.exec(definition(creditFile, 'public.issue_dispatch_return_credit_note_atomic'));
  await db.exec(definition(creditFile, 'public.reverse_credit_note_atomic'));
  for (const match of read(creditFile).matchAll(/^(?:revoke|grant) .*function (?:public|private)\.(?:issue_dispatch_return_credit_note_atomic|reverse_credit_note_atomic)[^;]+;/gm)) await db.exec(match[0]);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec(`select public.issue_dispatch_return_credit_note_atomic('${id}','Return','${second}');`), /permission denied for function issue_dispatch_return_credit_note_atomic/);
  await assert.rejects(db.exec(`select public.reverse_credit_note_atomic('${id}','Correction');`), /permission denied for function reverse_credit_note_atomic/);
  console.log('B03 REPRODUCED: authenticated role cannot execute either credit-note wrapper because private EXECUTE is revoked.');
  const actionSource = readFileSync(new URL('../lib/systems-configurator/actions.ts', import.meta.url), 'utf8');
  const start = actionSource.indexOf('export async function generateSystemQuote(');
  const end = actionSource.indexOf('\nexport async function ', start + 1);
  assert.ok(start >= 0 && end > start);
  const javascript = ts.transpileModule(actionSource.slice(start, end).replace('export async function', 'async function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const items = [];
  const cuts = [{ profile_id: id, total_length_m: 40, total_weight_kg: 40 }, { profile_id: second, total_length_m: 60, total_weight_kg: 60 }];
  const adapter = { from(table) {
    let operation = 'select';
    let payload;
    const query = new Proxy({}, { get(_target, method) {
      if (method === 'then') return (resolve, reject) => {
        let result = { data: [], error: null };
        if (operation === 'insert') {
          if (table === 'quote_items') items.push(payload);
          result = { data: { id }, error: null };
        } else if (operation === 'update') result = { data: null, error: null };
        else if (table === 'system_configurations') result = { data: { id, customer_id: id, quantity: 1, subtotal: 120, internal_cost: 100, grand_total: 120 }, error: null };
        else if (table === 'system_profile_cuts') result = { data: cuts, error: null };
        else if (table === 'company_settings') result = { data: {}, error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return (...args) => { if (method === 'insert' || method === 'update') { operation = method; payload = args[0]; } return query; };
    } });
    return query;
  } };
  const generateQuote = new Function('getSystemsConfiguratorContext', 'createClient', 'assertSystemQuoteReady', 'nextQuoteNumber', 'buildSystemQuoteDescription', 'revalidatePath', 'redirect', `${javascript}; return generateSystemQuote;`)(
    async () => ({ companyId: id, userId: id }), async () => adapter, () => {}, () => 'Q-AUDIT', () => 'Two-profile assembly', () => {}, () => {}
  );
  await generateQuote(id);
  assert.equal(items.length, 1);
  assert.equal(items[0].profile_id, id);
  assert.equal(items[0].total_weight_kg, 100);
  assert.equal(items.some(item => item.profile_id === second), false);
  console.log('B04 REPRODUCED (mock database boundary): two profiles totaling 100 kg become one 100 kg quote line for the first profile; second profile has no commercial line. Handoff rejection is separately source-traced.');
  console.log('4 isolated business-flow defect scenarios reproduced; no hosted data accessed or modified.');
} finally {
  await db.close();
}
