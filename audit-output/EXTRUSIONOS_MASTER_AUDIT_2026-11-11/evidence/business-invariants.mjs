import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run with the disposable source snapshot as cwd. All records below are synthetic.
const fromSnapshot = (file) => import(pathToFileURL(join(process.cwd(), file)).href);
const { autoMapBank, buildStatementRows } = await fromSnapshot('lib/financials/bank-statement.ts');
const { parseStockSnapshot } = await fromSnapshot('lib/dashboard/stock-snapshot.ts');
const { calculateQuoteItem, calculateQuoteSummary } = await fromSnapshot('lib/calculations/quote.ts');
const { createCashFixture, cIds: ids, nid, istDay } = await fromSnapshot('scripts/lib/autopilot-batch3-fixture.mjs');

let checkErrors = 0;
async function record(id, run) {
  try {
    console.log(JSON.stringify({ id, ...await run() }));
  } catch (error) {
    checkErrors++;
    console.log(JSON.stringify({ id, status: 'fixture error', error: error.message, code: error.code }));
  }
}

const headers = ['Date', 'Narration', 'Amount', 'Type'];
const bank = buildStatementRows([headers,
  ['10/11/2026', 'Fixture customer deposit', '2500.00', 'Deposit'],
  ['10/11/2026', 'Fixture outgoing', '600.00', 'Withdrawal'],
  ['10/11/2026', 'Fixture explicit incoming', '900.00', 'CR']
], 0, autoMapBank(headers), 'DD/MM/YYYY');
await record('MFA-006', () => {
  assert.equal(bank.errors.length, 0);
  assert.equal(bank.rows[1].debit, '600.00');
  assert.equal(bank.rows[2].credit, '900.00');
  return { expectedFirstCredit: '2500.00', actualFirst: bank.rows[0], reproduced: bank.rows[0].debit === '2500.00' };
});

await record('MFA-010', () => {
  const snapshot = parseStockSnapshot({ finishedKg: 'unknown', finishedPieces: null, billetKg: 0 });
  return { expected: 'unavailable for incomplete/malformed payload', actual: snapshot, reproduced: snapshot !== null && snapshot.finishedKg === 0 };
});

await record('quote-calculation-control', () => {
  const line = calculateQuoteItem({
    quantity_pieces: 10, length_per_piece_m: 2, section_weight_kg_per_m: 1.5, expected_recovery_percent: 75,
    billet_rate_per_kg: 200, conversion_charge_per_kg: 0, finishing_charge_type: 'none', finishing_charge: 0,
    die_charge: 0, packing_charge: 0, transport_charge: 0, other_charges: 0, margin_percent: 10, gst_percent: 18
  });
  // Oracle uses 30 kg output and 40 kg input. Selling at 10% margin is INR 8,000 / 0.90.
  const expected = { metres: 20, kg: 30, billetKg: 40, cost: 8000, beforeGst: 8888.89, includingGst: 10488.89 };
  const totals = calculateQuoteSummary([line], 18);
  assert.deepEqual([line.total_meters, line.total_weight_kg, line.billet_input_kg, line.raw_material_cost, line.line_total_before_gst],
    [expected.metres, expected.kg, expected.billetKg, expected.cost, expected.beforeGst]);
  assert.equal(totals.grand_total, expected.includingGst);
  return { expected, line: { metres: line.total_meters, kg: line.total_weight_kg, billetKg: line.billet_input_kg,
    cost: line.raw_material_cost, beforeGst: line.line_total_before_gst }, totals };
});

