import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("../../supabase/migrations/", import.meta.url);
export function historicalColumns(before) {
  const sources = [readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8"),
    ...readdirSync(directory).filter(name => name.endsWith(".sql") && name < before).sort()
      .map(name => readFileSync(new URL(name, directory), "utf8"))];
  const tables = new Map();
  const add = (table, column, type) => {
    const columns = tables.get(table) ?? new Map();
    if (!columns.has(column)) columns.set(column, type);
    tables.set(table, columns);
  };
  for (const source of sources) {
    for (const [, table, body] of source.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      for (const line of body.split(/\r?\n/)) {
        const column = line.match(/^\s*([a-z_]\w*)\s+((?:public\.)?[a-z_]\w*(?:\s*\([^)]*\))?(?:\[\])?)/i);
        if (column && !/^(primary|unique|check|foreign|constraint|exclude)$/i.test(column[1])) add(table.toLowerCase(), column[1].toLowerCase(), column[2].toLowerCase());
      }
    }
    for (const [, table, body] of source.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+([\s\S]*?);/gi)) {
      for (const [, column, type] of body.matchAll(/add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_]\w*)\s+((?:public\.)?[a-z_]\w*(?:\s*\([^)]*\))?(?:\[\])?)/gi)) add(table.toLowerCase(), column.toLowerCase(), type.toLowerCase());
    }
    const hosts = [...source.matchAll(/foreach\s+host_table\s+in\s+array\s+array\[([\s\S]*?)\]/gi)]
      .flatMap(([, body]) => [...body.matchAll(/'([a-z_]\w*)'/gi)].map(match => match[1]));
    for (const [, column, type] of source.matchAll(/alter\s+table\s+public\.%I\s+add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_]\w*)\s+([a-z_]\w*(?:\s*\([^)]*\))?)/gi)) {
      for (const table of hosts) add(table, column.toLowerCase(), type.toLowerCase());
    }
  }
  return tables;
}

// These fixtures retain historical column names and numeric precision. Foreign
// tables, enum catalogs and unrelated triggers are outside this isolated proof.
export async function createHistoricalTables(db, names, before) {
  const definitions = historicalColumns(before);
  for (const name of names) {
    const columns = definitions.get(name);
    assert.ok(columns?.size, `No historical DDL for ${name}`);
    const fields = [...columns].map(([column, original]) => {
      const type = /^(uuid|bool|json|numeric|decimal|int|smallint|bigint|real|double|float|timestamp|timestamptz|date|time|text|varchar)/.test(original) ? original : "text";
      const extra = column === "id" ? " primary key default gen_random_uuid()"
        : ["created_at", "updated_at"].includes(column) ? " default now()" : column === "is_active" ? " default true" : "";
      return `"${column}" ${type}${extra}`;
    });
    await db.exec(`create table public."${name}" (${fields.join(",")});`);
  }
}

export function sqlDefinition(file, name) {
  const text = readFileSync(new URL(file, directory), "utf8").replaceAll("\r\n", "\n");
  const start = text.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `${file}: ${name}`);
  const body = text.indexOf("$$", start);
  const end = text.indexOf("$$;", body + 2);
  assert.ok(end > body, name);
  return text.slice(start, end + 3);
}
