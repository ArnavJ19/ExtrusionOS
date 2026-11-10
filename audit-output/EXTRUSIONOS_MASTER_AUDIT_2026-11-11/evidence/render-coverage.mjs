import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const reports = dirname(evidence);
const snapshot = process.cwd();
const read = (path) => readFileSync(join(snapshot, path), 'utf8');
const json = (path) => JSON.parse(readFileSync(join(evidence, path), 'utf8').replace(/^\uFEFF/, ''));
const output = (path, lines) => writeFileSync(join(reports, path), lines.join('\n') + '\n');
const compact = (value) => String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
const code = (text) => String.fromCharCode(96) + text + String.fromCharCode(96);
const refs = (paths) => paths.map(code).join(', ');
const distinct = (values) => [...new Set(values)];
const inventory = json('source-inventory.json');
const routes = json('routes.json');
const modules = json('module-inventory.json');
const deps = json('dependency-index.json');

const reviewed = {
  auth: 'Signup, session context, suspension and onboarding source reviewed. Hosted guard and grant observed. Auth-provider policy open.',
  dashboard: 'Snapshot read and display traced. Reservation and malformed-payload issues reproduced.',
  foundry: 'Charge, cast, chemistry and billet issue traced. Cast and chemistry defects reproduced.',
  production: 'Ordinary completion and press-floor fixture exercised. Partial-issue defect reproduced.',
  inventory: 'Stock balance and reservation projection compared. Physical and historical reconciliation open.',
  quality: 'Specification and release gates reviewed. Approved master data and plant acceptance open.',
  packaging: 'Packaging evidence and dispatch joins traced. Separate material purchase/usage reconciliation open.',
  dispatches: 'Readiness, reservation consumption and billing handoffs traced. Dedicated rollback and concurrency acceptance open.',
  shipments: 'Receipt and shortage integration traced. Full accepted-stock and claim closure acceptance open.',
  'dealer-inventory': 'Receipt and fulfillable stock sources traced. A signed dealer balance bridge is open.',
  'dealer-orders': 'Dealer route/projection and overview cap reviewed. Fulfillment accounting acceptance open.',
  orders: 'Quote conversion, demand, material and shipment handoffs traced. Full lifecycle acceptance open.',
  quotes: 'Quote formula control case and approval test evidence. Issued-document scenarios remain a release gate.',
  invoices: 'Source fingerprint, approval and retained dispatch invoice boundary traced. External accounting sign-off open.',
  payments: 'Receipt matching and import tested. Two candidate bank-import defects reproduced.',
  expenses: 'Approval and payment fixtures reviewed. Supplier/GL reconciliation open.',
  'systems-configurator': 'Versioned rules, BOM and release snapshot tested at fixture level. Approved system dimensions and production handoff acceptance open.',
  scan: 'Chromium denied camera under the configured policy. Manual scan and role acceptance open.',
  mobile: 'Scan entry traced and selected workstation browser interactions executed. Full mobile route acceptance open.',
  tasks: 'November command hubs and test coverage inventoried. Overview cap and retained workflows require separate checks.',
  vendors: 'Procurement and vendor custody model reviewed. Full physical and payables acceptance open.',
  automation: 'Scheduled jobs and controlled automation scopes distinguished. Registry regression and hosted execution acceptance open.',
  settings: 'Feature flags, access and bootstrap configuration sampled. Per-control policy acceptance open.',
  portal: 'Projection and route boundaries reviewed. Signed-in customer/record ownership and Storage acceptance open.',
  'api/access': 'Invitation and role request surfaces inventoried. Selected grant and policy tests reviewed.',
  'api/cron': 'Cron registry and secret-presence contract reviewed. Hosted cron delivery and alerts open.',
  'api/pdf': 'Commercial lineage and document fixtures reviewed. Signed-in artifact and storage acceptance open.',
};
const moduleLines = [
  '# Module Coverage Matrix', '',
  'The rows are grouped by Next.js route family. The machine inventory records each route, static imports, components, service libraries, literal database references, migration origins and test-file candidates. Imports are followed up to three steps. A reference is a navigation aid and may be indirect. Dynamic RPC names, global layouts, and SQL objects created or replaced through dynamic statements require independent source or catalog review.', '',
  '[Machine-readable modules](evidence/module-inventory.json) · [Routes](evidence/routes.json) · [Dependency graph](evidence/dependency-index.json) · [Migration object index](evidence/sql-object-index.json)', '',
  '| Module | Routes | DB references | Candidate test files | Audit status |', '|---|---:|---:|---:|---|',
];
for (const row of modules) {
  moduleLines.push('| ' + code(row.module) + ' | ' + row.routes.length + ' | ' + Object.keys(row.databaseObjects).length + ' | ' + row.testsByFileName.length + ' | ' +
    (reviewed[row.module] ?? 'Inventoried. Independent functional, permission and operator acceptance open.') + ' |');
}
moduleLines.push('', 'Route-specific entry and API verbs appear in the [operator route index](08_UI_UX_AND_OPERATOR_AUDIT.md). Across the matrix, deployment mapping applies to the release as a whole. It does not certify any module on that release.');
output('03_MODULE_COVERAGE_MATRIX.md', moduleLines);

