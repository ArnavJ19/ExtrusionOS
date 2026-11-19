// PASS2 audit: low-privilege RLS / grant probes on the disposable PGlite replay of the full migration chain.
// Run from the repository root: node --no-warnings --experimental-strip-types <this file>
// Everything is synthetic and rolled back. Nothing here touches a hosted database.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { createCashFixture, cIds: ids } = await import(pathToFileURL(join(process.cwd(), 'scripts/lib/autopilot-batch3-fixture.mjs')).href);

const f = await createCashFixture();
const { db } = f;
await f.start();
const out = (o) => console.log(JSON.stringify(o));
async function probe(id, expect, sql, params, actor, summarize = (rows) => rows) {
  try {
    const rows = await f.asUser(sql, params, actor);
    out({ id, expect, outcome: 'executed', result: summarize(rows) });
  } catch (e) {
    out({ id, expect, outcome: 'refused', code: e.code, message: String(e.message).slice(0, 160) });
  }
}
async function asRole(role, sql, params = []) {
  await db.exec('savepoint p_role');
  try {
    await db.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role',$1,true)", [role]);
    await db.exec(`set local role ${role}`);
    const r = await db.query(sql, params);
    await db.exec('reset role; release savepoint p_role');
    return { outcome: 'executed', rows: r.rows };
  } catch (e) {
    await db.exec('rollback to savepoint p_role; reset role; release savepoint p_role');
    return { outcome: 'refused', code: e.code, message: String(e.message).slice(0, 160) };
  }
}
const n = (rows) => rows.length;
try {
  // --- self-escalation and identity columns
  for (const [who, actor] of [['viewer', ids.viewer], ['sales', ids.sales], ['production', ids.production], ['dealer', ids.dealer], ['admin', ids.admin]]) {
    await probe(`S1-self-role-${who}`, 'no row changed', "update public.app_users set role='owner' where id=$1 returning role", [actor], actor, n);
  }
  await probe('S1-admin-promotes-other-to-owner', 'policy decision: admin may not mint owners', "update public.app_users set role='owner' where id=$1 returning role", [ids.viewer], ids.admin, n);
  await probe('S1-self-company-move', 'no row changed', 'update public.app_users set company_id=$2 where id=$1 returning company_id', [ids.sales, ids.foreignCompany], ids.sales, n);
  await probe('S1-inactive-self-reactivate', 'no row changed', 'update public.app_users set is_active=true where id=$1 returning is_active', [ids.inactive], ids.inactive, n);
  await probe('S1-stranger-inserts-own-app_user', 'refused', "insert into public.app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'x','x@x.invalid','owner',true) returning id",
    ['bd000000-0000-4000-8000-000000009999', ids.company], 'bd000000-0000-4000-8000-000000009999', n);

  // --- cross-company reads / writes (foreign owner belongs to the other company)
  for (const t of ['orders', 'customers', 'invoices', 'quotes', 'app_users', 'payments', 'profile_stock_batches', 'billet_batches', 'audit_logs', 'costing_rates', 'bank_statement_lines', 'dies', 'documents']) {
    await probe(`S2-foreign-reads-${t}`, 0, `select count(*)::int c from public.${t} where company_id=$1`, [ids.company], ids.foreign, (r) => r[0].c);
  }
  await probe('S2-foreign-updates-order', 0, "update public.orders set priority='urgent' where id=$1 returning id", [ids.order], ids.foreign, n);
  await probe('S2-sales-inserts-customer-into-foreign-company', 'refused', "insert into public.customers(company_id,customer_name,customer_type) values($1,'Forged','fabricator') returning id", [ids.foreignCompany], ids.sales, n);

  // --- suspended user
  for (const t of ['orders', 'customers', 'invoices', 'app_users']) {
    await probe(`S3-inactive-reads-${t}`, 0, `select count(*)::int c from public.${t}`, [], ids.inactive, (r) => r[0].c);
  }
  await probe('S3-inactive-coordination-command', 'refused', "select public.coordination_command('preview', $1) d", [{ mutation: { kind: 'noop' }, request_id: 'bd000000-0000-4000-8000-000000009001' }], ids.inactive, n);
  await probe('S3-inactive-get_stock_snapshot', 'all zero / refused', 'select public.get_stock_snapshot() d', [], ids.inactive, (r) => r[0].d);

  // --- authenticated account with no app_users row (a self-registered stranger)
  const stranger = 'bd000000-0000-4000-8000-000000009998';
  await db.query("insert into auth.users(id,email) values($1,'stranger@x.invalid')", [stranger]);
  for (const t of ['orders', 'customers', 'invoices', 'app_users', 'companies', 'aluminium_profiles', 'pcda_master_alloys', 'subscription_plans', 'permissions', 'roles', 'system_templates']) {
    await probe(`S4-stranger-reads-${t}`, 0, `select count(*)::int c from public.${t}`, [], stranger, (r) => r[0].c);
  }
  await db.exec('alter table public.companies enable trigger trg_enforce_single_company');
  await probe('S4-stranger-onboards-second-company', 'refused', "select public.onboard_company_atomic($1,$2) id", [{ name: 'Intruder Co' }, { full_name: 'Intruder' }], stranger, n);
  // The guard only blocks when a company already exists: prove the empty-database case inside a savepoint.
  await db.exec('savepoint empty_co; set session_replication_role = replica');
  await db.query('delete from public.app_users'); await db.query('delete from public.companies');
  await db.exec('set session_replication_role = origin');
  await probe('S4-stranger-onboards-when-no-company-exists', 'refused for an invitation-only deployment', "select public.onboard_company_atomic($1,$2) id", [{ name: 'Intruder Co' }, { full_name: 'Intruder' }], stranger, n);
  await db.exec('rollback to savepoint empty_co; release savepoint empty_co');
  await db.exec('alter table public.companies disable trigger trg_enforce_single_company');

  // --- anon
  for (const t of ['orders', 'customers', 'invoices', 'app_users', 'companies', 'quotes', 'invitations', 'pcda_master_alloys']) {
    out({ id: `S5-anon-reads-${t}`, expect: '0 or refused', ...(await asRole('anon', `select count(*)::int c from public.${t}`)) });
  }
  out({ id: 'S5-anon-executable-functions', expect: 'none beyond trigger/helper functions', ...(await asRole('postgres',
    "select coalesce(jsonb_agg(p.proname order by p.proname),'[]') f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public') and p.prokind='f' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')").catch?.(() => ({})) ?? {}) });

  // --- role-inappropriate writes on business tables (direct PostgREST-style table access)
  await probe('S6-viewer-updates-invoice-paid', 0, 'update public.invoices set amount_paid=grand_total where id=$1 returning id', [ids.inv1], ids.viewer, n);
  await probe('S6-production-updates-invoice-paid', 0, 'update public.invoices set amount_paid=grand_total where id=$1 returning id', [ids.inv1], ids.production, n);
  await probe('S6-sales-updates-invoice-paid', 0, 'update public.invoices set amount_paid=grand_total where id=$1 returning id', [ids.inv1], ids.sales, n);
  await probe('S6-accounts-direct-updates-invoice-paid (bypassing receipt writer)', 'refused or reconciled by trigger', 'update public.invoices set amount_paid=grand_total where id=$1 returning amount_paid, payment_status', [ids.inv1], ids.accounts);
  await probe('S6-accounts-direct-zeroes-invoice-total', 'refused', 'update public.invoices set grand_total=1, subtotal=1 where id=$1 returning grand_total', [ids.inv2], ids.accounts);
  await probe('S6-viewer-updates-order-value', 0, 'update public.orders set order_value=1 where id=$1 returning id', [ids.order], ids.viewer, n);
  await probe('S6-production-updates-order-value', 0, 'update public.orders set order_value=1 where id=$1 returning id', [ids.order], ids.production, n);
  await probe('S6-dealer-reads-internal-invoices', 0, 'select count(*)::int c from public.invoices', [], ids.dealer, (r) => r[0].c);
  await probe('S6-dealer-reads-costing-rates', 0, 'select count(*)::int c from public.costing_rates', [], ids.dealer, (r) => r[0].c);
  await probe('S6-dealer-reads-customers', 0, 'select count(*)::int c from public.customers', [], ids.dealer, (r) => r[0].c);
  await probe('S6-dealer-reads-staff-emails', 'own row only', 'select count(*)::int c from public.app_users', [], ids.dealer, (r) => r[0].c);
  await probe('S6-production-reads-costing-rates', 'policy decision', 'select count(*)::int c from public.costing_rates', [], ids.production, (r) => r[0].c);
  await probe('S6-viewer-deletes-customer', 0, 'delete from public.customers where id=$1 returning id', [ids.customer3], ids.viewer, n);
  await probe('S6-sales-deletes-invoice', 0, 'delete from public.invoices where id=$1 returning id', [ids.inv3], ids.sales, n);
  await probe('S6-owner-deletes-invoice', 'refused (history)', 'delete from public.invoices where id=$1 returning id', [ids.inv3], ids.owner, n);

  // --- audit history immutability
  await f.asUser("update public.customers set city='Nagpur' where id=$1", [ids.customer2], ids.owner).catch(() => {});
  for (const t of ['audit_logs', 'audit_logs_enterprise', 'sensitive_action_logs', 'order_stage_history']) {
    await probe(`S7-owner-updates-${t}`, 0, `update public.${t} set company_id=company_id returning 1`, [], ids.owner, n);
    await probe(`S7-owner-deletes-${t}`, 0, `delete from public.${t} returning 1`, [], ids.owner, n);
  }
  await probe('S7-sales-forges-audit-log', 'refused', "insert into public.audit_logs(company_id,user_id,action,entity_type) values($1,$2,'forged','order') returning id", [ids.company, ids.owner], ids.sales, n);

  // --- catalog facts
  const cat = async (label, sql) => out({ id: label, result: (await db.query(sql)).rows[0] });
  await cat('C1-rls', "select count(*) filter (where c.relrowsecurity)::int with_rls, count(*) filter (where not c.relrowsecurity)::int without_rls, count(*) filter (where c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid=c.oid))::int rls_no_policy from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')");
  await cat('C2-definers', "select count(*)::int definers, count(*) filter (where not exists(select 1 from unnest(p.proconfig) o where o like 'search_path=%'))::int no_search_path, count(*) filter (where has_function_privilege('authenticated',p.oid,'execute') and n.nspname='public')::int public_definers_authenticated, count(*) filter (where has_function_privilege('anon',p.oid,'execute'))::int definers_anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef");
  await cat('C3-private-schema-usage', "select has_schema_privilege('authenticated','private','usage') authenticated_usage, has_schema_privilege('anon','private','usage') anon_usage, (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('authenticated',p.oid,'execute')) private_fns_authenticated");
  await cat('C4-permissive-policies', "select count(*)::int total, count(*) filter (where qual='true' or with_check='true')::int literally_true, coalesce(jsonb_agg(distinct tablename) filter (where (qual='true' or with_check='true') and cmd<>'SELECT'),'[]') write_true_tables, coalesce(jsonb_agg(distinct tablename) filter (where qual='true' and cmd='SELECT'),'[]') read_true_tables from pg_policies where schemaname='public'");
  await cat('C5-policies-for-anon-or-public', "select coalesce(jsonb_agg(distinct tablename),'[]') t from pg_policies where schemaname='public' and (roles && array['anon'::name])");
  await cat('C6-views-not-security-invoker', "select coalesce(jsonb_agg(c.relname order by c.relname),'[]') v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name='security_invoker'),false)");
  await cat('C7-definers-taking-company-id', "select coalesce(jsonb_agg(p.proname order by p.proname),'[]') f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute') and exists (select 1 from unnest(p.proargnames) a where a ~ 'company_id')");
  await cat('C8-storage-buckets', "select coalesce(jsonb_agg(jsonb_build_object('id',id,'public',public)),'[]') b from storage.buckets");
  await cat('C9-storage-policies', "select count(*)::int n, coalesce(jsonb_agg(jsonb_build_object('name',policyname,'cmd',cmd,'roles',roles)),'[]') p from pg_policies where schemaname='storage'");
} finally {
  await f.rollback();
  await db.close();
}