const fixture = await createCashFixture();
const { db } = fixture;
await fixture.start();
try {
  const batchA = nid(8101), batchB = nid(8102);
  const castSeed = async (id, seq) => fixture.seed(
    "insert into public.foundry_batches(id,company_id,batch_number,furnace_number,batch_sequence,production_date,status,alloy,temper,billet_length_mm,billet_diameter_mm,billet_count,billet_weight_density_kg,scrap_aluminium_kg,external_aluminium_kg) values($1,$2,$3,'FA', $4,'2026-11-10','cast','6063','T5',1000,178,1,65.670,0,65.670)",
    [id, ids.company, 'AUDIT-CAST-' + seq, seq]
  );
  const writeCast = async (id, measured, dross) => {
    await fixture.asUser('select public.record_foundry_cast_result($1,1,$2,$3)', [id, measured, dross], ids.production);
    return fixture.one('select charged_kg, measured_good_weight_kg, dross_kg, melt_loss_kg from public.foundry_cast_results where foundry_batch_id=$1', [id]);
  };
  await record('MFA-002', async () => {
    await castSeed(batchA, 1);
    await castSeed(batchB, 2);
    const tooMuchGood = await writeCast(batchA, 74.864, 5);
    const drossUnaccounted = await writeCast(batchB, 62, 4);
    return { reproduced: Number(tooMuchGood.melt_loss_kg) < 0 && Number(drossUnaccounted.melt_loss_kg) === 3.67,
      tooMuchGood, drossUnaccounted, expectedCombinedResidualKg: [-14.194, -0.330] };
  });

  await record('MFA-003', async () => {
    const composition = { Al: 60, Si: 60 }; // A physically impossible 120%, independent of an alloy-specific spec.
    const [row] = await fixture.asUser(
      "select public.record_foundry_chemistry_test($1,'cast',$2,'pass','FIXTURE-SAMPLE') as id",
      [batchA, composition], ids.quality
    );
    await fixture.asUser('select public.approve_foundry_chemistry_test($1)', [row.id], ids.owner);
    const stored = await fixture.one('select result,composition,approved_at is not null as approved from public.foundry_chemistry_tests where id=$1', [row.id]);
    return { expected: 'reject impossible composition', actual: stored, reproduced: stored.approved && stored.result === 'pass' };
  });

  await record('MFA-005', async () => {
    const batch = nid(8103), reservation = nid(8104), order = nid(8105);
    await fixture.seed("insert into public.orders(id,company_id,order_number,customer_id,order_date,current_stage,order_value) values($1,$2,'AUDIT-STOCK-ORDER',$3,current_date,'order_confirmed',0)", [order, ids.company, ids.customer]);
    await fixture.seed("insert into public.profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,status,origin_type,qc_status) values($1,$2,$3,'Mill finish',100,100,100,'reserved','opening_balance','released')", [batch, ids.company, ids.profile2]);
    await fixture.seed("insert into public.profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,created_by) values($1,$2,$3,$4,$5,20,20,20,'active',$6)", [reservation, ids.company, batch, ids.profile2, order, ids.owner]);
    const ledger = await fixture.one("select private.profile_stock_balance($1,$2) as balance", [ids.company, batch]);
    const [dashboard] = await fixture.asUser('select public.get_stock_snapshot() as stock', [], ids.owner);
    return { expectedReservedKg: 20, actualReservedKg: dashboard.stock.reservedKg,
      canonical: { onHand: ledger.balance.on_hand.weight_kg, reserved: ledger.balance.open_reserved.weight_kg, available: ledger.balance.available.weight_kg },
      reproduced: dashboard.stock.reservedKg === 100 && ledger.balance.open_reserved.weight_kg === 20 };
  });

  await record('MFA-007', async () => {
    const credit = { txn_date: istDay(-1), narration: 'CASH DEPOSIT', reference: null, credit: '2500' };
    const result = await fixture.call('ap_cash', 'bank_import', {
      source_name: 'synthetic-two-distinct-deposits.csv',
      file_fingerprint: 'a11d'.repeat(16),
      rows: [{ ...credit, line_no: 1 }, { ...credit, line_no: 2 }]
    }, ids.accounts);
    const count = await fixture.one("select count(*)::int as lines,sum(amount) as total from public.bank_statement_lines where narration='CASH DEPOSIT'");
    return { expected: { lines: 2, total: '5000.00', review: 'ambiguous identity without transaction reference' },
      reported: { inserted: result.new_lines, duplicates: result.duplicates }, actual: count,
      reproduced: result.new_lines === 1 && result.duplicates === 1 && count.lines === 1 };
  });

  await record('MFA-006-persistence', async () => {
    const row = { ...bank.rows[0], txn_date: istDay(-1) };
    const result = await fixture.call('ap_cash', 'bank_import', {
      source_name: 'synthetic-bank-direction.csv',
      file_fingerprint: 'bad6'.repeat(16),
      rows: [row]
    }, ids.accounts);
    const stored = await fixture.one('select direction,state,amount from public.bank_statement_lines where narration=$1', [row.narration]);
    return { expected: 'credit awaiting matching', actual: stored, newLines: result.new_lines, reproduced: stored.direction === 'debit' && stored.state === 'ignored' };
  });
} finally {
  await fixture.rollback();
  await db.close();
}
if (checkErrors) process.exitCode = 1;
