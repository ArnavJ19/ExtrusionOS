import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("../supabase/migrations/", import.meta.url);
const catalogArgument = process.argv.indexOf("--catalog");
const catalog = JSON.parse(readFileSync(catalogArgument < 0 ? new URL("../docs/evidence/schema-before_2026-10-20.json", import.meta.url) : process.argv[catalogArgument + 1], "utf8"));
const sources = readdirSync(directory).filter(name => name.endsWith(".sql")).sort()
  .map(file => ({ file, sql: readFileSync(new URL(file, directory), "utf8").replaceAll("\r\n", "\n") }));

// Ignore formatting/comments while preserving quoted SQL values and identifiers.
function canonical(source) {
  const tokens = source.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s'"/\-]+|./g) ?? [];
  return tokens.filter(token => !/^\s+$|^--|^\/\*/.test(token))
    .map(token => /^["']/.test(token) ? token : token.toLowerCase()).join(" ");
}

const definitions = [];
for (const { file, sql } of sources) {
  const pattern = /create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.\w+)\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const tail = sql.slice(match.index);
    const bodyStart = tail.match(/\bas\s+(\$(?:[A-Za-z_]\w*)?\$)/i);
    if (!bodyStart) continue;
    const start = bodyStart.index + bodyStart[0].length;
    const end = tail.indexOf(bodyStart[1], start);
    if (end < 0) throw new Error(`Unclosed SQL function: ${file}: ${match[1]}`);
    definitions.push({ file, name: match[1].toLowerCase(), source: tail.slice(start, end) });
  }
}
const live = catalog.functions.map(fn => {
  const name = `${fn.schema}.${fn.name}`;
  const candidates = definitions.filter(def => def.name === name);
  const matches = candidates.filter(def => canonical(def.source) === canonical(fn.source));
  return { name, args: fn.identity_args, latest_local_definition: candidates.at(-1)?.file ?? null,
    last_matching_local_body: matches.at(-1)?.file ?? null,
    latest_body_matches: candidates.length > 0 && canonical(candidates.at(-1).source) === canonical(fn.source),
    authenticated_execute: fn.authenticated_execute, anon_execute: fn.anon_execute };
});

const files = sources.map(({ file, sql }) => {
  const functions = definitions.filter(def => def.file === file).map(def => {
    const candidates = catalog.functions.filter(fn => `${fn.schema}.${fn.name}` === def.name);
    return { name: def.name, present: candidates.length > 0,
      body_matches: candidates.some(fn => canonical(fn.source) === canonical(def.source)),
      superseded_locally: definitions.filter(other => other.name === def.name).at(-1)?.file !== file };
  });
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public|private)\.\w+)/gi)]
    .map(([, name]) => ({ name, present: catalog.tables.some(t => `${t.schema}.${t.name}` === name) }));
  const columns = [];
  for (const [, table, body] of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+([\s\S]*?);/gi)) {
    for (const [, name] of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_]\w*)/gi)) {
      columns.push({ table, name, present: catalog.columns.some(c => c.schema === "public" && c.table === table && c.name === name) });
    }
  }
  return { file, tables, columns, functions,
    missing_tables: tables.filter(t => !t.present).map(t => t.name),
    missing_columns: columns.filter(c => !c.present).map(c => `${c.table}.${c.name}`),
    missing_functions: functions.filter(f => !f.present).map(f => f.name),
    different_function_bodies: functions.filter(f => f.present && !f.body_matches && !f.superseded_locally).map(f => f.name) };
});

const full = process.argv.includes("--full");
console.log(JSON.stringify({ evidence: "Static object/body comparison only; constraints, policies, grants, data changes and dynamic SQL require separate review.",
  files: full ? files : files.map(({ file, missing_tables, missing_columns, missing_functions, different_function_bodies }) => ({ file, missing_tables, missing_columns, missing_functions, different_function_bodies })),
  live_functions: full ? live : live.filter(fn => !fn.latest_body_matches) }, null, 2));
