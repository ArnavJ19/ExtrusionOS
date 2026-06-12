import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dealerConversionRoute = readFileSync(join(repoRoot, "app/api/dealer-orders/from-quote-order/route.ts"), "utf8");
const crmPage = readFileSync(join(repoRoot, "app/(dashboard)/crm/page.tsx"), "utf8");
const crmLeadRoute = readFileSync(join(repoRoot, "app/api/crm/leads/route.ts"), "utf8");
const barcodePage = readFileSync(join(repoRoot, "app/(dashboard)/barcode/page.tsx"), "utf8");
const qrRoute = readFileSync(join(repoRoot, "app/api/qr-codes/route.ts"), "utf8");

test("dealer quote-order conversion requires explicit dealer ownership proof", () => {
  assert.match(dealerConversionRoute, /const belongsToDealer = order\.dealer_id === context\.dealerId \|\| quote\?\.dealer_id === context\.dealerId/);
  assert.match(dealerConversionRoute, /const createdByDealerUser = order\.created_by === context\.userId \|\| quote\?\.created_by === context\.userId/);
  assert.match(dealerConversionRoute, /if \(!belongsToDealer && !createdByDealerUser\)/);
});

test("CRM lead creation is server-owned and browser payload does not include company_id", () => {
  assert.match(crmPage, /fetch\("\/api\/crm\/leads"/);
  assert.doesNotMatch(crmPage.slice(crmPage.indexOf("async function createLead")), /company_id\s*:/);
  assert.match(crmLeadRoute, /getSessionContext\(\)/);
  assert.match(crmLeadRoute, /company_id: context\.companyId/);
});

test("QR code creation is server-owned and validates scoped entity before insert", () => {
  assert.match(barcodePage, /fetch\("\/api\/qr-codes"/);
  assert.doesNotMatch(barcodePage.slice(barcodePage.indexOf("const response = await fetch(\"/api/qr-codes\"")), /company_id\s*:/);
  assert.match(qrRoute, /getSessionContext\(\)/);
  assert.match(qrRoute, /fetchQrEntityDetails\(supabase, parsed\.data\.entity_type, parsed\.data\.entity_id, context\.companyId\)/);
  assert.match(qrRoute, /company_id: context\.companyId/);
});
