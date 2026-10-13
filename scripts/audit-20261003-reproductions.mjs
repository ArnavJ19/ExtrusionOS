// Audit reproductions only. Uses isolated in-memory PostgreSQL and synthetic data.
// A reproduced defect is asserted as current behavior, not accepted behavior.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js';
import { can } from '../lib/auth/permissions.ts';
import { hasRouteAccess } from '../lib/auth/route-permissions.ts';
import { calculateSystemCosting } from '../lib/systems-configurator/costing-engine.ts';
import ts from 'typescript';

const root = new URL('../supabase/migrations/', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8').replaceAll('\r\n', '\n');
const company = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const dealerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dealerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = '33333333-3333-4333-8333-333333333333';
const db = new PGlite();
const definition = (file, name) => {
  const source = read(file);
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
};

try {
  await db.exec(`create role authenticated; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql as $$select '${id}'::uuid$$;
    create function public.get_current_user_company_id() returns uuid language sql as $$select '${company}'::uuid$$;
    create function public.get_current_user_role() returns text language sql as $$select current_setting('audit.role')$$;
    create function public.get_current_user_dealer_id() returns uuid language sql as $$select nullif(current_setting('audit.dealer',true),'')::uuid$$;
    create function public.current_user_has_permission(text) returns boolean language sql as $$select false$$;
    create function public.is_owner_or_admin() returns boolean language sql as $$select false$$;`);
  const tables = ['customers', 'quotes', 'quote_items', 'orders', 'order_items'];
  for (const table of tables) {
    await db.exec(`create table public.${table}(id uuid primary key, company_id uuid, dealer_id uuid, quote_id uuid, order_id uuid, notes text, internal_cost numeric);
      alter table public.${table} enable row level security;
      grant select,insert,update,delete on public.${table} to authenticated;
      insert into public.${table} values ('${id}','${company}','${dealerB}','${id}','${id}','original',1234),
      ('${foreign}','${foreign}',null,'${foreign}','${foreign}','other tenant',9999);`);
  }
  let policyStatements = 0;
  // Replay literal policy DDL in migration filename order. Other migration DDL,
  // application triggers, hosted grants, and dynamic DO blocks are not replayed.
  for (const file of readdirSync(root).filter((name) => name.endsWith('.sql')).sort()) {
    for (const match of read(file).matchAll(/^\s*(?:create|drop) policy\b[^;]+;/gim)) {
      const table = match[0].match(/\bon\s+public\.(\w+)/i)?.[1];
      if (tables.includes(table)) {
        await db.exec(match[0]);
        policyStatements++;
      }
    }
  }
  await db.exec(`set role authenticated; set audit.role='dealer_staff'; set audit.dealer='${dealerA}';`);
  for (const table of tables) {
    const rows = (await db.query(`select id,internal_cost from public.${table}`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(Number(rows[0].internal_cost), 1234);
  }
  console.log(`REPRODUCED A01: dealer A reads dealer B rows in all five core tables (${policyStatements} policy statements replayed); other company rows remain hidden.`);
  await db.exec("set audit.role='viewer'; set audit.dealer='';");
  for (const table of tables) {
    const rows = (await db.query(`update public.${table} set notes='changed by viewer' where id='${id}' returning id`)).rows;
    assert.equal(rows.length, 1);
  }
  assert.equal((await db.query(`delete from order_items where id='${id}' returning id`)).rows.length, 1);
  console.log('REPRODUCED A02: core RLS permits viewer updates and order-line deletion. This isolates policy authorization, not the complete trigger stack.');

  await db.exec(`reset role;
    create table system_configurations(id uuid,company_id uuid,order_id uuid);
    create table profile_stock_batches(id uuid primary key,company_id uuid,profile_id uuid,total_weight_kg numeric,quantity_pieces integer,status text);
    create table profile_stock_reservations(id uuid primary key,company_id uuid,order_id uuid,profile_stock_batch_id uuid,profile_id uuid,status text,reserved_weight_kg numeric,reserved_length_m numeric,released_at timestamptz);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid);
    create table packing_list_items(company_id uuid,dispatch_id uuid,reservation_id uuid,profile_stock_batch_id uuid,profile_id uuid,net_weight_kg numeric,source_kind text);
    create table profile_stock_consumptions(company_id uuid,reservation_id uuid,profile_stock_batch_id uuid,profile_id uuid,order_id uuid,dispatch_id uuid,consumed_weight_kg numeric,consumed_length_m numeric,notes text,created_by uuid,unique(company_id,dispatch_id,reservation_id));
    insert into profile_stock_batches values ('${id}','${company}','${id}',100,10,'available');
    insert into profile_stock_reservations values ('${id}','${company}','${id}','${id}','${id}','active',100,50,null);
    insert into dispatches values ('${id}','${company}','${id}');
    insert into packing_list_items values ('${company}','${id}','${id}','${id}','${id}',100,'reservation');`);
  await db.exec(definition('20260721091307_physical_dispatch_stock_provenance.sql', 'private.consume_dispatch_reservations'));
  await db.exec(definition('20260930000000_astra_audit_fixes.sql', 'private.guard_reserved_stock_capacity'));
  await db.exec('create trigger astra_reserved_stock before update on profile_stock_batches for each row execute function private.guard_reserved_stock_capacity();');
  await assert.rejects(db.query('select private.consume_dispatch_reservations($1)', [id]), /Release or consume active reservations/);
  assert.equal((await db.query('select count(*) as count from profile_stock_consumptions')).rows[0].count, 0);
  console.log('REPRODUCED A03: dispatching a fully reserved 100 kg batch fails against the actual consumption function and new capacity trigger; statement rolls back.');

  assert.equal(can('production', 'read', 'orders'), true);
  assert.equal(can('production', 'read', 'quotes'), false);
  const moduleConfig = readFileSync(new URL('../components/modules/operations/module-config.ts', import.meta.url), 'utf8');
  assert.match(moduleConfig, /id: "order_value", header: "Order Value"/);
  console.log('CONFIRMED A04: production role reads orders but not quotes; shared order columns contain unguarded order_value.');

  const result = calculateSystemCosting({ materialSummary: [], totalProfileWeightKg: 1, totalProfileLengthM: 1,
    totalGlassAreaSqft: 0, totalGlassAreaSqm: 0, quantity: 1, openingWidthMm: 1000, openingHeightMm: 1000,
    aluminiumRatePerKg: 100, fabrication: { rateType: 'fixed', rate: 0 }, installation: { enabled: false, rateType: 'fixed', rate: 0 },
    transport: { type: 'fixed', amount: 0 }, aluminiumWastagePercent: 0, glassWastagePercent: 0,
    marginPercent: 20, discountAmount: 30, gstPercent: 0 });
  assert.equal(result.internalCost, 100);
  assert.equal(result.subtotalBeforeGst, 90);
  assert.equal(result.profitPercent, 20);
  console.log('REPRODUCED A07: internal cost 100, markup 20, discount 30 -> selling subtotal 90, but profitPercent remains positive 20%.');
  assert.equal(hasRouteAccess('/systems-configurator/projects/fixture/quote', 'accounts'), false);
  assert.equal(can('accounts', 'read', 'systems_configurator'), false);
  console.log('CONFIRMED A08: accounts is denied configurator access despite explicit accounts costing-view allowance.');

  assert.equal(can('production_manager', 'update', 'inventory'), true);
  assert.equal(can('production_manager', 'read', 'systems_configurator'), true);
  assert.equal(can('production_manager', 'update', 'systems_configurator'), false);
  console.log('CONFIRMED A09: production manager sees the BOM reservation control but fails the action configurator-update gate.');

  // Run the real quote-creation orchestration with a synthetic database adapter.
  // Inject a line-insert failure after the header insert to inspect partial writes.
  const actionSource = readFileSync(new URL('../lib/systems-configurator/actions.ts', import.meta.url), 'utf8');
  const start = actionSource.indexOf('export async function generateSystemQuote(');
  const end = actionSource.indexOf('\nexport async function ', start + 1);
  const functionSource = actionSource.slice(start, end).replace('export async function', 'async function');
  const javascript = ts.transpileModule(functionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const inserted = [];
  const adapter = { from(table) {
    let operation = 'select';
    let payload;
    const query = new Proxy({}, { get(_target, method) {
      if (method === 'then') return (resolve, reject) => {
        let result;
        if (operation === 'insert' && table === 'quotes') { inserted.push({ table, payload }); result = { data: { id }, error: null }; }
        else if (operation === 'insert' && table === 'quote_items') result = { data: null, error: new Error('injected line insert failure') };
        else if (table === 'system_configurations') result = { data: { id, customer_id: id, quantity: 1, subtotal: 120, internal_cost: 100, grand_total: 120 }, error: null };
        else if (table === 'system_profile_cuts') result = { data: [{ profile_id: id, total_length_m: 1, total_weight_kg: 1 }], error: null };
        else if (table === 'company_settings') result = { data: {}, error: null };
        else result = { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return (...args) => { if (method === 'insert' || method === 'update') { operation = method; payload = args[0]; } return query; };
    } });
    return query;
  } };
  const generateQuote = new Function('getSystemsConfiguratorContext', 'createClient', 'assertSystemQuoteReady', 'nextQuoteNumber', 'buildSystemQuoteDescription', 'revalidatePath', 'redirect', `${javascript}; return generateSystemQuote;`)(
    async () => ({ companyId: company, userId: id }), async () => adapter, () => {}, () => 'Q-TEST', () => 'Synthetic configuration', () => {}, () => {}
  );
  await assert.rejects(generateQuote(id), /injected line insert failure/);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, 'quotes');
  console.log('REPRODUCED A06: actual generateSystemQuote orchestration leaves its quote header inserted after an injected line-insert failure (mock database boundary).');
} finally {
  await db.close();
}
console.log('Audit reproductions complete. No live database, application source, or migrations modified.');
