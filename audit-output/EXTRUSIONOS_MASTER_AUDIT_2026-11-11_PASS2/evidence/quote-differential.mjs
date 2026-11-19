// PASS2 audit: differential test of the TypeScript quote engine (lib/calculations/quote.ts, what the user sees while typing)
// against the SQL trigger public.recalculate_quote_item_financials (what is persisted). Native PostgreSQL 18, synthetic rows.
// Run from the repository root: node --no-warnings --experimental-strip-types <this file>
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admin, cloneDb, dropDb, log, nid, U } from './native-lib.mjs';
const { calculateQuoteItem, calculateQuoteSummary } = await import(pathToFileURL(join(process.cwd(), 'lib/calculations/quote.ts')).href);

// Deterministic PRNG so the run is reproducible.
let s = 20261111; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dec = (lo, hi, dp) => Number((lo + rnd() * (hi - lo)).toFixed(dp));
const N = 600, cases = [];
for (let i = 0; i < N; i++) {
  const edge = i % 6 === 0;
  cases.push({
    quantity_pieces: edge ? pick([1, 7, 333, 9999]) : Math.floor(dec(1, 2500, 0)),
    length_per_piece_m: edge ? pick([0.305, 3.66, 4.572, 6.096, 5.485]) : dec(0.3, 7, 3),
    section_weight_kg_per_m: edge ? pick([0.115, 0.335, 1.005, 2.675, 0.045]) : dec(0.05, 6, 3),
    scrap_allowance_percent: pick([0, 0, 1.5, 2.5, 3, 5]),
    expected_recovery_percent: pick([100, 78, 82.5, 85, 72.35, 90]),
    minimum_billing_weight_kg: pick([0, 0, 0, 250, 1000]),
    billet_rate_per_kg: edge ? pick([245.005, 251.115, 199.995]) : dec(180, 320, 2),
    conversion_charge_per_kg: dec(20, 60, 2),
    finishing_charge_type: pick(['per_kg', 'per_meter', 'fixed']),
    finishing_charge: dec(0, 90, 2),
    die_charge: pick([0, 0, 18000, 42500.5]),
    die_amortization_type: pick(['full_die_charge', 'per_kg', 'waived', 'customer_paid']),
    die_amortization_quantity_kg: pick([0, 5000, 12500]),
    packing_charge: pick([0, 350, 1250.75]),
    transport_charge: pick([0, 0, 4200, 999.99]),
    other_charges: pick([0, 0, 125.5]),
    margin_percent: pick([0, 8, 12.5, 15, 22.75, 35]),
    sales_price_override: i % 9 === 0 ? dec(1000, 900000, 2) : null,
    minimum_margin_percent: pick([0, 10, 12]),
    gst_percent: 18,
  });
}
const db = cloneDb('w_quote');
try {
  const q = nid(8800);
  admin(db, `alter table public.quote_items disable trigger user; alter table public.quote_items enable trigger recalculate_quote_item_financials;
    set session_replication_role = replica;
    insert into public.quotes(id,company_id,quote_number,customer_id,quote_date,status,gst_percent) values('${q}','${U.company}','AUD-Q-1','${U.customer}',current_date,'draft',18);
    set session_replication_role = origin;`);
  const cols = ['quantity_pieces', 'length_per_piece_m', 'section_weight_kg_per_m', 'scrap_allowance_percent', 'expected_recovery_percent', 'minimum_billing_weight_kg', 'billet_rate_per_kg', 'conversion_charge_per_kg',
    'finishing_charge_type', 'finishing_charge', 'die_charge', 'die_amortization_type', 'die_amortization_quantity_kg', 'packing_charge', 'transport_charge', 'other_charges', 'margin_percent', 'sales_price_override', 'minimum_margin_percent', 'gst_percent'];
  const lit = (v) => v === null ? 'null' : typeof v === 'string' ? `'${v}'` : String(v);
  const values = cases.map((c, i) => `('${nid(100000 + i)}','${U.company}','${q}','${U.profile}',${cols.map((k) => lit(c[k])).join(',')})`).join(',\n');
  admin(db, `insert into public.quote_items(id,company_id,quote_id,profile_id,${cols.join(',')}) values ${values};`);
  const rows = JSON.parse(admin(db, `select json_agg(row_to_json(t) order by t.id) from (select * from public.quote_items where quote_id='${q}') t`));
  const compare = { total_meters: 'total_meters', total_weight_kg: 'total_weight_kg', effective_weight_kg: 'effective_weight_kg', billing_weight_kg: 'billing_weight_kg', billet_input_kg: 'billet_input_kg',
    raw_material_cost: 'raw_material_cost', conversion_cost: 'conversion_cost', finishing_cost: 'finishing_cost', die_amortization_amount: 'die_amortization_amount', line_subtotal: 'line_subtotal',
    margin_amount: 'margin_amount', line_total_before_gst: 'line_total_before_gst', estimated_profit_amount: 'estimated_profit_amount', estimated_profit_percent: 'estimated_profit_percent',
    approval_required: 'approval_required', price_per_kg: 'price_per_kg', price_per_meter: 'price_per_meter', invoice_rate_per_kg: 'net_rate', charges_billed_separately: 'charges_billed_separately' };
  const mismatches = {}, examples = []; let rowsWithMismatch = 0, maxMoneyDelta = 0;
  const tsLines = [];
  rows.forEach((row) => {
    // Feed the TypeScript engine the inputs exactly as stored (after column scale), so only the arithmetic differs.
    const input = Object.fromEntries(cols.map((k) => [k, typeof row[k] === 'string' && k !== 'finishing_charge_type' && k !== 'die_amortization_type' ? Number(row[k]) : row[k]]));
    const ts = calculateQuoteItem(input); tsLines.push(ts);
    let bad = false;
    for (const [tsKey, sqlKey] of Object.entries(compare)) {
      const a = ts[tsKey], b = typeof row[sqlKey] === 'boolean' ? row[sqlKey] : Number(row[sqlKey]);
      const equal = typeof a === 'boolean' ? a === b : Math.abs(a - b) < 0.0005;
      if (!equal) {
        bad = true; mismatches[tsKey] = (mismatches[tsKey] ?? 0) + 1;
        if (typeof a === 'number' && /cost|total|amount|subtotal|price|rate/.test(tsKey)) maxMoneyDelta = Math.max(maxMoneyDelta, Math.abs(a - b));
        if (examples.length < 6) examples.push({ field: tsKey, ts: a, sql: b, input });
      }
    }
    if (bad) rowsWithMismatch++;
  });
  log({ id: 'Q1-ts-vs-sql-line-differential', cases: rows.length, rowsWithMismatch, mismatchesByField: mismatches, maxMoneyDeltaInr: Number(maxMoneyDelta.toFixed(2)), examples });

  // Invoice basis invariant: billing the quoted physical kg at the stored net_rate (plus one-off die/freight) should give the quoted line amount.
  let worst = { delta: 0 }; let over1 = 0;
  for (const row of rows) {
    const kg = Number(row.total_weight_kg), rate = Number(row.net_rate), total = Number(row.line_total_before_gst);
    const oneOff = row.charges_billed_separately ? Number(row.die_service_charge) + Number(row.freight_charge) : 0;
    const invoiced = Math.round((kg * rate + oneOff) * 100) / 100, delta = Number((invoiced - total).toFixed(2));
    if (Math.abs(delta) > 1) over1++;
    if (Math.abs(delta) > Math.abs(worst.delta)) worst = { delta, kg, rate, quoted: total, invoiced, oneOff };
  }
  log({ id: 'Q2-quoted-amount-vs-invoice-at-net_rate', expect: 'shipping the quoted kg invoices the quoted amount', linesOffByMoreThanInr1: over1, of: rows.length, worst });

  // Header totals: SQL header versus the TypeScript summary of the same lines.
  admin(db, `alter table public.quote_items enable trigger refresh_quote_header_after_item_change; update public.quote_items set updated_at=now() where id='${nid(100000)}';`);
  const header = JSON.parse(admin(db, `select row_to_json(t) from (select subtotal,gst_amount,grand_total,total_before_gst,estimated_profit_amount from public.quotes where id='${q}') t`));
  const sum = calculateQuoteSummary(tsLines.map((l, i) => ({ ...l, line_total_before_gst: Number(rows[i].line_total_before_gst), estimated_profit_amount: Number(rows[i].estimated_profit_amount) })), 18);
  log({ id: 'Q3-header-totals', sql: header, ts: { subtotal: sum.subtotal, gst_amount: sum.gst_amount, grand_total: sum.grand_total, estimated_profit_amount: sum.estimated_profit_amount } });

  // Boundary behaviour the trigger must refuse or neutralise.
  for (const [label, patch] of [['recovery-0', { expected_recovery_percent: 0 }], ['recovery-101', { expected_recovery_percent: 101 }], ['margin-100', { margin_percent: 100 }], ['margin-negative', { margin_percent: -5 }],
    ['negative-pieces', { quantity_pieces: -10 }], ['negative-rate', { billet_rate_per_kg: -100 }], ['gst-150', { gst_percent: 150 }], ['zero-weight', { section_weight_kg_per_m: 0 }], ['huge', { quantity_pieces: 99999999, length_per_piece_m: 9999 }]]) {
    const c = { ...cases[1], ...patch };
    try {
      const out = admin(db, `insert into public.quote_items(id,company_id,quote_id,profile_id,${cols.join(',')}) values ('${nid(200000 + label.length + (label.includes('negative-r') ? 50 : 0))}','${U.company}','${q}','${U.profile}',${cols.map((k) => lit(c[k])).join(',')}) returning total_weight_kg, line_subtotal, line_total_before_gst;`);
      log({ id: `Q4-${label}`, outcome: 'accepted', stored: out });
    } catch (e) { log({ id: `Q4-${label}`, outcome: 'refused', message: String(e.message).split('\n')[0].slice(0, 140) }); }
  }
} finally { dropDb(db); }
