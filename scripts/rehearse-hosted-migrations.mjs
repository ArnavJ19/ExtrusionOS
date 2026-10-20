import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const argumentsList = process.argv.slice(2);
const catalogIndex = argumentsList.indexOf("--catalog");
const catalogPath = catalogIndex < 0 ? new URL("../docs/evidence/schema-before_2026-10-20.json", import.meta.url) : argumentsList.splice(catalogIndex, 2)[1];
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const extras = JSON.parse(readFileSync(new URL("../docs/evidence/schema-extras-before_2026-10-20.json", import.meta.url), "utf8"));
const quote = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const relation = row => `${quote(row.schema)}.${quote(row.table ?? row.name)}`;
function splitStatements(sql) {
  const statements = [];
  let start = 0, index = 0, quoted = null, dollar = null, block = 0, line = false;
  while (index < sql.length) {
    const pair = sql.slice(index, index + 2), char = sql[index];
    if (line) { if (char === "\n") line = false; index++; continue; }
    if (block) { if (pair === "/*") { block++; index += 2; } else if (pair === "*/") { block--; index += 2; } else index++; continue; }
    if (dollar) { if (sql.startsWith(dollar, index)) { index += dollar.length; dollar = null; } else index++; continue; }
    if (quoted) { if (char === quoted) { if (sql[index + 1] === quoted) index += 2; else { quoted = null; index++; } } else index++; continue; }
    if (pair === "--") { line = true; index += 2; continue; }
    if (pair === "/*") { block = 1; index += 2; continue; }
    if (char === "'" || char === '"') { quoted = char; index++; continue; }
    if (char === "$") { const tag = sql.slice(index).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0]; if (tag) { dollar = tag; index += tag.length; continue; } }
    if (char === ";") { statements.push(sql.slice(start, index + 1)); start = index + 1; }
    index++;
  }
  if (quoted || dollar || block) throw new Error("Unclosed SQL literal or comment");
  if (sql.slice(start).trim()) statements.push(sql.slice(start));
  return statements;
}
if (process.argv.includes("--preflight-statements")) {
  const source = readFileSync(new URL("../sql/audit-deployment-preflight.sql", import.meta.url), "utf8");
  console.log(JSON.stringify(splitStatements(source).filter(statement => statement.replace(/--[^\n]*/g, "").trim())));
  process.exit(0);
}
const db = new PGlite();
let phase = "initialization";
try {
  for (const role of extras.roles.filter(name => !name.startsWith("pg_") && name !== "postgres")) {
    await db.exec(`create role ${quote(role)};`);
  }
  await db.exec(`create schema auth; create schema private; create schema storage;
    create table auth.users(id uuid primary key);
    set check_function_bodies=off;`);
  for (const type of extras.enums) {
    await db.exec(`create type ${quote(type.schema)}.${quote(type.name)} as enum (${type.values.map(literal).join(",")});`);
  }
  for (const helper of extras.nonbusiness_helpers) await db.exec(helper.definition);
  phase = "tables";
  for (const table of catalog.tables.filter(t => ["r", "p"].includes(t.kind))) {
    const columns = catalog.columns.filter(c => c.schema === table.schema && c.table === table.name);
    const fields = columns.map(c => `${quote(c.name)} ${c.type}${c.generated ? ` generated always as (${c.default}) stored` : c.default ? ` default ${c.default}` : ""}${c.not_null ? " not null" : ""}`);
    await db.exec(`create table ${relation(table)} (${fields.join(",")});`);
    if (table.rls) await db.exec(`alter table ${relation(table)} enable row level security;`);
  }
  phase = "functions";
  for (const fn of catalog.functions) await db.exec(fn.definition);
  phase = "constraints";
  for (const constraint of catalog.constraints.filter(c => !["f", "t"].includes(c.type))) {
    phase = `constraint ${constraint.schema}.${constraint.table}.${constraint.name}: ${constraint.definition}`;
    await db.exec(`alter table ${relation(constraint)} add constraint ${quote(constraint.name)} ${constraint.definition};`);
  }
  for (const constraint of catalog.constraints.filter(c => c.type === "f")) {
    phase = `constraint ${constraint.schema}.${constraint.table}.${constraint.name}: ${constraint.definition}`;
    await db.exec(`alter table ${relation(constraint)} add constraint ${quote(constraint.name)} ${constraint.definition};`);
  }
  phase = "indexes";
  for (const index of catalog.indexes) {
    const exists = (await db.query("select to_regclass($1) as id", [`${index.schema}.${index.name}`])).rows[0].id;
    if (!exists) await db.exec(index.definition);
  }
  phase = "views";
  for (const view of catalog.views) await db.exec(`create view ${relation(view)} with (security_invoker=true) as ${view.definition}`);
  phase = "policies";
  for (const policy of catalog.policies) {
    await db.exec(`create policy ${quote(policy.policyname)} on ${quote(policy.schemaname)}.${quote(policy.tablename)} as ${policy.permissive} for ${policy.cmd} to ${policy.roles.map(role => role === "public" ? "PUBLIC" : quote(role)).join(",")}${policy.qual ? ` using (${policy.qual})` : ""}${policy.with_check ? ` with check (${policy.with_check})` : ""};`);
  }
  phase = "triggers";
  for (const trigger of catalog.triggers.filter(t => t.schema !== "storage")) {
    await db.exec(`${trigger.definition};`);
    if (trigger.enabled === "D") await db.exec(`alter table ${relation(trigger)} disable trigger ${quote(trigger.name)};`);
  }
  phase = "grants";
  for (const grant of extras.privileges) {
    await db.exec(`grant ${grant.privilege} on ${relation(grant)} to ${grant.grantee === "PUBLIC" ? "PUBLIC" : quote(grant.grantee)}${grant.grantable ? " with grant option" : ""};`);
  }
  await db.exec("set check_function_bodies=on;");
  console.log(JSON.stringify({ phase: "restored empty hosted catalog", tables: catalog.tables.length, functions: catalog.functions.length, policies: catalog.policies.length,
    limitation: "No business/auth rows, hosted extensions, real JWTs, storage internals or independent sessions are copied. Function ACLs are verified separately on the hosted database." }));
  for (const file of argumentsList) {
    if (!/^\d+_[a-zA-Z0-9_]+\.sql$/.test(file)) throw new Error("Pass exact migration basenames only");
    phase = file;
    const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    let currentStatement = "";
    try {
      for (const statement of splitStatements(sql)) { currentStatement = statement; await db.exec(statement); }
      console.log(JSON.stringify({ file, result: "passed empty-catalog replay" }));
    }
    catch (error) {
      console.error(JSON.stringify({ file, statement: currentStatement.trim().slice(0, 300), position: error.position, detail: error.detail, hint: error.hint }));
      throw new Error(`${file}: ${error.message}${error.where ? ` (${error.where})` : ""}`, { cause: error });
    }
  }
} catch (error) {
  console.error(JSON.stringify({ phase, error: error.message, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally {
  await db.close();
}
