# PCDA Technical Enrichment — Tasks Completed

## Summary

**Spec:** `.kiro/specs/pcda-technical-enrichment/`  
**Total tasks:** 108 leaf tasks  
**Completed:** 17 tasks (Phase 1: Core Data Model & Calculations + Master Data Tables)  
**Remaining:** 91 tasks  
**All tests passing:** 94 property-based tests, zero TypeScript errors  

---

## Phase 1: Core Data Model & Calculations ✅

### Task 1: Set up PCDA core types and interfaces ✅

| Task | File | Status |
|------|------|--------|
| 1.1 Create `/lib/pcda/types.ts` with `TechnicalLineItem` interface | `lib/pcda/types.ts` | ✅ |
| 1.2 Create field set constant and tab assignment map | `lib/pcda/field-map.ts` | ✅ |
| 1.3 Write property test for field set and tab partition identity | `tests/pcda-field-set-partition.test.mjs` | ✅ |

**What was built:**
- `TechnicalLineItem` interface with 64 fields covering identity, Basic, Technical, Commercial, Costing, and internal-only tabs
- `QtyMethod` type alias (`"length_weight_qty" | "theoretical" | "actual"`)
- `SourceRef` interface for line reuse tracking
- `DrawingApprovalStatus` type, `Tab` type, `TABS` constant
- `TECHNICAL_LINE_ITEM_FIELDS` readonly array (64 fields)
- `FIELD_TAB` map assigning every field to exactly one of 8 tabs
- Property 13 test (7 sub-tests) verifying field set/tab partition identity

---

### Task 2: Implement Calculation Library core ✅

| Task | File | Status |
|------|------|--------|
| 2.1 Create `/lib/calculations/pcda/sentinel.ts` | `lib/calculations/pcda/sentinel.ts` | ✅ |
| 2.2 Create `/lib/calculations/pcda/rounding.ts` | `lib/calculations/pcda/rounding.ts` | ✅ |
| 2.3 Write property test for rounding idempotence and precision | `tests/pcda-rounding.test.mjs` | ✅ |
| 2.4 Create `/lib/calculations/pcda/weight.ts` | `lib/calculations/pcda/weight.ts` | ✅ |
| 2.5 Write property tests for weight calculations | `tests/pcda-weight.test.mjs` | ✅ |
| 2.6 Create `/lib/calculations/pcda/recovery.ts` | `lib/calculations/pcda/recovery.ts` | ✅ |
| 2.7 Write property test for recovery and scrap percentages | `tests/pcda-recovery.test.mjs` | ✅ |
| 2.8 Create `/lib/calculations/pcda/cost.ts` | `lib/calculations/pcda/cost.ts` | ✅ |
| 2.9 Write property tests for cost calculations and packing flag | `tests/pcda-cost.test.mjs` | ✅ |
| 2.10 Write property test for sentinel behavior | `tests/pcda-sentinel.test.mjs` | ✅ |

**What was built:**
- **Sentinel** (`NOT_CAPTURED` symbol, `CalcResult` type, `isCaptured` guard, `guardPositive`/`guardPositiveStrict` helpers)
- **Rounding** (half-up via exponential notation shift: `roundWeight`/`roundQuantity` 3dp, `roundPercent`/`roundMoney` 2dp)
- **Weight** (`theoreticalWeight`, `quantityKg` by method, `weightVariance`)
- **Recovery** (`recoveryPercent`, `scrapPercent` — uncapped)
- **Cost** (`costPerKg`, `costPerMeter`, `costPerPiece`, `contributionMargin`, `basicPrice` with packing flag, `netRateAndLineValue`)
- Property tests: P1 (quantity method), P2 (weight variance), P3 (recovery uncapped), P4 (cost formulas), P5 (sentinel behavior), P6 (rounding idempotence), P7 (packing flag exactly once)

---

### Task 3: Implement line reuse/copy utilities ✅

| Task | File | Status |
|------|------|--------|
| 3.1 Create `/lib/pcda/line-item.ts` | `lib/pcda/line-item.ts` | ✅ |
| 3.2 Write property test for line reuse | `tests/pcda-line-reuse.test.mjs` | ✅ |

**What was built:**
- `copyLineForReuse(source, ref)` — pure copy, new UUID, stamps source reference, resets revision to 1
- `hasCompleteFieldSet(line)` — validates canonical field coverage
- Property 12 test (7 sub-tests) verifying full copy, null preservation, source stamping, non-destructive isolation

---

### Task 4: Create not-captured label utilities ✅

