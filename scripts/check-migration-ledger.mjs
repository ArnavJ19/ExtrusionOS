import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { reconcileMigrationLedger } from "../lib/deployment/migration-ledger.ts";

// This command uses local files only. It neither connects to nor mutates a database.
try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--ledger")) {
    throw new Error("Usage: check-migration-ledger.mjs [--ledger path-to-export.json]");
  }
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((file) => file.endsWith(".sql"));
  const snapshot = args.length === 2 ? JSON.parse(readFileSync(resolve(args[1]), "utf8")) : null;
  const report = reconcileMigrationLedger(files, snapshot);
  console.log(JSON.stringify({
    ...report,
    prerequisite_baseline: ["supabase/schema.sql", "supabase/rls.sql"],
    next_step: report.status === "ledger_matches"
      ? "Rehearse the complete reviewed chain in disposable staging and verify catalog, roles and workflows."
      : "Obtain the read-only ledger export and review collisions, names and prerequisite gaps before migration application."
  }, null, 2));
  if (report.status !== "ledger_matches") process.exitCode = 1;
} catch {
  console.error("Migration reconciliation unavailable. Use [--ledger path-to-export.json] with a valid metadata-only export. No data was written.");
  process.exitCode = 1;
}
