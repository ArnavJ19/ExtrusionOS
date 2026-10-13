import { createRequire } from "node:module";
import { checkHostedSchemaContract } from "../lib/deployment/schema-contract.ts";

if (!process.argv.includes("--hosted")) {
  console.error("Use --hosted to opt in to REST schema and zero-row GET checks. This script never writes data.");
  process.exitCode = 1;
} else {
  const require = createRequire(import.meta.url);
  require("@next/env").loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Database URL and API credential are required. No credential values are printed.");
    process.exitCode = 1;
  } else {
    try {
      const checks = await checkHostedSchemaContract(url, key, (endpoint, headers) => fetch(endpoint, {
        method: "GET", headers, signal: AbortSignal.timeout(15000), redirect: "error"
      }));
      console.log(JSON.stringify({ evidence: "REST API exposure only; no business rows read, no writes, no JWT/RLS or ledger verification", checks }, null, 2));
      if (checks.some((check) => check.status !== "verified")) process.exitCode = 1;
    } catch {
      console.error("Schema contract could not be checked. Verify the URL and network configuration.");
      process.exitCode = 1;
    }
  }
}
