// PASS2 audit: classify each tests/*.test.mjs by the kind of evidence it can produce.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const rows = [];
for (const f of readdirSync('tests').filter(f => f.endsWith('.test.mjs')).sort()) {
  const t = readFileSync('tests/' + f, 'utf8');
  const tests = (t.match(/\b(test|it)\(/g) || []).length;
  const db = /PGlite|Fixture\(|replayMigrationChain|createClient\(/.test(t);
  const browser = /chromium|playwright/.test(t);
  const imports = /from ["'](\.\.\/(lib|components|app)\/|@\/)/.test(t) || /import\(.*(lib|components)\//.test(t);
  const reads = (t.match(/readFileSync|readFile\(/g) || []).length;
  const stringAsserts = (t.match(/assert\.(match|doesNotMatch)\(|\.includes\(/g) || []).length;
  const valueAsserts = (t.match(/assert\.(equal|deepEqual|strictEqual|deepStrictEqual|rejects|throws|ok)\(/g) || []).length;
  const fc = /fast-check|fc\.assert/.test(t);
  const kind = browser ? 'browser-fixture' : db ? 'sql-behaviour' : (reads > 0 && !imports && stringAsserts >= valueAsserts) ? 'source-text-only' : (reads > 0 && stringAsserts > valueAsserts * 2) ? 'mostly-source-text' : 'unit-behaviour';
  rows.push({ file: f, tests, kind, property: fc, reads, stringAsserts, valueAsserts });
}
const by = {}; for (const r of rows) { by[r.kind] ??= { files: 0, tests: 0 }; by[r.kind].files++; by[r.kind].tests += r.tests; }
writeFileSync(process.argv[2], JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ files: rows.length, tests: rows.reduce((s, r) => s + r.tests, 0), byKind: by, propertyFiles: rows.filter(r => r.property).map(r => r.file) }));
console.log(rows.filter(r => r.kind === 'source-text-only').map(r => r.file + ':' + r.tests).join(' '));
