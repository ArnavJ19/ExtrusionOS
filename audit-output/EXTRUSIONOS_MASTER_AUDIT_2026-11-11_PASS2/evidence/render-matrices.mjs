// PASS2 audit: render 03_MODULE_COVERAGE_MATRIX.md and 09_NOVEMBER_FEATURE_VERIFICATION.md from machine evidence.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const A = process.argv[2], E = join(A, 'evidence');
const count = (d, re) => { let n = 0; if (!existsSync(d)) return 0; for (const x of readdirSync(d)) { const p = join(d, x); if (statSync(p).isDirectory()) n += count(p, re); else if (re.test(x)) n++; } return n; };
const tests = readdirSync('tests').filter(f => f.endsWith('.test.mjs'));
const kinds = Object.fromEntries(JSON.parse(readFileSync(join(E, 'test-quality.json'), 'utf8')).map(r => [r.file, r.kind]));
// What this pass independently executed, by route family. Everything else is "suite + static only".
const mine = {
  settings: ['Reproduced defect', 'PA2-001 (no suspend/role change; app_users UPDATE recursion); RLS probes'],
  payments: ['Independently verified', 'Receipt writer: two-session races, idempotency, reversal, roles (finance-probes.log)'],
  invoices: ['Independently verified (receipt side)', 'Direct-write and delete refusal; GST and statutory acceptance open'],
  quotes: ['Independently verified + defects', '600-case TS/SQL differential; PA2-010, PA2-017, PA2-018, PA2-022'],
  foundry: ['Reproduced defects', 'PA2-002 cast mass, PA2-003 chemistry'],
  production: ['Reproduced defect', 'PA2-004 partial-issue completion'],
  packaging: ['Reproduced defect', 'PA2-007 packaging purchase vs consumption balance'],
  scan: ['Defect (config)', 'PA2-008 camera blocked by Permissions-Policy'],
  mobile: ['Defect (config)', 'PA2-008 camera blocked on mobile scan'],
  dashboard: ['Fix verified + defect', 'Reserved-kg fix verified (MFA-005); PA2-012 malformed payload'],
  documents: ['Reproduced defect (policy level)', 'PA2-005 storage role gap'],
  reports: ['Reproduced defect (policy level)', 'PA2-005 reports bucket open to any company user'],
  'dealer-orders': ['Strongly supported', 'MFA-012 capped overview; dealer RLS probes'],
  'dealer-inventory': ['RLS probes only', 'Dealer isolation probes; PA2-016 staff directory visible'],
  tasks: ['Strongly supported + failing tests', 'MFA-012 capped overview; PA2-015 NOV-002 pin tests fail'],
  orders: ['Strongly supported', 'MFA-013 credit gate; cross-company RLS probes'],
  customers: ['RLS and delete probes', 'Cross-company, viewer delete, FK restrict verified'],
  dispatches: ['Delete guard verified', 'Dispatched record delete refused; stock races not independently run'],
  'systems-configurator': ['Suite + unlisted tests', '14 unlisted tests pass (PA2-023); engineering values not independently derived'],
  inventory: ['Fix verified', 'Stock snapshot reserved basis; packaging split PA2-007'],
};
const families = readdirSync('app/(dashboard)').filter(d => statSync(join('app/(dashboard)', d)).isDirectory()).sort();
let md = '# Module Coverage Matrix\n\nHEAD `a0ef08d`. One row per dashboard route family, plus API, Auth and portal. The test-file column counts test files whose name mentions the family (a heuristic, so shared suites such as the November batches are undercounted). "This pass" states what this audit independently executed; "Suite + static only" means the module rests on the existing suite and source reading. Signed-in browser use against a real Auth backend was not possible for any module (see [08](08_UI_UX_AND_OPERATOR_AUDIT.md)).\n\n| Module | Pages | Test files (SQL / browser / text-only) | This pass | Evidence or finding | Hosted and operator verification |\n|---|---|---|---|---|---|\n';
for (const f of families) {
  const key = f.replace(/s$/, '').replace(/-/g, '[-_]?');
  const t = tests.filter(x => new RegExp(key, 'i').test(x));
  const k = (kind) => t.filter(x => kinds[x] === kind).length;
  const m = mine[f] ?? ['Suite + static only', ''];
  md += `| ${f} | ${count(join('app/(dashboard)', f), /^page\.tsx$/)} | ${t.length} (${k('sql-behaviour')} / ${k('browser-fixture')} / ${k('source-text-only')}) | ${m[0]} | ${m[1]} | Not verified |\n`;
}
md += `| api (route handlers) | ${count('app/api', /^route\.ts$/)} routes | n/a | Static review of every route | Each route authenticates through a session helper or server action, except invite acceptance (token) and cron (bearer secret). PA2-026 | Not verified |\n`;
md += `| auth (login, invite, onboarding) | ${count('app/(auth)', /^page\.tsx$/)} | n/a | Reproduced + hosted metadata | PA2-009 onboarding drift; PA2-013 signed-out deep link; invite acceptance read | Provider sign-up setting not readable |\n`;
md += `| portal | ${count('app/portal', /^page\.tsx$/)} | n/a | RPC sweep only | portal_self_service_command refuses non-portal identities | Not verified |\n`;
md += `\nTotals: ${count('app', /^page\.tsx$/)} page files, ${count('app/api', /^route\.ts$/)} API routes, ${tests.length} test files. Database objects are covered in [07](07_DATABASE_AND_MIGRATION_AUDIT.md).\n`;
writeFileSync(join(A, '03_MODULE_COVERAGE_MATRIX.md'), md);