const groups = {
  1: ['Shared controls', 'lib/ui/status-presentation.ts', 'lib/ui/database-view.ts', 'lib/utils/numeric-display.ts'],
  2: ['Work Today and record entry', 'lib/workflow/next-action.ts', 'components/modules/operations/record-form-client.tsx'],
  3: ['Coordination', 'lib/actions/coordination.ts', 'supabase/migrations/20261103100000_november_coordination.sql'],
  4: ['Operations control', 'lib/actions/operations-control.ts', 'supabase/migrations/20261103200000_november_operations_control.sql'],
  5: ['Assurance', 'lib/actions/assurance.ts', 'supabase/migrations/20261103300000_november_assurance.sql'],
  6: ['Lifecycle', 'lib/actions/lifecycle.ts', 'supabase/migrations/20261103400000_november_lifecycle.sql'],
  7: ['Improvement', 'lib/actions/improvement.ts', 'supabase/migrations/20261103500000_november_improvement.sql'],
  8: ['Execution', 'lib/actions/execution.ts', 'supabase/migrations/20261103600000_november_execution.sql'],
  9: ['Commercial', 'supabase/migrations/20261103700000_november_commercial.sql'],
  10: ['Specialist', 'lib/actions/specialist.ts', 'supabase/migrations/20261103800000_november_specialist.sql'],
};
const specs = json('november-index.json');
const batches = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, read('NOV_UPGRADE_BATCH_' + (i + 1) + '.md').split(/\r?\n/)]));
const references = new Map();
for (const { file, kind } of inventory) {
  if (kind !== 'source' || !/^(app|components|lib|supabase\/migrations|tests)\//.test(file)) continue;
  const body = read(file);
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    for (const id of distinct(line.match(/\bNOV-\d{3}\b/g) ?? [])) {
      const row = references.get(id) ?? { code: [], tests: [] };
      (file.startsWith('tests/') ? row.tests : row.code).push({ file, line: index + 1 });
      references.set(id, row);
    }
  }
}

