import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const recordForm = readFileSync(join(repoRoot, "components/modules/operations/record-form-client.tsx"), "utf8");
const moduleConfig = readFileSync(join(repoRoot, "components/modules/operations/module-config.ts"), "utf8");
const quotesClient = readFileSync(join(repoRoot, "components/modules/quotes-client.tsx"), "utf8");
const inventoryPage = readFileSync(join(repoRoot, "app/(dashboard)/inventory/page.tsx"), "utf8");
const dealerInventoryClient = readFileSync(join(repoRoot, "components/modules/dealer-inventory-entry-client.tsx"), "utf8");

test("shared operation lookups use bounded tenant-scoped remote search", () => {
  assert.doesNotMatch(recordForm, /\.limit\(250\)/);
  assert.match(recordForm, /\.eq\("company_id", context\.companyId\)/);
  assert.match(recordForm, /searchRequest = searchRequest\.or\(/);
  assert.match(recordForm, /\.limit\(40\)/);
  assert.match(recordForm, /onSearchChange={field\.lookup \? \(query\) => searchLookup\(field, query\)/);
  assert.match(recordForm, /searching={Boolean\(field\.lookup && lookupSearching\[field\.name\]\)}/);
});

test("shared lookups preserve saved values and apply profile-compatible die search", () => {
  assert.match(recordForm, /\.eq\("company_id", context\.companyId\)\.eq\("id", selectedValue\)\.limit\(1\)/);
  assert.match(recordForm, /toLookupOptions\(\[\.\.\.\(selectedResult\.data \?\? \[\]\), \.\.\.\(result\.data \?\? \[\]\)\]/);
  assert.match(recordForm, /lookup\.table === "dies"/);
  assert.match(recordForm, /request = request\.eq\("profile_id", profileId\)/);
  assert.match(moduleConfig, /searchFields: \["customer_name", "company_name", "gst_number"\]/);
  assert.match(moduleConfig, /searchFields: \["profile_code", "profile_name", "alloy", "temper"\]/);
  assert.match(moduleConfig, /searchFields: \["die_number", "rack_location"\]/);
});

test("quotation customer, profile, and die libraries are searched instead of fully downloaded", () => {
  assert.match(quotesClient, /from\("customers"\)[\s\S]*?\.limit\(40\)/);
  assert.match(quotesClient, /from\("aluminium_profiles"\)[\s\S]*?\.limit\(40\)/);
  assert.match(quotesClient, /from\("dies"\)[\s\S]*?\.limit\(40\)/);
  assert.match(quotesClient, /function searchProfiles\(query/);
  assert.match(quotesClient, /function searchDies\(query/);
  assert.match(quotesClient, /\.in\("id", profileIds\)/);
  assert.match(quotesClient, /\.in\("id", dieIds\)/);
  assert.match(quotesClient, /disabled={!item\.profile_id}/);
});

test("dealer inventory profile entry cannot hide profiles beyond a fixed 500-row list", () => {
  assert.doesNotMatch(inventoryPage, /aluminium_profiles[\s\S]*?\.limit\(500\)/);
  assert.match(inventoryPage, /<DealerInventoryEntryClient companyId={context\.companyId}/);
  assert.match(dealerInventoryClient, /from\("aluminium_profiles"\)/);
  assert.match(dealerInventoryClient, /\.eq\("company_id", companyId\)/);
  assert.match(dealerInventoryClient, /\.or\(`profile_code\.ilike/);
  assert.match(dealerInventoryClient, /\.limit\(30\)/);
  assert.match(dealerInventoryClient, /onSearchChange={setProfileSearch}/);
});
