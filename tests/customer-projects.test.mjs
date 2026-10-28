import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canManageProjects, canReadProjects, candidateSchema, describeLinkResults, linkResultSchema, projectCommandSchema, projectDetailSchema,
  projectDispatchShare, projectFieldsSchema, projectListSchema
} from "../lib/workflow/customer-projects.ts";
import { createCustomerProjectFixture, pids, pid } from "../scripts/lib/customer-project-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("roles: sales roles manage projects; planning, dispatch, accounts and viewers read; floor, quality and dealers neither", () => {
  for (const role of ["owner", "admin", "sales_manager", "sales"]) assert.ok(canManageProjects(role) && canReadProjects(role), role);
  for (const role of ["production_manager", "factory_manager", "dispatch_manager", "dispatch", "accounts", "viewer"]) assert.ok(!canManageProjects(role) && canReadProjects(role), role);
  for (const role of ["production", "quality", "inventory_manager", "dealer_admin", "dealer_staff"]) assert.ok(!canReadProjects(role), role);
});

test("project fields mirror the database: name length, PIN code, Indian mobile with spacing", () => {
  const ok = { name: "Tower B", pincode: "400026", contact_phone: "+91 98200 12345" };
  assert.equal(projectFieldsSchema.safeParse(ok).success, true);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, contact_phone: "9820012345" }).success, true);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, contact_phone: "5820012345" }).success, false, "Indian mobiles start 6-9");
  assert.equal(projectFieldsSchema.safeParse({ ...ok, pincode: "040026" }).success, false);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, pincode: "40002" }).success, false);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, name: "B" }).success, false);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, site_name: "x".repeat(121) }).success, false);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, notes: "a\u0007" }).success, false);
  assert.equal(projectFieldsSchema.safeParse({ ...ok, company_id: id }).success, false, "forged tenancy is rejected");
});

test("command schema restricts entity types, statuses, search length and requires an unlink reason", () => {
  assert.equal(projectCommandSchema.safeParse({ command: "project.link", project_id: id, entity_type: "invoice", entity_id: id }).success, false);
  assert.deepEqual(projectCommandSchema.parse({ command: "project.link", project_id: id, entity_type: "order", entity_id: id }).include_related, false);
  assert.equal(projectCommandSchema.safeParse({ command: "project.unlink", project_id: id, entity_type: "order", entity_id: id, reason: "  " }).success, false);
  assert.equal(projectCommandSchema.safeParse({ command: "project.update", project_id: id, expected_version: 1, status: "archived", name: "Tower" }).success, false);
  assert.equal(projectCommandSchema.safeParse({ command: "project.list", search: "x".repeat(81) }).success, false);
  assert.equal(projectCommandSchema.safeParse({ command: "project.create", request_id: id, customer_id: id, name: "Tower" }).success, true);
});

test("link outcomes are spelled out for every affected record", () => {
  const lines = describeLinkResults({ results: [
    { entity_type: "order", entity_id: id, outcome: "linked" },
    { entity_type: "quote", entity_id: id, outcome: "other_customer" },
    { entity_type: "dispatch", entity_id: id, outcome: "other_project" },
    { entity_type: "dispatch", entity_id: id, outcome: "already_linked" }
  ] });
  assert.deepEqual(lines, ["Order linked", "Quotation skipped: belongs to another customer", "Dispatch skipped: grouped under another project", "Dispatch already in this project"]);
});

test("dispatch share is bounded and unknown when nothing measurable is ordered", () => {
  assert.equal(projectDispatchShare({ ordered_kg: 2000, dispatched_kg: 600 }), 0.3);
  assert.equal(projectDispatchShare({ ordered_kg: 500, dispatched_kg: 900 }), 1);
  assert.equal(projectDispatchShare({ ordered_kg: 0, dispatched_kg: 10 }), null);
  assert.equal(projectDispatchShare({ ordered_kg: null, dispatched_kg: 10 }), null);
});

let f;
test.before(async () => { f = await createCustomerProjectFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database responses parse with the app's schemas for every read command", async () => {
  await f.create();
  linkResultSchema.parse(await f.link("order", pids.order, { include_related: true }));
  const detail = projectDetailSchema.parse(await f.command("project.load", { project_id: pid(5000) }));
  assert.equal(detail.orders.length, 1);
  const viewerDetail = projectDetailSchema.parse(await f.command("project.load", { project_id: pid(5000) }, pids.viewer));
  assert.equal(viewerDetail.totals.order_value, null);
  assert.equal(projectListSchema.parse(await f.command("project.list", { search: "tower" })).total_count, 1);
  candidateSchema.parse(await f.command("project.candidates", { project_id: pid(5000), entity_type: "dispatch", search: "" }));
});

test("pages and the action gate on role and dealer status and never pass a company from input", () => {
  const action = readFileSync("lib/actions/customer-projects.ts", "utf8");
  assert.match(action, /context\.dealerId \|\| !\(mutation \? canManageProjects\(context\.role\) : canReadProjects\(context\.role\)\)/);
  assert.doesNotMatch(action, /company_id/);
  for (const page of ["app/(dashboard)/customers/projects/page.tsx", "app/(dashboard)/customers/projects/[id]/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /context\.dealerId \|\| !canReadProjects\(context\.role\)/, page);
  }
  for (const page of ["app/(dashboard)/customers/projects/new/page.tsx", "app/(dashboard)/customers/projects/[id]/edit/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /context\.dealerId \|\| !canManageProjects\(context\.role\)/, page);
  }
  assert.match(readFileSync("lib/auth/route-permissions.ts", "utf8"), /prefix: "\/customers\/projects", roles: \[[^\]]*"dispatch", "accounts"/);
});
