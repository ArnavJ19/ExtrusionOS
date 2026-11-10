import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

// Guard the target before running any operation other than the fingerprint SELECT.
const executable = 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const args = ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', '59471', '-U', 'audit_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const execute = (sql) => {
  const result = spawnSync(executable, args, { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(String(result.error ?? result.stderr).slice(-7000));
  return result.stdout.trim();
};
const pgdata = execute("select current_setting('data_directory');");
assert.equal(realpathSync(pgdata).toLowerCase(), realpathSync(join(process.cwd(), '.audit-pg')).toLowerCase());
assert.equal(execute("select to_regclass('public.companies') is null;"), 't', 'Requires a fresh disposable cluster');

const driver = readFileSync('scripts/lib/migration-chain-replay.mjs', 'utf8');
const boundary = String.fromCharCode(96);
const prelude = driver.split('const platform = ' + boundary)[1].split(boundary)[0];
const migrations = readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort();
const cut = '20261103100000_november_coordination.sql';
const company = '8a090000-0000-4000-8000-000000000001';
const actor = '8a090000-0000-4000-8000-000000000002';
const migration = (file) => '\\echo APPLY ' + file + '\n' + readFileSync(join('supabase', file), 'utf8') + '\n';
const start = Date.now();
const finalScript = [
  prelude, migration('schema.sql'), migration('rls.sql'),
  ...migrations.filter((file) => file < cut).map((file) => migration('migrations/' + file)),
  "insert into public.companies(id,name,gst_state_code) values('" + company + "','Synthetic prior release company','07');",
  '\\echo CHECKPOINT pre-November with one synthetic company',
  ...migrations.filter((file) => file >= cut).map((file) => migration('migrations/' + file)),
  "select 'RETAINED ' || count(*) from public.companies where id='" + company + "' and name='Synthetic prior release company';",
].join('\n');
const result = execute(finalScript);
assert.equal(result.split(/\r?\n/).filter((line) => line.startsWith('APPLY ')).length, migrations.length + 2);
assert.match(result, /RETAINED 1/);
console.log(JSON.stringify({ phase: 'native replay + representative pre-November upgrade', applied: migrations.length + 2, priorCompanyRetained: true, ms: Date.now() - start }));

const catalog = execute([
  "select jsonb_build_object('server', version(),",
  "'publicTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),",
  "'publicCompanyTablesWithoutRls', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='company_id' and not a.attisdropped where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),",
  "'publicAndPrivateDefiners', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef),",
  "'definersWithNoExplicitSearchPath', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and not exists(select 1 from unnest(p.proconfig) opt where opt like 'search_path=%')),",
  "'policyCount', (select count(*) from pg_policies where schemaname in ('public','storage')),",
  "'onboardingAuthenticatedGrant', has_function_privilege('authenticated','public.onboard_company_atomic(jsonb,jsonb)','execute'),",
  "'singleCompanyGuardEnabled', (select tgenabled <> 'D' from pg_trigger where tgname='trg_enforce_single_company' and tgrelid='public.companies'::regclass));",
].join('\n'));
console.log(catalog);

execute("insert into auth.users(id,email) values('" + actor + "','series-owner@example.invalid'); " +
  "insert into public.document_series(company_id,doc_key,prefix_template,pad_width,status,gap_free,confirmed_by) values ('" + company + "','orders','A/{FY}/',4,'active',true,'" + actor + "');");
const next = "select pg_backend_pid(),private.next_business_number_locked('public.orders','order_number','" + company + "','O','2026-04-01');";
const startSession = (suffix) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(out.trim().split(/\r?\n/)[0]) : reject(new Error(err)));
  child.stdin.end("set statement_timeout='10s'; begin; " + next + suffix);
});
const first = startSession(' select pg_sleep(0.75); commit;');
const second = startSession(' commit;');
const concurrent = (await Promise.all([first, second])).map((line) => line.split('|'));
assert.equal(new Set(concurrent.map(([pid]) => pid)).size, 2);
assert.deepEqual(concurrent.map(([, number]) => number).sort(), ['A/26-27/0001', 'A/26-27/0002']);
const aborted = execute('begin; ' + next + ' rollback;').split('|')[1];
const committed = execute('begin; ' + next + ' commit;').split('|')[1];
assert.equal(aborted, 'A/26-27/0003');
assert.equal(committed, aborted);
console.log(JSON.stringify({ phase: 'independent concurrent financial-year allocator and rollback', concurrent, aborted, committed }));