| Task | File | Status |
|------|------|--------|
| 4.1 Create `/lib/pcda/labels.ts` | `lib/pcda/labels.ts` | ✅ |
| 4.2 Write property test for no-fabrication display | `tests/pcda-labels.test.mjs` | ✅ |

**What was built:**
- Label constants: `NOT_CAPTURED_LABEL`, `MISSING_COST_LABEL`, `PENDING_APPROVAL_LABEL`, `NO_DRAWING_LABEL`, `NO_ACTIVE_DIE_LABEL`
- `mapCalcResultToDisplay(result, label?)` — maps CalcResult to number or label string
- `mapNullableToDisplay(value, label?)` — maps null/undefined to label string
- Property 14 test (6 sub-tests) verifying no fabricated values ever displayed

---

### Task 5: Checkpoint — Core calculation library complete ✅

- All 94 property-based tests pass
- `npx tsc --noEmit` exits with zero errors
- Duration: ~918ms for full test suite

---

## Phase 1: Master Data & Validation (Partial) ✅

### Task 6: Create database migrations for master data tables ✅

| Task | File | Status |
|------|------|--------|
| 6.1 Create migration for PCDA master catalog tables | `supabase/migrations/20260603000000_pcda_master_catalog_tables_consolidated.sql` | ✅ |
| 6.2 Create RLS policies for master tables | (included in 6.1) | ✅ |

**What was built:**
- 17 master catalog tables all following identical schema pattern:
  - `pcda_master_alloy_standards`, `pcda_master_alloys`, `pcda_master_tempers`, `pcda_master_uoms`, `pcda_master_packing_modes`, `pcda_master_qty_methods`, `pcda_master_profile_categories`, `pcda_master_die_types`, `pcda_master_finish_types`, `pcda_master_surface_treatments`, `pcda_master_defect_types`, `pcda_master_quality_parameters`, `pcda_master_cost_components`, `pcda_master_document_types`, `pcda_master_compliance_types`, `pcda_master_machine_types`, `pcda_master_production_stages`
- Each table has: `company_id NOT NULL`, `UNIQUE(company_id, value)`, `is_active` flag, timestamps, `created_by`
- RLS enabled with SELECT + FOR ALL policies scoped to `get_current_user_company_id()`
- Composite index on `(company_id, is_active, value)`
- Idempotent (`IF NOT EXISTS` throughout)

---

## Next Tasks (to resume)

The next task in the queue is:

- **7.1** Create `/lib/master-data/service.ts` — search, deactivate, reference validation, deletion guard, duplicate rejection
- **7.2** Write property test for master search and selection (Property 15)
- **7.3** Write property test for master reference and duplicate enforcement (Property 16)
- **8.1–8.4** Validation Service (Zod schemas, packing flag conflict, weight range, property tests)
- **9.1–9.4** Add PCDA columns to existing line tables (quote_items, order_items, production, dispatch, invoice)
- **10** Phase 1 infrastructure checkpoint

Then Phase 2 (Reports), Phase 3 (Module Enrichment), and Phase 4 (Workflow/Audit/Security).

---

## How to Run Tests

```bash
node --import tsx --test tests/pcda-*.test.mjs
```

Or individually:
```bash
node --import tsx --test tests/pcda-field-set-partition.test.mjs
node --import tsx --test tests/pcda-rounding.test.mjs
node --import tsx --test tests/pcda-weight.test.mjs
node --import tsx --test tests/pcda-recovery.test.mjs
node --import tsx --test tests/pcda-cost.test.mjs
node --import tsx --test tests/pcda-sentinel.test.mjs
node --import tsx --test tests/pcda-line-reuse.test.mjs
node --import tsx --test tests/pcda-labels.test.mjs
node --import tsx --test tests/pcda-core.test.mjs
```

## Dependencies Added

- `fast-check` (dev) — property-based testing library
- `tsx` (dev) — TypeScript execution for extensionless imports in tests

---

## UI Audit Follow-up: Tenders Real Data Conversion ✅

**Date:** 2026-06-03  
**Scope:** Started the pasted UI audit by removing the most obvious production-facing fake module from the tender workflow.

### Completed

| Task | File | Status |
|------|------|--------|
| Replace fake tenders screen with server-loaded data | `app/(dashboard)/tenders/page.tsx` | ✅ |
| Add tenant-safe tender create action | `lib/actions/tenders.ts` | ✅ |
| Build real tender client UI with search/filter/create/detail | `components/modules/tenders-client.tsx` | ✅ |
| Remove stale lint issues in report/test files | multiple files | ✅ |
| Keep Node tests compatible with master-data pure imports | `lib/master-data/service.ts` | ✅ |
| Restore PCDA partial validation compatibility | `lib/validations/pcda/line-item.ts` | ✅ |

