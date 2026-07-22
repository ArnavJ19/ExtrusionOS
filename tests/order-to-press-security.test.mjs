import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasRouteAccess, isProtectedPath } from "../lib/auth/route-permissions.ts";

const repoRoot = process.cwd();
const productionAction = readFileSync(join(repoRoot, "lib/actions/production.ts"), "utf8");
const productionClient = readFileSync(join(repoRoot, "components/modules/production-client.tsx"), "utf8");
const billetAllocationClient = readFileSync(join(repoRoot, "components/modules/foundry/billet-allocation-client.tsx"), "utf8");
const moduleConfig = readFileSync(join(repoRoot, "components/modules/operations/module-config.ts"), "utf8");
const schedulePage = readFileSync(join(repoRoot, "app/(dashboard)/production/schedule/page.tsx"), "utf8");
const scheduleGrid = readFileSync(join(repoRoot, "components/modules/production-planning/press-schedule-grid.tsx"), "utf8");
const migration = readFileSync(join(repoRoot, "supabase/migrations/0058_production_plan_slots.sql"), "utf8");

const routePages = {
  orders: readFileSync(join(repoRoot, "app/(dashboard)/orders/page.tsx"), "utf8"),
  production: readFileSync(join(repoRoot, "app/(dashboard)/production/page.tsx"), "utf8"),
  foundry: readFileSync(join(repoRoot, "app/(dashboard)/foundry/page.tsx"), "utf8"),
  machines: readFileSync(join(repoRoot, "app/(dashboard)/machines/page.tsx"), "utf8")
};

test("production scheduling action names stay tied to the order-to-press workflow", () => {
  assert.match(moduleConfig, /production:\s*{[\s\S]*primaryAction:\s*"Plan Job"/);
  assert.match(productionAction, /export async function saveProductionScheduleSlotAction/);
  assert.match(productionAction, /export async function assignProductionJobToPressAction/);
  assert.match(productionAction, /export async function releaseProductionJobToPressAction/);
  assert.match(scheduleGrid, /assignProductionJobToPressAction/);
  assert.match(scheduleGrid, /releaseProductionJobToPressAction/);
  assert.match(schedulePage, /PressScheduleGrid/);
  assert.match(productionClient, /<Button onClick={openForm}>Plan New Job<\/Button>/);
  assert.match(productionClient, /saving \? "Saving\.\.\." : "Create Job"/);
  assert.match(productionClient, /toast\.success\("Production job planned"\)/);
  assert.match(productionClient, /updateJobStatus\(job\.id, "ready"\)}>Mark Ready<\/Button>/);
  assert.match(productionClient, /updateJobStatus\(job\.id, "in_progress"\)}>Start<\/Button>/);
  assert.match(productionClient, /updateJobStatus\(job\.id, "completed"\)}>Complete<\/Button>/);
  assert.match(productionClient, /updateJobStatus\(job\.id, "on_hold"\)}>Hold<\/Button>/);
  assert.match(productionClient, /updateJobStatus\(job\.id, "in_progress"\)}>Resume<\/Button>/);
});