const nov = JSON.parse(readFileSync(join(E, 'nov-coverage.json'), 'utf8'));
const sqlIds = nov.filter(r => r.testKinds['sql-behaviour']).length, browserIds = nov.filter(r => r.testKinds['browser-fixture']).length;
let n = '# November Feature Verification (NOV-001 to NOV-100)\n\nHEAD `a0ef08d`. This is an evidence index per catalogue ID, generated from the full-suite log of this pass ([test.log](evidence/test.log)) and the source tree ([generator](evidence/nov-coverage.mjs), [data](evidence/nov-coverage.json)).\n\n';
n += `**What it establishes.** Every ID has at least one passing test that names it. ${sqlIds} IDs have a test file that drives the real SQL through the replayed migration chain as a low-privilege role, and ${browserIds} have a mounted-browser fixture. Two IDs (NOV-002, NOV-100) have failing tests (PA2-015).\n\n`;
n += '**What it does not establish.** No November feature was used by a signed-in person against real Auth, Storage or plant data in this pass. I did not individually re-derive three edge cases per feature; where the status says "suite", the claim rests on the existing tests, whose quality is assessed in [10](10_TEST_AND_PERFORMANCE_REPORT.md). The hosted database carries the same function bodies as the repo (see [07](07_DATABASE_AND_MIGRATION_AUDIT.md)), so SQL-level results carry over to hosted; UI results do not.\n\n';
n += 'Evidence levels: **S** SQL behaviour test through the migration chain · **B** mounted browser fixture · **U** unit or logic test · **T** source-text assertion only.\n\n| ID | Catalogue title | Named tests pass / fail | Evidence | Status |\n|---|---|---|---|---|\n';
// Titles come from the catalogue's own "### NOV-nnn - Title" headings, not from the first line that mentions the ID.
const titles = Object.fromEntries([...readFileSync('NOV_UPGRADES.md', 'utf8').matchAll(/^### (NOV-\d{3}) - (.+)$/gm)].map(m => [m[1], m[2].trim()]));
for (const r of nov) {
  r.title = titles[r.id] ?? r.title;
  const ev = [r.testKinds['sql-behaviour'] ? 'S' : '', r.testKinds['browser-fixture'] ? 'B' : '', r.testKinds['unit-behaviour'] ? 'U' : '', (r.testKinds['source-text-only'] || r.testKinds['mostly-source-text']) ? 'T' : ''].filter(Boolean).join(' ');
  const status = r.testsNamingId.fail ? 'Failing test (PA2-015)' : r.testKinds['sql-behaviour'] ? 'Suite-verified at SQL level; operator acceptance open' : 'Suite-verified at UI or unit level only; SQL and operator acceptance open';
  n += `| ${r.id} | ${r.title.replace(/^NOV-\d+\s*-?\s*/, '').replace(/\|/g, '/')} | ${r.testsNamingId.pass} / ${r.testsNamingId.fail} | ${ev || 'none'} | ${status} |\n`;
}
n += '\n## Command protocol (preview, review, commit)\n\nThe November command RPCs were swept as a signed-in account with no staff row, a suspended user and a viewer. 168 of 176 privileged functions refuse the first two with a permission error before doing anything; the other 8 fail on argument validation or return an empty value ([rpc-sweep.log](evidence/rpc-sweep.log)). Stale-fingerprint, expiry and second-person rules are covered by the SQL tests marked S above. I did not add independent two-session tests for them, so concurrent preview and commit by two people remains suite-level evidence.\n';
writeFileSync(join(A, '09_NOVEMBER_FEATURE_VERIFICATION.md'), n);
console.log('families', families.length, 'nov', nov.length, 'sqlIds', sqlIds, 'browserIds', browserIds);