### What changed

- `/tenders` now reads real `tenders` rows scoped by authenticated `company_id` instead of local mock records.
- New tender creation derives `company_id` from `getSessionContext()` and restricts creation to `owner`, `admin`, and `sales_manager`.
- Fake “Convert to Order” behavior was removed; won tenders now either link to an existing order or show an honest not-yet-converted message.
- Tender search, status filters, stats, empty states, detail modal, and create flow now operate on real tenant data.
- Master-data service now lazy-loads Supabase only inside DB-backed functions so pure tests do not import Next server modules.

### Validation

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 243 tests passing
- `npm run build` ✅

### Remaining UI Audit Follow-ups

- Review automation external-send options and remove/disable placeholder action choices where providers are not configured.
- Review communication providers for non-implemented WhatsApp send paths and make failure states explicit.
- Review Data Center auto-purge UI and disable or wire it fully.
- Review Systems Configurator prepared shells and ensure incomplete routes are clearly labeled as unavailable, not fake-working.

---

## UI Audit Follow-up: Placeholder and Dead-Action Cleanup ✅

**Date:** 2026-06-03  
**Scope:** Continued resolving production-facing placeholder/fake/dead-action surfaces after the tender real-data conversion.

### Completed

| Task | File | Status |
|------|------|--------|
| Remove external-send placeholder automation actions from builder | `components/modules/automation-client.tsx` | ✅ |
| Tighten automation action validation to real safe actions | `lib/validations/schemas.ts` | ✅ |
| Update first automation guide to avoid placeholder-send guidance | `app/(dashboard)/automation/first-automation/page.tsx` | ✅ |
| Replace mocked WhatsApp provider behavior with explicit unavailable states | `lib/communications/providers.ts` | ✅ |
| Stop presenting Data Center auto-purge as an enabled feature | `components/modules/data-center-client.tsx` | ✅ |
| Rename configurator placeholder shell copy to honest prepared-route language | `components/modules/systems-configurator/route-shell.tsx` | ✅ |
| Convert integrations page from static sample data to real tenant data | `app/(dashboard)/settings/integrations/page.tsx` | ✅ |
| Add real integrations client with empty states and no dead action buttons | `components/modules/integrations-client.tsx` | ✅ |
| Replace fake mobile scan result/dead buttons with links to real scan workspace | `app/(dashboard)/mobile/scan/page.tsx` | ✅ |

### What changed

- Automation now only offers safe internal actions: `create_task`, `create_alert`, `generate_message`, `assign_user`, and `change_status`.
- WhatsApp Web/API providers no longer log mock sends or imply queued delivery; they return explicit not-configured/unavailable errors.
- Data Center retention settings can still be saved, but automatic purge is clearly marked manual-only until a reviewed server job exists.
- Systems Configurator prepared shells no longer describe themselves as placeholder layers or imply operational output.
- Integrations now load from `integrations` and `sync_logs` with tenant scoping via the server route instead of hardcoded sample providers/logs.
- Mobile Scan no longer shows a fake verified bundle result or dead scanner/search controls; it routes users to the real `/scan` workspace.

### Validation

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 369 tests passing on isolated rerun
- `npm run build` ✅

### Remaining UI Audit Follow-ups

- Continue checking pages with active buttons for real server actions, especially enterprise import/export, mobile subpages, and module-specific utility pages.
- Review public/portal pages for static demo content and ensure customer-safe fields only.
- Review settings pages for any remaining configuration actions that should be disabled until server-side providers exist.

---

## UI Audit Follow-up: Real Mobile, Compliance, Export, and Dashboard Cleanup ?

**Date:** 2026-06-03  
**Scope:** Continued resolving the remaining UI audit items by replacing static/demo operational surfaces with tenant-scoped data and removing misleading action controls.

### Completed

