import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { calculateSystemConfigurationProject } from "./lib/systems-configurator/actions.ts";

async function run() {
  try {
    const result = await calculateSystemConfigurationProject("881904e2-a7c3-49d5-934e-53307a309308", "60368a58-cf93-4b4d-ab72-4d5f83931994");
    console.log("Result:", result.costingSummary);
  } catch (e) {
    console.error(e);
  }
}
run();
