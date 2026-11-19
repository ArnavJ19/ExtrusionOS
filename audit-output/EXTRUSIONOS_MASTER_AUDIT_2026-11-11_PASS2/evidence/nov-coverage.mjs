// PASS2 audit: per-ID evidence for NOV-001..NOV-100 at HEAD — catalogue title, passing/failing tests that name the ID in the
// full-suite log, the kind of those tests, and source files that reference the ID. Evidence index only; not proof of correctness.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const E = process.argv[2];
const cat = readFileSync('NOV_UPGRADES.md', 'utf8');
const log = readFileSync(join(E, 'test.log'), 'utf8');
const kinds = Object.fromEntries(JSON.parse(readFileSync(join(E, 'test-quality.json'), 'utf8')).map(r => [r.file, r.kind]));
const testFiles = readdirSync('tests').filter(f => f.endsWith('.test.mjs')).map(f => [f, readFileSync('tests/' + f, 'utf8')]);
const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|sql)$/.test(n)) out.push(p); } return out; };
const src = [...walk('lib'), ...walk('components'), ...walk('app'), ...walk('supabase/migrations')].map(p => [p.split(String.fromCharCode(92)).join('/'), readFileSync(p, 'utf8')]);
const lines = log.split(/\r?\n/).filter(l => /^(not ok|ok) \d+ - /.test(l.trim()) || /^\s+(not ok|ok) \d+ - /.test(l));
const rows = [];
for (let i = 1; i <= 100; i++) {
  const id = `NOV-${String(i).padStart(3, '0')}`, re = new RegExp(`${id}(?![0-9])`), short = new RegExp(`NOV-0*${i}(?![0-9])|NOV-[0-9]{3}/0*${i}(?![0-9])`);
  const title = (cat.split(/\r?\n/).find(l => re.test(l)) || '').replace(/[#|*`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  const mine = lines.filter(l => re.test(l) || short.test(l));
  const pass = mine.filter(l => /^\s*ok /.test(l)).length, fail = mine.filter(l => /^\s*not ok /.test(l)).length;
  const files = testFiles.filter(([, t]) => re.test(t)).map(([f]) => f);
  const k = {}; for (const f of files) k[kinds[f] ?? 'other'] = (k[kinds[f] ?? 'other'] ?? 0) + 1;
  const refs = src.filter(([, t]) => re.test(t)).map(([p]) => p);
  rows.push({ id, title, testsNamingId: { pass, fail }, testFiles: files, testKinds: k, sourceRefs: refs.length, sampleRefs: refs.slice(0, 4) });
}
writeFileSync(join(E, 'nov-coverage.json'), JSON.stringify(rows, null, 1));
const noTests = rows.filter(r => r.testsNamingId.pass + r.testsNamingId.fail === 0).map(r => r.id);
const noSql = rows.filter(r => !r.testKinds['sql-behaviour']).map(r => r.id);
const noBrowser = rows.filter(r => !r.testKinds['browser-fixture']).map(r => r.id);
console.log(JSON.stringify({ ids: rows.length, withPassingNamedTests: rows.filter(r => r.testsNamingId.pass > 0).length, withFailing: rows.filter(r => r.testsNamingId.fail > 0).map(r => r.id), noNamedTests: noTests, noSqlBehaviourTestFile: noSql, noBrowserFixture: noBrowser.length, noSourceRef: rows.filter(r => !r.sourceRefs).map(r => r.id) }));
