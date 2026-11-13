import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const evidence = dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync(process.env.EXOS_AUDIT_GIT || 'git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
const write = (file, data) => writeFileSync(join(evidence, file), `${JSON.stringify(data, null, 2)}\n`);
const sorted = (values) => [...new Set(values)].sort();
const counts = (values) => Object.fromEntries(sorted(values).map((name) => [name, values.filter((value) => value === name).length]));
const digest = (content) => createHash('sha256').update(content).digest('hex');
const sourcePattern = /\.(?:[cm]?[jt]sx?|sql|css|sh|ps1|toml|ya?ml)$/i;
const generatedPattern = /(?:^|\/)(?:\.next[^/]*|coverage|node_modules|\.worktrees|\.claude\/worktrees|test-results|playwright-report)(?:\/|$)|\.tsbuildinfo$|(?:^|\/)next-env\.d\.ts$|^supabase\/full_schema_complete\.sql$|^types\/database(?:\.generated)?\.ts$/;
const localMetadataPattern = /^(?:\.claude\/|\.env(?:\.|$)|\.vercel\/|\.codex[^/]*\/|supabase\/\.temp\/)|(?:^|\/)(?:credentials|secrets)\.[^/]+$|\.(?:log|pem|key)$/i;
const fileNames = sorted(git('ls-files', '-z', '-c', '-o', '--exclude-standard').split('\0').filter(Boolean));
const files = fileNames.filter((file) => !file.startsWith('audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/') && existsSync(join(root, file)));
const classify = (file) => {
  if (generatedPattern.test(file)) return 'generated';
  if (localMetadataPattern.test(file)) return 'local-metadata';
  if (/^(?:docs\/evidence\/|audit-output\/)/.test(file)) return 'prior-evidence';
  if (/^supabase\/migrations_archive\//.test(file)) return 'archived-migration';
  if (sourcePattern.test(file) || /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig\.json|vercel\.json)$/.test(file)) return 'source';
  if (/\.(?:md|txt)$/i.test(file)) return 'documentation';
  return 'asset';
};
const fileSet = new Set(files);
const baseline = {
  root,
  branch: git('branch', '--show-current'),
  head: git('rev-parse', 'HEAD'),
  releaseRefs: Object.fromEntries(['main', 'codex/v1', 'origin/main'].map((ref) => [ref, git('rev-parse', ref)])),
  worktrees: git('worktree', 'list', '--porcelain'),
  status: git('status', '--porcelain=v1', '--untracked-files=all').split(/\r?\n/).filter((line) => !line.includes('audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/')),
  fileKinds: counts(files.map(classify)),
  node: process.version,
};

const snapshot = process.env.EXOS_AUDIT_SNAPSHOT ? resolve(process.env.EXOS_AUDIT_SNAPSHOT) : null;
if (snapshot) {
  if (snapshot === root || existsSync(snapshot)) throw new Error('Supply a new, separate snapshot directory');
  mkdirSync(snapshot, { recursive: true });
}
const sourceFiles = [];
const imports = new Map();
const resolveImport = (from, specifier) => {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/') ? specifier.slice(2) : posix.normalize(posix.join(posix.dirname(from), specifier));
  return [base, ...['.ts', '.tsx', '.mjs', '.js', '.json', '/index.ts', '/index.tsx', '/index.mjs'].map((extension) => base + extension)].find((candidate) => fileSet.has(candidate)) ?? null;
};
for (const file of files) {
  const kind = classify(file);
  const path = join(root, file);
  const record = { file, kind, bytes: statSync(path).size };
  if (kind === 'source') {
    const content = readFileSync(path);
    record.sha256 = digest(content);
    record.lines = content.toString('utf8').split(/\r?\n/).length;
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      const body = content.toString('utf8');
      const imported = sorted([...body.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([.@][^"'\r\n]+)["']/g)].map((match) => resolveImport(file, match[1])).filter(Boolean));
      const objects = sorted([...body.matchAll(/\.(?:rpc|from)\s*\(\s*["']([a-z_][a-z_0-9]+)["']/gi)].map((match) => match[1]));
      imports.set(file, { imports: imported, literalDatabaseReferences: objects });
    }
  }
  sourceFiles.push(record);
  if (snapshot && (kind !== 'local-metadata' && !file.endsWith('.tsbuildinfo'))) {
    const destination = join(snapshot, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(path, destination);
  }
}
if (snapshot) {
  const drift = sourceFiles.filter(({ file, sha256 }) => sha256 && digest(readFileSync(join(snapshot, file))) !== sha256).map(({ file }) => file);
  if (drift.length) throw new Error(`Concurrent changes while copying: ${drift.join(', ')}`);
}

const routes = files.filter((file) => /^app\/(?:.*\/)?(?:page|route)\.[jt]sx?$/.test(file)).map((file) => {
  const parts = file.split('/').slice(1, -1);
  const routeParts = parts.filter((part) => !part.startsWith('(') && !part.startsWith('@'));
  const route = `/${routeParts.join('/')}`;
  const surface = routeParts[0] === 'api' ? 'api' : parts[0] === '(auth)' ? 'auth' : routeParts[0] === 'portal' ? 'portal' : 'app';
  const moduleName = surface === 'api' ? `api/${routeParts[1] ?? 'root'}` : surface === 'auth' ? 'auth' : routeParts[0] ?? 'home';
  const reachable = new Set();
  const expand = (path, depth) => {
    if (reachable.has(path) || depth > 3) return;
    reachable.add(path);
    for (const next of imports.get(path)?.imports ?? []) expand(next, depth + 1);
  };
  expand(file, 0);
  const body = readFileSync(join(root, file), 'utf8');
  return {
    route, file, surface, module: moduleName,
    methods: surface === 'api' ? sorted([...body.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1])) : [],
    components: sorted([...reachable].filter((path) => path.startsWith('components/'))),
    services: sorted([...reachable].filter((path) => path.startsWith('lib/'))),
    databaseReferences: sorted([...reachable].flatMap((path) => imports.get(path)?.literalDatabaseReferences ?? [])),
  };
});
const sqlFiles = files.filter((file) => /^supabase\/migrations\/[^/]+\.sql$/.test(file)).map((file) => {
  const objects = [];
  const expression = /\bcreate\s+(?:or\s+replace\s+)?(table|function|trigger|(?:materialized\s+)?view|policy|(?:unique\s+)?index)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi;
  const body = readFileSync(join(root, file), 'utf8');
  for (const match of body.matchAll(expression)) {
    objects.push({ kind: match[1].toLowerCase(), name: match[2].replaceAll('"', ''), line: body.slice(0, match.index).split('\n').length });
  }
  return { file, objects };
});
const objectOrigins = new Map();
for (const { file, objects } of sqlFiles) {
  for (const { name, line } of objects) {
    const key = name.split('.').at(-1);
    objectOrigins.set(key, [...(objectOrigins.get(key) ?? []), `${file}:${line}`]);
  }
}
const modules = sorted(routes.map(({ module }) => module)).map((name) => {
  const entries = routes.filter(({ module }) => module === name);
  const references = sorted(entries.flatMap(({ databaseReferences }) => databaseReferences));
  const token = name.split('/').at(-1);
  const tests = files.filter((file) => /^tests\//.test(file) && (file.includes(token) || file.includes(token.replace(/s$/, '') + '-')));
  return {
    module: name,
    routes: sorted(entries.map(({ route }) => route)),
    components: sorted(entries.flatMap(({ components }) => components)),
    services: sorted(entries.flatMap(({ services }) => services)),
    authorizationReferences: sorted(entries.flatMap(({ services }) => services.filter((path) => /auth|permission|access/.test(path)))),
    databaseObjects: Object.fromEntries(references.map((object) => [object, objectOrigins.get(object) ?? []])),
    testsByFileName: tests,
    verificationStatus: 'inventoried',
  };
});
const nov = readFileSync(join(root, 'NOV_UPGRADES.md'), 'utf8');
const batches = files.filter((file) => /^NOV_UPGRADE_BATCH_\d+\.md$/.test(file)).map((file) => ({ file, lines: readFileSync(join(root, file), 'utf8').split(/\r?\n/) }));
const featureIndex = [...nov.matchAll(/^### (NOV-\d{3}) - (.+)$/gm)].map((match) => {
  const [, id, title] = match;
  return {
    id, title: title.trim(), specification: `NOV_UPGRADES.md:${nov.slice(0, match.index).split('\n').length}`,
    batchReferences: batches.flatMap(({ file, lines }) => lines.flatMap((line, index) => line.includes(id) ? [`${file}:${index + 1}`] : [])),
  };
}).sort((a, b) => a.id.localeCompare(b.id));
const routeCounts = counts(routes.map(({ surface }) => surface));

write('baseline.json', baseline);
write('source-inventory.json', sourceFiles);
write('routes.json', routes);
write('module-inventory.json', modules);
write('sql-object-index.json', sqlFiles);
write('november-index.json', featureIndex);
write('dependency-index.json', Object.fromEntries(imports));
console.log(JSON.stringify({ snapshot, head: baseline.head, statusEntries: baseline.status.length, fileKinds: baseline.fileKinds, routes: routeCounts, modules: modules.length, migrations: sqlFiles.length, features: featureIndex.length }));