const tap = readFileSync(join(evidence, 'test-isolated.log'), 'utf8');
const casesByFeature = new Map();
for (const match of tap.matchAll(/^\s*(ok|not ok)\s+\d+\s+-\s+([^\r\n]+)$/gm)) {
  for (const id of distinct(match[2].match(/\bNOV-\d{3}\b/g) ?? [])) {
    const record = { status: match[1] === 'ok' ? 'pass' : 'fail', title: match[2] };
    const cases = casesByFeature.get(id) ?? [];
    cases.push(record);
    casesByFeature.set(id, cases);
  }
}
const catalogue = specs.map((entry) => {
  const batch = Number(entry.batchReferences[0]?.match(/BATCH_(\d+)/)?.[1] ?? 0);
  const rows = (batches[batch] ?? []).flatMap((line, index) => {
    if (!line.startsWith('|') || !line.includes(entry.id)) return [];
    return [{ line: index + 1, cells: line.split('|').slice(1, -1).map((value) => value.trim()) }];
  });
  const group = groups[batch] ?? [];
  const mention = references.get(entry.id) ?? { code: [], tests: [] };
  const testFiles = distinct(mention.tests.map(({ file }) => file));
  const testImports = distinct(testFiles.flatMap((file) => deps[file]?.imports ?? []).filter((file) => file.startsWith('lib/')));
  const shape = rows[0]?.cells ?? [];
  const deliveredClaim = (shape[0]?.startsWith('NOV-') ? shape[1] : shape[3]) ?? '';
  const testPlanClaim = (shape[0]?.startsWith('NOV-') ? shape[2] : shape[4]) ?? '';
  const boundary = rows.slice(1).find(({ cells }) => /not built|not yet|defer|only|partly|without/i.test(cells[1] ?? ''));
  return { ...entry, batch, group: group[0] ?? 'Unmapped', deliveredClaim, testPlanClaim,
    reportedScopeBoundary: boundary?.cells[1] ?? '', batchRows: rows.map(({ line }) => line), applicationRefs: mention.code, testRefs: mention.tests,
    implementationAnchors: distinct([...group.slice(1), ...testImports]).filter((file) => existsSync(join(snapshot, file))),
    cases: casesByFeature.get(entry.id) ?? [] };
});
writeFileSync(join(evidence, 'november-coverage.json'), JSON.stringify(catalogue, null, 2) + '\n');

const novLines = [
  '# November Feature Verification', '',
  'Each stable ID has a record keyed to the original specification, delivery note, current source and actual test output where the test title identifies the feature. Delivery-note text is historical scope evidence. An executed case name supplies runtime evidence for that case. It does not establish all advertised steps, permissions, three distinct edge cases, signed-in roles, hosted rollback or plant acceptance. Test aliases and group anchors are listed separately from direct implementation mentions.', '',
  '[Per-feature evidence and case names](evidence/november-coverage.json) · [Captured test output](evidence/test-isolated.log)', '',
  '| ID | Specification | Batch and current anchor | Identified executed cases | Scope and acceptance |', '|---|---|---|---|---|',
];
for (const entry of catalogue) {
  const pass = entry.cases.filter(({ status }) => status === 'pass').length;
  const fail = entry.cases.length - pass;
  const observed = entry.cases.length ? pass + ' passed, ' + fail + ' failed' : 'No ID-labelled outcome';
  const anchor = entry.applicationRefs[0] ? code(entry.applicationRefs[0].file + ':' + entry.applicationRefs[0].line) : refs(entry.implementationAnchors.slice(0, 1));
  novLines.push('| ' + entry.id + ' | ' + compact(entry.title) + ' (' + code(entry.specification) + ') | ' + entry.batch + ' · ' + entry.group + ' · ' + anchor +
    ' | ' + observed + ' | ' + (entry.reportedScopeBoundary ? compact(entry.reportedScopeBoundary) : 'Acceptance open') + ' |');
}
novLines.push('', '### Cross-cutting results', '',
  '- NOV-017 connects scans to tasks in the workflow. MFA-009 separately reproduces camera capture denial at the global browser policy.',
  '- The preview/commit groups use server actions and versioned command payloads. Fingerprint, independent reviewer, stale input and replay checks vary by command. See the JSON for actual case names and the cross-module report for missing multi-session cases.',
  '- Separate-account and advisory scope matters. NOV-032 avoids posting customer-owned metal into ordinary billet stock, and production consumption posting remains deferred in that delivered slice. NOV-024 planning scenarios remain advisory. NOV-080 supports reviewed/manual internal execution within its scope and defers a background lease/retry runner.',
  '- PO parsing (NOV-061) covers pasted text. File ingestion and OCR remain beyond the documented slice. NOV-067 covers whole-bundle transfers, distinct from the split/merge workflow in NOV-068. External weighing hardware and approved calibration are separate acceptance evidence.',
  '- Hosted migrations are grouped and split under server-generated IDs. The [ledger comparison](07_DATABASE_AND_MIGRATION_AUDIT.md) gives group presence. No feature receives hosted acceptance from a matching name.',
);
output('09_NOVEMBER_FEATURE_VERIFICATION.md', novLines);

