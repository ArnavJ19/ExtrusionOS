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
const businessWorkflowMigration = readFileSync(join(repoRoot, "supabase/migrations/20260715000000_atomic_business_workflows.sql"), "utf8");
const scheduleIntegrityMigration = readFileSync(join(repoRoot, "supabase/migrations/20260723010000_production_schedule_integrity.sql"), "utf8");

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
  assert.doesNotMatch(productionAction, /company_id:\s*(context|input|parsed\.data)/);
  assert.match(productionAction, /\.eq\("company_id", context\.companyId\)/);
  assert.match(productionAction, /created_by:\s*currentJob\?\.created_by \?\? context\.userId/);
  assert.match(productionAction, /supabase\.rpc\("save_production_job_atomic"/);
  assert.match(businessWorkflowMigration, /v_company_id uuid := private\.get_current_user_company_id\(\)/);
  assert.match(businessWorkflowMigration, /jsonb_build_object\('company_id', v_company_id, 'order_id', v_order_id\)/);
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

test("press scheduling is atomic, non-overlapping, and releases the selected slot", () => {
  assert.match(productionAction, /supabase\.rpc\("save_production_schedule_slot_atomic"/);
  assert.match(productionAction, /supabase\.rpc\("release_production_schedule_slot_atomic"/);
  assert.doesNotMatch(productionAction, /\.from\("production_plan_slots"\)\.insert/);
  assert.match(scheduleGrid, /releaseJob\(slot\.id\)/);
  assert.match(scheduleGrid, /Planned end is required|both a start and end time/);
  assert.match(scheduleGrid, /!job\.machine_id/);
  assert.match(scheduleGrid, /formatBusinessDateTime\(slot\.planned_start_at\)/);
  assert.match(scheduleIntegrityMigration, /enforce_production_schedule_integrity/);
  assert.match(scheduleIntegrityMigration, /already has an active press slot/);
  assert.match(scheduleIntegrityMigration, /already has an overlapping active slot/);
  assert.match(scheduleIntegrityMigration, /pg_advisory_xact_lock/);
  assert.match(scheduleIntegrityMigration, /save_production_schedule_slot_atomic/);
  assert.match(scheduleIntegrityMigration, /release_production_schedule_slot_atomic/);
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
