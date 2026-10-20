// Audit harness: rebuilds the read-only catalog captured from the hosted
// ExtrusionOS database (tables, functions, constraints, triggers, views) inside an
// in-memory PGlite instance so business-logic reproductions run against the
// exact live trigger/function bodies without touching any hosted data.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const here = (name, dir = ".") => new URL(`./${dir}/${name}`, import.meta.url);

export async function createLiveCatalogDb({ verbose = false, migrations = [], dir = "." } = {}) {
  // dir selects a catalog snapshot folder (default: the 20 Oct pre-remediation capture).
  const catalog = JSON.parse(readFileSync(here("catalog.json", dir), "utf8"));
  const functionSource = readFileSync(here("live_functions.sql", dir), "utf8");
  const constraintSource = readFileSync(here("live_constraints.txt", dir), "utf8");
  const db = new PGlite();
  const failures = [];
  const run = async (label, sql) => {
    try { await db.exec(sql); } catch (error) { failures.push(`${label}: ${error.message}`); }
  };

  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema extensions; create schema storage;
    create table auth.users (id uuid primary key, email text);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('audit.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    set check_function_bodies = off;
  `);

  for (const statement of catalog.enums ?? []) await run("enum", `${statement};`);

  const tables = new Map();
  for (const column of catalog.columns) {
    const key = `${column.s}.${column.t}`;
    if (!tables.has(key)) tables.set(key, []);
    tables.get(key).push(column);
  }
  for (const [key, columns] of tables) {
    const [schema, table] = key.split(".");
    const body = columns.map((column) => {
      const generated = column.gen === "s" ? ` generated always as (${column.def}) stored` : (column.def ? ` default ${column.def}` : "");
      return `"${column.c}" ${column.type}${generated}${column.nn ? " not null" : ""}`;
    }).join(",\n");
    await run(`table ${key}`, `create table "${schema}"."${table}" (${body});`);
  }

  // Functions: each "-- FN" block is a complete CREATE OR REPLACE statement.
  const blocks = functionSource.split(/^-- FN [^\n]+\n/m).map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) await run(`function ${block.slice(0, 90)}`, `${block};`);

  for (const statement of [...(catalog.pubcons ?? []), ...(catalog.privcons ?? [])]) await run("constraint", `${statement};`);
  for (const statement of catalog.indexes ?? []) await run("index", `${statement};`);
  for (const line of constraintSource.split(/\r?\n/)) {
    const match = line.match(/^CON ([a-z0-9_]+)\.([a-z0-9_]+) \[f\] (.*)$/);
    if (match) await run(`fk ${match[1]}.${match[2]}`, `alter table public."${match[1]}" add constraint "${match[2]}" ${match[3]};`);
  }
  for (const view of catalog.views ?? []) await run(`view ${view.v}`, `create view "${view.s}"."${view.v}" as ${view.def}`);
  for (const statement of catalog.triggers ?? []) await run("trigger", `${statement};`);

  // Live RLS, policies, table grants and function EXECUTE grants for the
  // authenticated role, so "set role authenticated" mimics a PostgREST caller.
  const security = JSON.parse(readFileSync(here("security.json", dir), "utf8"));
  await run("revoke", `revoke execute on all functions in schema public, private from public;`);
  for (const statement of security.schemagrants ?? []) await run("schema grant", `${statement};`);
  for (const statement of security.rls ?? []) await run("rls", `${statement};`);
  for (const statement of security.policies ?? []) await run("policy", `${statement};`);
  for (const statement of security.grants ?? []) await run("grant", `${statement};`);
  for (const statement of security.fngrants ?? []) await run("fn grant", `${statement};`);
  await run("auth grants", `grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`);

  // Candidate migrations (repo paths) applied on top of the live snapshot, in order.
  // Unlike catalog statements these must apply cleanly, so a failure is thrown.
  for (const file of migrations) {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    await db.exec(source);
  }

  if (verbose && failures.length) console.error(`[harness] ${failures.length} catalog statements failed:\n${failures.slice(0, 40).join("\n")}`);
  return { db, failures };
}

export async function as(db, userId) {
  await db.exec(`select set_config('audit.uid', '${userId ?? ""}', false);`);
}
