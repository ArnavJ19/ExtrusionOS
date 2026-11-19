// PASS2 audit helper: independent psql sessions against the disposable native PostgreSQL 18 cluster
// (127.0.0.1:59472, scratchpad data directory, trust auth, synthetic data only). Each experiment clones the
// replayed template database, so nothing persists between experiments and nothing touches a hosted project.
import { spawn, spawnSync } from 'node:child_process';

const PSQL = 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const base = ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', '59472', '-U', 'audit_admin'];
export const nid = (n) => `bd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const U = { company: nid(1), foreignCompany: nid(2), owner: nid(10), admin: nid(11), salesManager: nid(12), sales: nid(13), accounts: nid(14), productionManager: nid(15),
  production: nid(16), backup: nid(17), quality: nid(18), viewer: nid(19), foreign: nid(20), inactive: nid(21), dispatch: nid(22), dealer: nid(23), inventory: nid(24), factory: nid(25),
  accounts2: nid(26), customer: nid(30), profile: nid(40) };

export function admin(db, sql) {
  const r = spawnSync(PSQL, [...base, '-d', db, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || '').slice(-1500));
  return r.stdout.trim();
}
export function cloneDb(name) {
  admin('postgres', `drop database if exists ${name} with (force);`);
  admin('postgres', `create database ${name} template audit_tpl;`);
  return name;
}
export const dropDb = (name) => admin('postgres', `drop database if exists ${name} with (force);`);
/** SQL wrapped as an authenticated end-user transaction. `hold` seconds keeps the transaction open before commit. */
export const asUserSql = (actor, sql, hold = 0) => `begin;
select set_config('request.jwt.claim.sub','${actor}',true), set_config('request.jwt.claim.role','authenticated',true) \\gset _x
set local role authenticated;
${sql}
${hold ? `select pg_sleep(${hold}) \\gset _s` : ''}
commit;`;
/** Run one session to completion; resolves with { ok, out, err } and never throws. */
export function session(db, sql) {
  return new Promise((resolve) => {
    const c = spawn(PSQL, [...base, '-d', db, '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim().split(/\r?\n/).filter((l) => /ERROR|DETAIL/.test(l)).join(' | ').slice(0, 300) }));
    c.stdin.end(sql);
  });
}
export const asUser = (db, actor, sql, hold = 0) => session(db, asUserSql(actor, sql, hold));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (o) => console.log(JSON.stringify(o));