test("production job writes derive company ownership on the server", () => {
  const createJob = productionClient.slice(productionClient.indexOf("async function createJob"));
  assert.doesNotMatch(createJob, /company_id\s*:/);

  assert.match(productionAction, /const context = await getSessionContext\(\)/);
  assert.match(productionAction, /company_id:\s*context\.companyId/);
  assert.match(productionAction, /\.eq\("company_id", context\.companyId\)/);
  assert.doesNotMatch(productionAction, /company_id:\s*(input|parsed\.data)\.company_id/);
  assert.match(productionAction, /created_by:\s*currentJob\?\.created_by \?\? context\.userId/);
  assert.match(productionAction, /supabase\.rpc\("save_production_job_atomic"/);
  assert.doesNotMatch(productionAction, /\.from\("production_jobs"\)\.update\(payload\)/);
});

test("production scheduling validates scoped order, profile, die, and billet references", () => {
  assert.match(productionAction, /Production cannot be scheduled because no active die exists for this order\/profile/);
  assert.match(productionAction, /supabase\.from\("orders"\)\.select\("id[^"]*"\)\.eq\("company_id", context\.companyId\)\.eq\("id", parsed\.data\.order_id\)/);
  assert.match(productionAction, /supabase\.from\("aluminium_profiles"\)\.select\("id[^"]*"\)\.eq\("company_id", context\.companyId\)\.eq\("id", parsed\.data\.profile_id\)/);
  assert.match(productionAction, /supabase\.from\("dies"\)\.select\("id, profile_id, die_status"\)\.eq\("company_id", context\.companyId\)\.eq\("id", parsed\.data\.die_id\)/);
  assert.match(productionAction, /validateMachineForPlanning/);
  assert.match(productionAction, /machine_type !== "extrusion_press"/);
  assert.match(productionAction, /Selected extrusion press is not available for planning/);
  assert.match(productionAction, /Selected die does not match this profile\./);
  assert.match(productionAction, /"inactive", "dead", "blocked", "retired", "scrapped", "under_maintenance"/);
  assert.match(productionAction, /Die is \$\{String\(dieResult\.data\.die_status\)\.replace\(\/_\/g, " "\)\} and cannot be used for production\./);
  assert.match(productionAction, /Select at least one allocated billet for this production job/);
  assert.match(productionAction, /validateSelectedBillets/);
  assert.match(productionAction, /\.from\("foundry_billets"\)[\s\S]*\.eq\("company_id", companyId\)[\s\S]*\.in\("id", selectedBilletIds\)/);
  assert.match(productionAction, /Selected billets must be allocated to this order, compatible with its alloy\/diameter requirement, and not issued to another job/);
});

test("press schedule table and billet allocation use server-owned guarded interfaces", () => {
  assert.match(migration, /create table if not exists public\.production_plan_slots/);
  assert.match(migration, /company_id uuid not null references public\.companies/);
  assert.match(migration, /alter table public\.production_plan_slots enable row level security/);
  assert.match(migration, /public\.get_current_user_company_id\(\)/);
  assert.match(migration, /validate_production_plan_slot_tenant/);
  assert.match(productionAction, /supabase\.rpc\("allocate_billet_to_order"/);
  assert.match(productionAction, /supabase\.rpc\("reallocate_billet_to_order"/);
  assert.match(billetAllocationClient, /allocateBilletToOrderAction/);
  assert.match(billetAllocationClient, /reallocateBilletToOrderAction/);
  assert.doesNotMatch(billetAllocationClient, /\.rpc\("allocate_billet_to_order"/);
});

test("production form lookups for machine, die, order, and profile are tenant scoped", () => {
  const loadFormData = productionClient.slice(productionClient.indexOf("async function loadFormData"));
  assert.match(loadFormData, /supabase\.from\("orders"\)[\s\S]*\.eq\("company_id", context\.companyId\)/);
  assert.match(loadFormData, /supabase\.from\("aluminium_profiles"\)[\s\S]*\.eq\("company_id", context\.companyId\)[\s\S]*\.eq\("is_active", true\)/);
  assert.match(loadFormData, /supabase\.from\("machines"\)[\s\S]*\.eq\("company_id", context\.companyId\)/);
  assert.match(loadFormData, /supabase\.from\("dies"\)[\s\S]*\.eq\("company_id", context\.companyId\)[\s\S]*\.eq\("die_status", "active"\)/);
});

test("order-to-press routes are protected and backed by page-level permissions", () => {
  for (const path of ["/orders", "/production", "/foundry", "/machines"]) {
    assert.equal(isProtectedPath(path), true);
    assert.equal(hasRouteAccess(path, "owner"), true);
    assert.equal(hasRouteAccess(path, "dealer_admin"), false);
    assert.equal(hasRouteAccess(path, "dealer_staff"), false);
  }

  assert.match(routePages.orders, /if \(!can\(context\.role, "read", "orders"\)\) redirect\("\/dashboard"\)/);
  assert.match(routePages.production, /if \(!can\(context\.role, "read", "production"\)\) redirect\("\/dashboard"\)/);
  assert.match(routePages.foundry, /if \(!can\(context\.role, "read", "foundry"\)\) redirect\("\/dashboard"\)/);
  assert.match(routePages.machines, /if \(!can\(context\.role, "read", "machine_maintenance"\)\) redirect\("\/dashboard"\)/);
});