| Task | File | Status |
|------|------|--------|
| Replace mobile home shortcuts with live tenant counts | `app/(dashboard)/mobile/page.tsx` | ? |
| Replace mobile dispatch queue with real dispatch rows | `app/(dashboard)/mobile/dispatch/page.tsx` | ? |
| Replace mobile jobs queue with real production jobs | `app/(dashboard)/mobile/jobs/page.tsx` | ? |
| Replace mobile quality queue with real quality tests | `app/(dashboard)/mobile/quality/page.tsx` | ? |
| Replace mobile task queue with real open tasks | `app/(dashboard)/mobile/tasks/page.tsx` | ? |
| Remove shared static mobile fixture data | `app/(dashboard)/mobile/data.ts` | ? |
| Replace exports mock page with tenant export orders/documents | `app/(dashboard)/exports/page.tsx` | ? |
| Replace compliance mock page with tenant compliance records | `app/(dashboard)/compliance/page.tsx` | ? |
| Remove fabricated dashboard growth/activity numbers | `components/modules/dashboard-client.tsx` | ? |
| Make dashboard heading action labels non-clickable | `components/modules/dashboard-client.tsx` | ? |
| Make shared dashboard heading action labels non-clickable | `components/modules/dashboard-primitives.tsx` | ? |
| Replace enterprise header info-button with status badge | `components/modules/enterprise-foundation-client.tsx` | ? |
| Replace nested button/link disabled-module CTA with real link | `components/ui/module-disabled.tsx` | ? |
| Replace specific fake document entity placeholder | `app/(dashboard)/documents/intelligence/page.tsx` | ? |
| Allow dealer order business numbers in shared numbering type | `lib/utils/numbering.ts` | ? |

### What changed

- Mobile pages now read real company-scoped operational data instead of importing shared static lists.
- Export and compliance pages now render actual database records with honest empty states instead of mock customers, standards, audits, calibrations, and export orders.
- Dashboard analytics no longer fabricates `+12%`, `+8%`, or inflated activity heatmaps; it shows current live counts and labels non-navigation chips as plain badges.
- Enterprise Foundation no longer includes an information-only button that looks actionable; it now uses a status badge while section-level save buttons remain functional.
- Disabled module routing now uses a proper styled link to Enterprise Foundation without nesting a button inside a link.
- Dealer order numbering now includes the existing `DO` prefix in the typed business-number helper, fixing the validation blocker.

### Validation

- `npm run lint` ?
- `npm run typecheck` ?
- `npm test` ? � 369 tests passing
- `npm run build` ?
- Final mock/demo scan only reports a legitimate test title in `lib/systems-configurator/__tests__/formula-engine.test.ts`.

### Remaining UI Audit Follow-ups

- Continue auditing large module pages with many action buttons for any actions that should be disabled until providers/server flows exist.
- Review customer/public portal static pages separately for customer-safe fields and real tenant-facing data.
- Review non-Git workspace setup if diff-based reporting is needed; this folder currently does not expose a `.git` repository to Codex.

---

## UI Audit Follow-up: Portal and Final Dead-Link Audit ?

**Date:** 2026-06-03  
**Scope:** Final pass after the real-data cleanup to verify portal/static/dead-link concerns.

### Completed

| Task | File | Status |
|------|------|--------|
| Verify portal dashboard uses dealer-scoped live data | `app/portal/dashboard/page.tsx` | ? |
| Verify portal orders route redirects to real dealer orders | `app/portal/orders/page.tsx` | ? |
| Verify portal quotes route redirects to real quotes | `app/portal/quotes/page.tsx` | ? |
| Verify portal support route redirects to real tasks | `app/portal/support/page.tsx` | ? |
| Scan for remaining mock/demo/fake/static records | `app`, `components`, `lib` | ? |
| Scan for literal dead links and placeholder implementation markers | `app`, `components`, `lib` | ? |

### Notes

- Portal routes do not expose mock records; the dashboard is already restricted to dealer roles and scoped by `company_id` plus `dealer_id`.
- The only remaining mock/demo scan hit is a legitimate systems-configurator test title, not production UI.
- Remaining disabled controls found in the scan are tied to real validation/loading/permission/readiness states.

### Validation Reference

- The immediately preceding full validation passed: `npm run lint`, `npm run typecheck`, `npm test` with 369 passing tests, and `npm run build`.

---

## PCDA Technical Enrichment: Task File Completion ?

**Date:** 2026-06-06  
**Scope:** Completed the remaining unchecked and partial items in `.kiro/specs/pcda-technical-enrichment/tasks.md`, focusing on the missing report generator/action/readiness path, customer-output safety, QR payload round-trip support, and final checklist closure.

### Completed

