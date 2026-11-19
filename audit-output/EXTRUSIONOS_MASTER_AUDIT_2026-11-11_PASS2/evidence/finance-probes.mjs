// PASS2 audit: receipt writer behaviour with independent sessions on native PostgreSQL 18 (synthetic data).
import { admin, asUser, cloneDb, dropDb, log, nid, sleep, U } from './native-lib.mjs';

const db = cloneDb('w_fin');
const inv = (n) => nid(600 + n);
const seedInvoice = (n, total, status = 'generated') => `insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code,igst_amount)
  values('${inv(n)}','${U.company}','${U.customer}','AUD/26-27/${String(n).padStart(4, '0')}',current_date-10,current_date+20,'${status}',${total},0,${total},0,'07','07',0);`;
admin(db, `set session_replication_role = replica; ${[1, 2, 3, 4, 5, 6, 7].map((n) => seedInvoice(n, 1000)).join('\n')} ${seedInvoice(8, 1000, 'cancelled')} set session_replication_role = origin;`);
const pay = (invoice, amount, key, extra = {}) => `select public.record_payment_atomic('${invoice}', '${JSON.stringify({ payment_date: new Date().toISOString().slice(0, 10), amount, payment_method: 'cash', reference_number: null, notes: null, idempotency_key: key, ...extra })}'::jsonb);`;
const state = (n) => admin(db, `select json_build_object('status',i.status,'amount_paid',i.amount_paid,'grand_total',i.grand_total,'balance_due',i.balance_due,'credit_due',i.customer_credit_due,'payments',(select coalesce(json_agg(json_build_object('amount',p.amount,'status',p.payment_status) order by p.created_at),'[]') from payments p where p.invoice_id=i.id)) from invoices i where i.id='${inv(n)}'`);
const key = (n) => nid(7000 + n);
try {
  // F1 two different receipts racing for the same balance (700 + 700 against 1000)
  const a = asUser(db, U.accounts, pay(inv(1), 700, key(1)), 1.5);
  await sleep(300);
  const b = asUser(db, U.accounts2, pay(inv(1), 700, key(2)));
  const [ra, rb] = await Promise.all([a, b]);
  log({ id: 'F1-concurrent-receipts-700+700-on-1000', expect: 'second refused or held as advance; amount_paid never above 1000 without a credit record', first: { ok: ra.ok, err: ra.err }, second: { ok: rb.ok, err: rb.err }, invoice: JSON.parse(state(1)) });

  // F2 the same idempotency key submitted twice at once
  const c = asUser(db, U.accounts, pay(inv(2), 400, key(3)), 1.5);
  await sleep(300);
  const d = asUser(db, U.accounts, pay(inv(2), 400, key(3)));
  const [rc, rd] = await Promise.all([c, d]);
  log({ id: 'F2-concurrent-same-idempotency-key', expect: 'one payment of 400', first: { ok: rc.ok, err: rc.err }, second: { ok: rd.ok, err: rd.err, out: rd.out.slice(0, 200) }, invoice: JSON.parse(state(2)) });

  // F2b the same key reused for a different amount / invoice
  const e = await asUser(db, U.accounts, pay(inv(3), 999, key(3)));
  log({ id: 'F2b-idempotency-key-reused-for-other-invoice', expect: 'refused, not silently replayed as success', ok: e.ok, err: e.err, out: e.out.slice(0, 220), invoice: JSON.parse(state(3)) });

  // F3 single overpayment
  const f = await asUser(db, U.accounts, pay(inv(3), 1500, key(4)));
  log({ id: 'F3-overpayment-1500-on-1000', expect: 'refused or explicit advance', ok: f.ok, err: f.err, invoice: JSON.parse(state(3)) });

  // F4 direct RPC bypassing zod: zero, negative, absurd precision, future date, unknown method
  for (const [label, amount, extra] of [['zero', 0, {}], ['negative', -100, {}], ['sub-paisa', 0.004, {}], ['fractional-paisa', 100.005, {}], ['future-date', 10, { payment_date: '2099-01-01' }], ['ancient-date', 10, { payment_date: '1990-01-01' }], ['unknown-method', 10, { payment_method: 'barter' }], ['nan', 'NaN', {}]]) {
    const r = await asUser(db, U.accounts, pay(inv(4), amount, key(10 + label.length + (amount === 'NaN' ? 50 : 0) + (extra.payment_date === '1990-01-01' ? 30 : 0)), extra));
    log({ id: `F4-direct-rpc-${label}`, expect: 'refused', ok: r.ok, err: r.err });
  }
  log({ id: 'F4-invoice-after-direct-rpc', invoice: JSON.parse(state(4)) });

  // F5 role enforcement inside the RPC (direct call, no application layer)
  for (const [who, actor] of [['sales', U.sales], ['viewer', U.viewer], ['production', U.production], ['dealer', U.dealer], ['inactive', U.inactive], ['foreign-owner', U.foreign], ['owner', U.owner]]) {
    const r = await asUser(db, actor, pay(inv(5), 10, nid(7100 + who.length + (who === 'owner' ? 40 : 0) + (who === 'dealer' ? 20 : 0))));
    log({ id: `F5-receipt-as-${who}`, expect: who === 'owner' ? 'accepted' : 'refused', ok: r.ok, err: r.err });
  }
  log({ id: 'F5-invoice-after-role-attempts', invoice: JSON.parse(state(5)) });

  // F6 cancelled invoice
  const g = await asUser(db, U.accounts, pay(inv(8), 100, key(60)));
  log({ id: 'F6-receipt-on-cancelled-invoice', expect: 'refused', ok: g.ok, err: g.err, invoice: JSON.parse(state(8)) });

  // F7 reversal: twice with different keys, then with the same key, and a reversal race
  await asUser(db, U.accounts, pay(inv(6), 600, key(70)));
  const pid = admin(db, `select id from payments where invoice_id='${inv(6)}' limit 1`);
  const rev = (k, reason = 'Audit reversal test') => `select public.reverse_payment_atomic('${pid}', '${reason}', '${k}');`;
  const h1 = asUser(db, U.accounts, rev(key(71)), 1.5); await sleep(300);
  const h2 = asUser(db, U.accounts2, rev(key(72)));
  const [r1, r2] = await Promise.all([h1, h2]);
  log({ id: 'F7-concurrent-double-reversal', expect: 'one reversal; balance returns to 1000 exactly once', first: { ok: r1.ok, err: r1.err }, second: { ok: r2.ok, err: r2.err }, invoice: JSON.parse(state(6)) });
  const sums = admin(db, `select json_agg(json_build_object('invoice',i.invoice_number,'amount_paid',i.amount_paid,'ledger',(select coalesce(sum(case when p.payment_status in ('reversed','void','cancelled') then 0 else p.amount end),0) from payments p where p.invoice_id=i.id),'statuses',(select json_agg(distinct p.payment_status) from payments p where p.invoice_id=i.id))) from invoices i where i.company_id='${U.company}'`);
  log({ id: 'F8-amount_paid-vs-payment-ledger', expect: 'amount_paid equals the sum of live payments on every invoice', rows: JSON.parse(sums) });

  // F9 direct table writes by the accounts role, bypassing the writer
  for (const [label, sql] of [
    ['update-invoice-amount_paid', `update public.invoices set amount_paid=grand_total where id='${inv(7)}' returning amount_paid;`],
    ['update-invoice-grand_total', `update public.invoices set grand_total=1, subtotal=1 where id='${inv(7)}' returning grand_total;`],
    ['insert-payment-row', `insert into public.payments(company_id,invoice_id,order_id,payment_date,amount,payment_method) values('${U.company}','${inv(7)}',null,current_date,1000,'cash') returning id;`],
    ['delete-payment-row', `delete from public.payments where invoice_id='${inv(5)}' returning id;`],
    ['update-payment-amount', `update public.payments set amount=1 where invoice_id='${inv(5)}' returning id;`],
    ['delete-invoice', `delete from public.invoices where id='${inv(7)}' returning id;`],
  ]) {
    const r = await asUser(db, U.accounts, sql);
    log({ id: `F9-accounts-direct-${label}`, expect: 'refused or no row', ok: r.ok, rows: r.out ? r.out.split('\n').length : 0, err: r.err });
  }
  log({ id: 'F9-invoice-after-direct-writes', invoice: JSON.parse(state(7)) });
} finally {
  dropDb(db);
}
