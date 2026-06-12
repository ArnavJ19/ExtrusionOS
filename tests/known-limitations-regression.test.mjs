import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const automationClient = readFileSync(join(repoRoot, "components/modules/automation-client.tsx"), "utf8");
const whatsappPage = readFileSync(join(repoRoot, "app/(dashboard)/communications/whatsapp/page.tsx"), "utf8");
const energyPage = readFileSync(join(repoRoot, "app/(dashboard)/energy/page.tsx"), "utf8");

test("automation toggle updates are tenant-scoped", () => {
  const toggleRule = automationClient.slice(automationClient.indexOf("async function toggleRule"));
  assert.match(toggleRule, /\.eq\("id", rule\.id\)[\s\S]*\.eq\("company_id", companyId\)/);
});

test("WhatsApp campaign registry does not create fake active automation", () => {
  assert.match(whatsappPage, /Campaign Registry/);
  assert.match(whatsappPage, /campaign execution is not enabled/i);
  assert.match(whatsappPage, /is_active:\s*false/);
  assert.doesNotMatch(whatsappPage, /Automated Campaigns/);
});

test("energy page validates non-negative numbers and avoids optimistic rate saves", () => {
  assert.match(energyPage, /const requireNonNegative/);
  assert.match(energyPage, /requireNonNegative\(fOpen, "Opening reading"\)/);
  assert.match(energyPage, /requireNonNegative\(fRate, "Rate per unit"\)/);
  assert.match(energyPage, /requireNonNegative\(fProd, "Production kg"\)/);
  assert.match(energyPage, /if \(error\) throw error;[\s\S]*setReadings/);
});
