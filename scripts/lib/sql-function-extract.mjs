import { readFileSync } from "node:fs";

/**
 * Returns the last `create [or replace] function <name>(` statement in a migration file, so a
 * test fixture can install the real, current definition of a guard instead of a hand-written copy.
 */
export function extractSqlFunction(file, qualifiedName) {
  const sql = readFileSync(file, "utf8");
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\(`, "gi");
  let start = -1;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) start = match.index;
  if (start < 0) throw new Error(`${qualifiedName} not found in ${file}`);
  const tagMatch = /\$[A-Za-z_]*\$/.exec(sql.slice(start));
  if (!tagMatch) throw new Error(`No dollar-quoted body for ${qualifiedName}`);
  const bodyStart = start + tagMatch.index + tagMatch[0].length;
  const bodyEnd = sql.indexOf(tagMatch[0], bodyStart);
  const statementEnd = sql.indexOf(";", bodyEnd + tagMatch[0].length);
  if (bodyEnd < 0 || statementEnd < 0) throw new Error(`Unterminated body for ${qualifiedName}`);
  return sql.slice(start, statementEnd + 1);
}