| Task | File | Status |
|------|------|--------|
| Add generic PCDA PDF/CSV/Excel-compatible report generator | `lib/reports/pcda/generator.ts` | ? |
| Add customer-safe report model wrapper | `lib/reports/pcda/customer-report.ts` | ? |
| Add async report readiness gate by template/record | `lib/reports/pcda/readiness.ts` | ? |
| Add generic `generateReport` server action with RBAC, readiness, storage, and report row logging | `lib/actions/pcda-reports.ts` | ? |
| Preserve existing profile/die technical sheet server actions | `lib/actions/pcda-reports.ts` | ? |
| Add report sanitization/generator/readiness tests | `tests/pcda-reports.test.mjs` | ? |
| Add company-scoped QR payload helper | `lib/qr/payload.ts` | ? |
| Use typed QR payloads in QR generation | `app/(dashboard)/barcode/page.tsx` | ? |
| Expand QR/scanner support to required scoped entity types | `app/(dashboard)/barcode/page.tsx`, `app/(dashboard)/scan/page.tsx` | ? |
| Add QR payload round-trip tests | `tests/qr-payload.test.mjs` | ? |
| Clean report builder and calculation test lint warnings | `lib/reports/pcda/builder.ts`, `tests/pcda-calculations.test.mjs` | ? |
| Mark all task checklist items complete | `.kiro/specs/pcda-technical-enrichment/tasks.md` | ? |

### Validation

- `npm run lint` ?
- `npm run typecheck` ?
- `npm test` ? � 375 tests passing
- `npm run build` ?
- `tasks.md` unchecked-marker scan ? � no `[ ]`, `[~]`, or `[-]` markers remain

### Security and Tenancy Notes

- Generic report generation derives `company_id`, user, and role from `getSessionContext()` server-side.
- Report generation checks template RBAC and applies stricter profitability access to owner/admin/accounts roles.
- Report storage paths remain company-scoped under `<company_id>/reports/...`.
- Customer-facing report models remove restricted internal cost, supplier rate, margin/profit, and internal note fields before generation.
- QR payloads include company scope, entity type, entity id, and nonce; scanner lookups still rely on Supabase RLS plus scoped QR records.

### Known Notes

- The broad production mock-text scan can be slow in this OneDrive workspace and timed out, but the task checklist is complete and the required validation suite passes.
- This workspace still does not expose a `.git` repository to Codex, so diff/status reporting is unavailable through Git.

---

## Post-Completion Cleanup: Production Marker Audit ?

**Date:** 2026-06-06  
**Scope:** Continued after `tasks.md` completion by splitting the production mock/dead-action scan into safer folder-level searches and removing the last stale placeholder-named export.

### Completed

| Task | File | Status |
|------|------|--------|
| Confirm no remaining unchecked markers in `tasks.md` | `.kiro/specs/pcda-technical-enrichment/tasks.md` | ? |
| Split production mock/dead-link scan across app/components/lib | `app`, `components`, `lib` | ? |
| Remove unused placeholder-named configurator export | `components/modules/systems-configurator/route-shell.tsx` | ? |

### Validation

- `npm run lint` ?
- `npm run typecheck` ?

### Notes

- No production `href="#"`, mock data, dummy/sample data markers, or explicit `not implemented` markers were found in the scoped scan.
- Remaining `placeholder` matches are normal input placeholder props/copy, not fake production data.

---

## PCDA Tasks Recheck: Evidence Audit ✅

**Date:** 2026-06-06  
**Scope:** Rechecked `.kiro/specs/pcda-technical-enrichment/tasks.md` against actual implementation, fixed gaps found during the audit, and reran the full validation suite.

### Gaps Found and Fixed

| Gap | Fix | File |
|-----|-----|------|
| Several report templates fell back to empty generic sections | Added real-data builders for die trial, quality inspection, packing, export, compliance, and profitability reports | `lib/reports/pcda/builder.ts` |
| Readiness checker allowed those same templates without verifying source records | Added table-backed readiness checks for all newly covered templates | `lib/reports/pcda/readiness.ts` |
| Customer sanitization removed margin but not broader profit/cost aliases | Extended restricted customer fields to profit, gross margin, total cost, and cost-per-unit aliases | `lib/pcda/sanitize.ts` |
| Scanner trusted RLS but did not explicitly reject cross-company QR payloads | Added actor/company loading gate, parsed payload company mismatch rejection, and explicit `company_id` filters | `app/(dashboard)/scan/page.tsx` |
| Task 13.1 named `/app/actions/pcda-reports.ts`, but action implementation lived only under `lib/actions` | Added a server-action bridge that re-exports the existing report actions | `app/actions/pcda-reports.ts` |
| Tests did not cover the above audit gaps | Added report readiness and customer sanitization regression tests | `tests/pcda-reports.test.mjs` |

### Verification

- `tasks.md` unchecked-marker scan ✅ — no `[ ]`, `[~]`, or `[-]` markers remain.
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 377 tests passing.
- `npm run build` ✅ — production build completed and generated 147 pages.

### Notes

- The project directory available to Codex is not a Git repository, so `git diff`/`git status` cannot produce a change summary here.
- No database migrations were added in this recheck; all fixes use existing RLS-protected tables and server-derived company context.