const routeLines = [
  '# UI, UX and Operator Audit', '',
  'MFA-009 reproduces camera denial under the configured global header in Chromium. The route renders an Open camera button and a typed-code fallback. Test artifacts also exercise mounted controls at phone and desktop widths. The isolated keypad test passed at 375 px after localhost access was available. Mounted fixtures represent their supplied role and data state. Actual signed-in persistence, tablets, devices and factory observation are separate acceptance work.', '',
  '| Scenario | Evidence | Remaining acceptance |', '|---|---|---|',
  '| Stock overview | Reservation overstatement and malformed-response zeros reproduced | Verify owner/stores totals during partial holds and late QC |',
  '| Camera QR | Synthetic camera works under control policy and fails under the configured header | Test deployed mobile camera, permission denial, light/damage, scan routing and physical bundle identity |',
  '| Workstation entry | Actual React keypad fixture executed at phone width | Test tablets, shared devices, keyboard/large text, interrupted network and an approved shift |',
  '| Shared record pages | November tests exercise search, pagination, stale selection, read errors, numeric display and double submissions | Per-route desktop/tablet/phone acceptance and committed ledger effects |',
  '| Documents | PDF and print-related routes inventoried and fixture tests executed | Check representative customer identities, page breaks, fonts, ownership and signed link expiry in staging |',
  '| Onboarding | Captured signup redirects. Latest production deployment source still contains signup | Verify invitation and suspension journeys in the final bound environment |',
  '', '## Route Index', '',
  'Every captured route is listed below. “Indexed” records source discovery. “Traced” records specific audit work described above. Browser fixture coverage is recorded by case, and the index gives no blanket per-route interaction pass.', '',
  '| Route | Surface | Handler or page | Scope |', '|---|---|---|---|',
];
for (const row of routes) {
  const scope = ['/scan', '/mobile/scan', '/signup', '/onboarding', '/dashboard', '/production/floor', '/dealer-orders', '/tasks'].includes(row.route)
    ? 'Traced' : 'Indexed';
  routeLines.push('| ' + code(row.route) + ' | ' + row.surface + (row.methods.length ? ' ' + row.methods.join('/') : '') + ' | ' + code(row.file) + ' | ' + scope + ' |');
}
output('08_UI_UX_AND_OPERATOR_AUDIT.md', routeLines);

const baseline = json('baseline.json');
if (process.env.EXOS_AUDIT_GIT) {
  const paths = execFileSync(process.env.EXOS_AUDIT_GIT, ['ls-files', '-z', '-c', '-o', '--exclude-standard'], {
    cwd: baseline.root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const included = (file) => /^(app|components|lib|supabase\/migrations|tests|scripts|types)\//.test(file) ||
    /^(proxy\.ts|package(?:-lock)?\.json|next\.config\.ts|tsconfig\.json)$/.test(file);
  const current = new Set(paths.filter(included));
  const captured = new Map(inventory.filter(({ file, sha256 }) => sha256 && included(file)).map(({ file, sha256 }) => [file, sha256]));
  const changes = [];
  for (const [file, hash] of captured) {
    const path = join(baseline.root, file);
    if (!existsSync(path)) changes.push({ file, change: 'removed since capture' });
    else if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) changes.push({ file, change: 'edited since capture' });
    current.delete(file);
  }
  for (const file of current) {
    if (file !== 'types/database.ts' && existsSync(join(baseline.root, file))) changes.push({ file, change: 'added since capture' });
  }
  writeFileSync(join(evidence, 'source-drift.json'), JSON.stringify(changes, null, 2) + '\n');
}
console.log(JSON.stringify({
  modules: modules.length, routes: routes.length, novemberRecords: catalogue.length,
  novemberDirectSourceIds: catalogue.filter(({ applicationRefs }) => applicationRefs.length > 0).length,
  novemberWithIdLabelledTestSources: catalogue.filter(({ testRefs }) => testRefs.length > 0).length,
  novemberWithIdLabelledOutcomes: catalogue.filter(({ cases }) => cases.length > 0).length,
  novemberIdLabelledCases: catalogue.reduce((n, { cases }) => n + cases.length, 0),
}));
