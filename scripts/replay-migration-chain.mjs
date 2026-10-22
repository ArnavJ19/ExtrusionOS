import { replayMigrationChain } from "./lib/migration-chain-replay.mjs";

// Usage: node scripts/replay-migration-chain.mjs [--continue]
// Rebuilds an in-memory database from the baseline and every migration in order. Never connects to Supabase.
const { db, files, applied, failures } = await replayMigrationChain({ stopOnFailure: !process.argv.includes("--continue") });
for (const failure of failures) console.log(`FAIL ${failure.file}\n  ${failure.message}${failure.detail ? `\n  detail: ${failure.detail}` : ""}`);
console.log(`applied ${applied}/${files.length} files; failures: ${failures.length}`);
await db.close();
if (failures.length) process.exitCode = 1;
