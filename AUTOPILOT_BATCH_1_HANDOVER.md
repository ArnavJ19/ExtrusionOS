# Autopilot Batch 1 — Handover (work in progress)

Date: 9 November 2026 (Asia/Kolkata)
Prompt followed: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md) with batch N = 1, features = NEXT
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md) — Delivery plan batch 1
Branch: `feat/autopilot-batch-1` (created from `chore/refresh-evidence-screenshots` at 2b314d7). **Nothing is committed yet.**
Hosted database: **not touched.** The migration has only been replayed locally (PGlite).

---

## 1. Status at a glance

| Area | State |
| --- | --- |
| Selection | AP-001, 002, 004, 005, 006, 007, 038, 041, 042, 059 (Delivery plan batch 1). No earlier AUTOPILOT batch existed, so nothing was replaced. |
| Migration | `supabase/migrations/20261109100000_autopilot_batch_1.sql` (~2,150 lines), applies cleanly on the full replayed chain |
| Batch SQL/RLS tests | `tests/autopilot-batch1-sql.test.mjs` — **14/14 pass** |
| Batch unit tests | `tests/autopilot-batch1.test.mjs` — **8/8 pass** |
| Batch browser tests | `tests/autopilot-batch1-browser.test.mjs` — **16/16 pass** (8 screens × 375 px and 1280 px); screenshots in `docs/evidence/AUTOPILOT_BATCH_1/` |
| `npm run typecheck` | **Passes** (last run after all code was written) |
| `npm run lint` | Changed files linted; 2 errors + 2 warnings found and fixed. **Full `eslint .` not yet re-run.** |
| `npm run build` | **Not yet run** |
| `npm test` (full suite) | **3,268 tests: 3,233 pass, 35 fail** (see §6). Not fixed yet. |
| In-app browser check | Not done yet (plan in §7) |
| Batch record `AUTOPILOT_UPGRADE_BATCH_1.md` | Not written yet |
| Link in AUTOPILOT_UPGRADES.md, memory update, commit | Not done yet |

---

## 2. What each feature does now

### AP-001 Scheduled jobs with a ledger
- Table `system_job_runs` (unique per company + job + window → a retried/overlapping call in the same window does nothing).
- Job registry `private.ap_job_registry()` mirrored by `lib/jobs/registry.ts` (test compares them). Jobs: `proposals.refresh` (hourly), `navigation.propose`, `series.propose`, `calendar.check` (nightly), `periods.propose_close` (morning).
- Runner `private.ap_job_once` (advisory lock per job, failure caught and recorded, three failed windows in a row → one owner notification per streak).
- Cron entry `public.ap_jobs_cron(payload)` — executable **only by service_role**; called by `app/api/cron/[schedule]/route.ts`, which checks `Authorization: Bearer $CRON_SECRET` (constant-time, `lib/jobs/cron-auth.ts`). `vercel.json` added with three crons (UTC times = 00:30 and 08:00 IST, hourly at :05).
- Owner/admin page: Automation now shows a **Scheduled jobs** panel (`components/modules/autopilot/jobs-panel.tsx`) with health, last success, failed streak, a real **Run now** (recorded as manual; same-minute repeat = same run) and a 10-row paginated run ledger. Panel shows even if the automation module flag is off. The old rule builder's simulations remain labelled simulated (they are not registered jobs).

### AP-002 Proposals as accept/edit cards
- Table `proposals` (type, target, payload, inputs = versions + evidence, fingerprint, rule, reason, confidence, decide roles, expiry, decision fields). One open proposal per target.
- `public.ap_proposals`: `list`, `decide` (accept / edit allowed fields / reject with note), `decide_batch` (per-row results), `pending_count`.
- Stale check at decision time: fingerprint of current versions ≠ stored → marked **stale**, cannot be accepted. Expired → marked expired. A rejected proposal with the same payload is not re-proposed for 30 days.
- Accepting re-runs the domain action with its own checks (`private.ap_proposal_apply`).
- Shared UI `components/modules/autopilot/proposal-cards.tsx` (Why list, Accept/Edit/Reject, batch accept with per-row untick, stale warning, pagination). All three proposal types in this batch use it.
- My Work: new queue **"Waiting for your confirmation"** (`lib/dashboard/my-work.ts`).

### AP-004 Factory calendar
- Tables `factory_calendar_settings` (weekly off, shifts, promise basis calendar|working) and `factory_calendar_exceptions` (holiday / shutdown / maintenance / extra working day, ≤63 days, soft remove).
- SQL `private.factory_is_working_day / add_working_days / working_days_between`; TS mirror `lib/calendar/working-time.ts`.
- `public.ap_calendar` (read for everyone; edit for owner, admin, factory/production manager).
- **Integrated** into delivery proposals: `buildFactoryDeliveryProposal(data, calendar?)` skips press capacity on holidays/shutdowns/maintenance days and counts finishing lead in the chosen basis; `lib/actions/factory-planning.ts` loads the calendar (falls back to old behaviour if unreadable). Receivable ageing deliberately unchanged (calendar days).
- Page `/production/calendar` (`calendar-client.tsx`): 5-week view, promise check, settings, entries.
- `calendar.check` job alerts owner/plant heads if no holiday/shutdown entered for the next 120 days.

### AP-005 Financial-year numbering
- Tables `document_series` (one active per doc type; template must contain `{FY}`/`{FY4}`) and `document_series_counters` (per FY, row-locked → unique, sequential, gap-free; rollback returns the number).
- `private.next_business_number_locked` replaced (same signature, now SECURITY DEFINER): uses the active series if any, otherwise the old calendar-year logic (copied to `private.ap_legacy_business_number`). Existing numbers never change.
- Hard delete of a series-numbered invoice/credit note is refused (cancel instead).
- **Deviation from catalogue:** the example `OMX/INV/26-27/0001` is 18 characters; CGST Rule 46 allows 16 for tax invoices, so the check refuses it. Proposed defaults: `OMX/{FY}/` (invoices), `CN/{FY}/`, `Q/{FY}/`, `SO/{FY}/`, `DC/{FY}/`.
- `series.propose` job creates proposals; page `/invoices/numbering` (proposal cards + direct confirm form with live length check).

### AP-006 Import masters from Excel
- No new dependency: `lib/master-data/import/spreadsheet.ts` reads `.xlsx` (zip + XML via `node:zlib`) and `.csv`; ≤4 MB (Vercel body limit), ≤5,000 rows.
- Definitions (`definitions.ts`) for customers, vendors, transporters (vendors of type transporter), profiles, dies, machines; parsers keep blank optional cells blank and treat unreadable cells as errors (never zero); dates DD/MM/YYYY or Excel serial; Indian number format.
- Engine (`engine.ts`): auto-mapping by key/label/synonyms, **remembered mapping** per header layout, row validation, rejected-row CSV (formula-neutralised), header-only templates.
- Upload route `app/api/master-import/preview` → `upload.ts` → `public.ap_import('stage')` (DB re-checks duplicates vs existing and within the sheet) → owner reviews → `commit` imports all valid rows in one transaction (re-checks; any change since preview aborts all) → `reverse` with reason only if no other record references the rows (FK introspection).
- Templates `app/api/master-import/template/[kind]`, rejected rows `app/api/master-import/[id]/rejected`.
- Page `/settings/data/import` (owner/admin) with 10-row paginated history.
- Machine codes are always allocated by the existing numbering trigger; the factory's own code is kept in notes.
- Measured: 500 customers + 1,000 profiles staged and imported in ~4.5 s locally (target < 2 min).

### AP-007 Opening balances and cut-over lock
- Tables `cutover_plans` (one per company), `cutover_sections` (7 sections), `cutover_opening_lines`; columns `invoices.opening_cutover_id/opening_reference`, `orders.opening_cutover_id`.
- Flow: start plan (date ±60 days) → each section loaded from its sheet with **signed control totals** (`app/api/cutover/load`) → a **different person** signs off (owner excepted) only if loaded totals equal the sheet → posting into existing ledgers → ledger totals re-verified equal → plan sign-off (all sections signed or confirmed empty) sets books locked through cut-over date − 1.
- Postings: finished stock → `profile_stock_batches` (origin `opening_balance`); billets → `billet_batches`; stores → `inventory_items` (+ existing opening-stock movement trigger); receivables → `invoices` numbered `OB-YYYY-NNNN` (outside the GST series, `assign_business_number` replaced to do this) with original ref kept; payables → `expense_ledger` (source `opening_balance`); open orders → `orders` + `order_items`; dies at vendors → die status + location.
- A signed section can be reversed with a reason before plan sign-off, only if its entries are unused.
- Page `/settings/data/cutover` (route permission added for accounts, inventory/factory/production managers, sales manager).

### AP-038 GSTIN validation
- SQL `private.ap_gstin_valid` (format + state code + mod-36 check digit) and `private.ap_gst_state`; trigger on customers/vendors: invalid GSTIN refused, state filled from GSTIN when blank, `gst_registration` (new column) must be registered (valid GSTIN) or explicitly unregistered. Only a changed GSTIN/registration is checked, so legacy records stay editable.
- TS `lib/validations/gstin.ts`; `gstNumber` in `common.ts` now checks the digit; new `gstRegistration` + `requireGstChoice`; `customerFormSchema` / `vendorFormSchema` used by the generic forms (new "GST registration" select); quick-add customer/vendor dialogs got an "Unregistered under GST" checkbox.
- Label everywhere: format valid ≠ active registration.

### AP-041 Fold /tasks hubs into home records
- Registry `private.ap_home_sources()` (49 hub view → home record links, mirrored in `lib/navigation/home-work.ts`, test compares).
- `public.ap_home_work('record' | 'attention')` reuses each hub's own `_rows` read model and `_read_allowed` permissions.
- **Related work** panel (`components/modules/home-work/related-work-panel.tsx`) added to detail pages of orders, production jobs, dies, dispatches, invoices, vendors, customers, quotes, machines, profiles, with "Start from this record" links.
- New routes `/<module>/[id]/work?action=hub:action` (10) and module routes `/<module>/work` (quality, inventory, dispatches, production, vendors, invoices) render the hub's own form with the record pre-selected (`home-work-action.tsx`).
- "More workflows" section on 6 module overviews (`module-workflows.tsx`; also links to calendar, month close, numbering).
- All 8 hub `new` pages now redirect record/module work to its home (`homeForHubNew`); configuration actions stay in the hub. Hub layouts show a "report across records" notice.
- My Work queue **"Work on your records"**.

### AP-042 Role navigation from usage
- Tables `navigation_visit_counts` (role, route, day, count — no user, no ids, no query) and `role_navigation` (≤9 items, versioned).
- Beacon `components/layout/nav-visit-beacon.tsx` counts the destination; `navigation.propose` job proposes top destinations after ≥14 days with visits in 28 days.
- `buildTaskNavigation` accepts `approvedItems` (still filtered by role/route/flag; max 9). Nav list moved to `lib/navigation/app-destinations.ts`.
- Page `/settings/navigation` (usage, proposals, editor with reorder).

### AP-059 Month close and back-dating
- Built on the existing `accounting_period_locks`. New: `period_policies`, `period_reopen_requests` (approved by a different person, time-boxed window), `period_exception_postings` (every posting inside a window logged), `backdated_entry_flags` (entries dated > N days back; reviewed by someone else).
- `private.enforce_accounting_period_lock` replaced: same behaviour plus approved-window exceptions; lock trigger also added to `supplier_purchase_bills` and `purchase_receipts`. Back-dating flag trigger on 8 financial tables.
- `periods.propose_close` job → month-close proposal; months close in order.
- Page `/invoices/periods`.

### Settings
- Settings page has a "Go-live and automation" link block (owner/admin).

---

## 3. Files

**Created (batch):** migration above; `lib/actions/autopilot.ts` (single allow-listed, Zod-validated gateway for all `ap_*` RPCs); `lib/calendar/working-time.ts`; `lib/cutover/cutover.ts`; `lib/jobs/registry.ts`, `lib/jobs/cron-auth.ts`; `lib/master-data/import/{spreadsheet,definitions,engine,upload}.ts`; `lib/navigation/{app-destinations,home-work,hub-permissions,role-navigation}.ts`; `lib/numbering/financial-year.ts`; `lib/periods/periods.ts`; `lib/proposals/proposals.ts`; `lib/validations/gstin.ts`; `components/modules/autopilot/*` (8 clients); `components/modules/home-work/*` (4); `components/layout/nav-visit-beacon.tsx`; pages listed in §2; API routes `app/api/cron`, `app/api/cutover`, `app/api/master-import`; `vercel.json`; tests and fixtures (`scripts/lib/autopilot-batch1-fixture.mjs`, `scripts/lib/autopilot-batch1-browser-fixture.mjs`); `docs/evidence/AUTOPILOT_BATCH_1/*.png`.

**Modified (batch):** `scripts/lib/migration-chain-replay.mjs` (see §5); `lib/validations/common.ts`, `lib/validations/schemas.ts`; `lib/forms/in-task-customer.ts`, `lib/forms/in-task-vendor.ts`; `components/modules/customers/in-task-customer.tsx`, `components/modules/vendors/in-task-vendor.tsx`; `components/modules/operations/module-config.ts`; `lib/navigation/task-navigation.ts`; `lib/dashboard/my-work.ts`; `lib/workflow/factory-planning.ts`, `lib/actions/factory-planning.ts`; `lib/auth/route-permissions.ts`; `app/(dashboard)/automation/page.tsx`; `app/(dashboard)/settings/page.tsx`; 10 record detail pages; 6 module overview pages; 8 hub `new` pages + 8 hub layouts; `components/layout/app-shell.tsx` (**also has your own uncommitted edits — see §8**).

**Scratch files to delete before commit (not part of the batch):** `scripts/.ap-actions.mjs`, `scripts/.ap-apply.mjs`, `scripts/.ap-introspect.mjs`, `scripts/.ap-inv.mjs`, `scripts/.ap-serve.mjs`.

The migration is assembled from parts kept in the session scratchpad (`p01_base.sql` … `p08_home_work.sql`, `p99_commit.sql`). **The file in `supabase/migrations/` is the source of truth now**; edit it directly from here on.

---

## 4. Security notes

- Every new table: `company_id`, RLS enabled, select policy scoped to the user's company (and role where sensitive), no client insert/update/delete grants; all writes through SECURITY DEFINER functions with pinned `search_path` that take company and actor from `auth.uid()` (`private.ap_ctx`, excludes inactive users and dealer roles). A test asserts RLS, company index, no write grants, no anon read, and that only the nine `public.ap_*` functions are callable by clients.
- Dynamic SQL only uses catalog/registry identifiers via `format(%I/%s)`.
- Service-role key used only in the cron route handler (server); the RPC it may call is granted to `service_role` only.
- Messages shown to users only when prefixed `AP: ` (or the lock/GSTIN rule messages).
- Known accepted behaviours: any active user's page views increment visit counts (counts only; proposals still need admin approval); an approved reopen window allows any permitted poster to post into that month (all postings are logged).

---

## 5. Test harness change (important)

Your uncommitted `20261109000000_single_tenant_omalco.sql` adds a one-company trigger. Every existing SQL fixture inserts a second synthetic company for isolation tests, so **the whole SQL suite failed** with it (verified: nov-batch3-sql 0/23). I did not touch that migration. Instead `scripts/lib/migration-chain-replay.mjs` now disables `trg_enforce_single_company` in the replayed copy after the chain is applied (option `{ syntheticCompanies: false }` keeps it). A batch test re-enables it and confirms it still refuses a second company.

---

## 6. Open failures from the full `npm test` run (must fix next)

Run was still going when interrupted (log: session scratchpad `npm-test-1.log`). Failures seen up to test ~1,386, all from this batch:

| Test file | Cause | Fix to make |
| --- | --- | --- |
| `tests/in-task-customer-action.test.mjs` (936, 939–941, 943, 944) | Quick-add now requires a valid GSTIN or `gst_registration: "unregistered"`; fixtures use GSTINs with wrong check digits (e.g. `27ABCDE1234F1Z5`) | Update test inputs: add `gst_registration: "unregistered"` where no GSTIN; replace invalid GSTINs with check-digit-valid ones (`27ABCDE1234F1Z0`, `24ABCDE1234F1Z6`, `24PQRST5678K1Z8`, `27ZZZZZ9999Z1Z8`, `27AAACX1234A1ZX`, `24AAKCS1234F1ZO`, `08ABCDE1234F1Z0`, `07AAACX1234A1ZZ`) |
| `tests/master-cleanup-sql.test.mjs` (1059–1062) | DB GSTIN trigger refuses `07AAACX1234A1Z1` | Same GSTIN replacement in that test/fixture |
| `tests/my-work-today.test.mjs` (1092, 1095, 1099) | My Work now calls `ap_proposals`/`ap_home_work` RPCs; the test mock's `rpc` returns something that adds queues or changes the department list | Inspect the mock; make `loadAutopilotQueues` skip when the RPC result is not a real response (or update expected queue lists) |
| `tests/nov-batch7.test.mjs` (1181, 1182 — NOV-002 workspace pins) | Timeout; likely from the app-shell/nav change (`APP_DESTINATIONS`, `approvedItems`) or the nav beacon | Investigate; check the test's mocked shell/navigation |
| `tests/nov-batch2-browser.test.mjs` (1386 — in-task vendor) | Same quick-add GST rule | Tick "Unregistered" in the test or use a valid GSTIN |

**Final result of that run (finished after the handover was first written): 3,268 tests, 3,233 passed, 35 failed** (run took 4.8 hours, so the machine was heavily loaded; some browser failures may be timeouts). Additional failures beyond the table above, not yet diagnosed:

| Test(s) | Likely cause (unconfirmed) |
| --- | --- |
| 1485 migration audit: "every new table has company scoping, RLS and no client grant beyond a person's own request" | My new tables `grant select to authenticated` (with RLS). Either drop those grants (all reads already go through `ap_*` functions) or teach the audit about this batch |
| 1494, 1496 NOV-083/084/085 real edit form | Customer/vendor form now has the extra "GST registration" field and requires the choice |
| 1860 purchase lifecycle (58/59/95/98) | Invalid test GSTIN refused by the new vendor trigger |
| 2063 factory and inventory managers discover their modules | Navigation/route change (`APP_DESTINATIONS`, cut-over route rule) or My Work queues |
| 2379–2392 `tests/upgrade-workflow-browser.test.mjs` (whole file) | Unknown: possibly a fixture start failure caused by the schema/form changes, or load timeouts. Re-run this file alone first |

Re-run the failing files one by one after fixing (`node --no-warnings --test --experimental-strip-types tests/<file>`), then the full suite.

**Side effect of the full run:** it regenerated many screenshots under `docs/evidence/NOV_UPGRADES_BATCH_*` and `EOS_UPGRADE_BATCH_4`. These should not be committed with this batch.

---

## 7. Remaining steps (in order)

1. Let the full test run finish (or re-run) and fix every failure in §6.
2. `npm run lint` (full), `npm run typecheck`, `npm run build`; fix anything caused by this batch.
3. In-app browser check at desktop and phone width: the real app needs a Supabase login (hosted DB was wiped, no users), so use the fixture server: `node --no-warnings scripts/.ap-serve.mjs` (serves `http://127.0.0.1:4317`, seeded proposals, visits and a shutdown), open it in the browser pane, and in the console call `mount('<screen>', ids.owner, { today: '2026-11-09' })` for `proposals, jobs, calendar, numbering, periods, navigation, import, cutover`. Optionally `npm run dev` to confirm the new routes compile and redirect to login.
4. Self-review of the diff (started: one bug found and fixed — opening-order reversal could hide other references; reference check now takes an ignore list). Still to review: UI text, empty/error states, and the open questions in §9.
5. Re-check each entry's "Done when" (§10).
6. Write `AUTOPILOT_UPGRADE_BATCH_1.md` in the `NOV_UPGRADE_BATCH_10.md` structure; add a one-line link near the top of `AUTOPILOT_UPGRADES.md`; update project memory.
7. Delete the scratch `scripts/.ap-*.mjs` files; commit on `feat/autopilot-batch-1` **only batch files** (see §8). Do not push, merge or apply the hosted migration.

---

## 8. Committing safely next to your uncommitted work

Your uncommitted changes (`CLAUDE.md`, signup page, dashboard page/client, auth-forms, `lib/auth.ts`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `lib/dashboard/stock-snapshot.ts`, the two `20261109*` migrations, the AUTOPILOT docs) must not be committed with the batch.

- `components/layout/app-shell.tsx` contains **both** your logo change and my AP-042 change. Stage only mine: take the HEAD version, apply the scratch script `appshell-edit.cjs` (session scratchpad) to a copy, then `git hash-object -w <copy>` + `git update-index --cacheinfo 100644,<hash>,components/layout/app-shell.tsx`. The working file keeps both.
- `components/layout/nav-link.tsx`, `components/layout/task-navigation.tsx` and `components/layout/workspace-shortcuts.tsx` now show as modified, but **I did not edit them** — they changed during this session (possibly by you). Leave them out unless you confirm otherwise.
- `lib/navigation/task-navigation.ts` (lib) **is** mine.
- The migration must replay after your two `20261109000000/010000` migrations; it does not depend on them.

---

## 9. Assumptions and open decisions

1. Batch number 1; selection from the Delivery plan table (not pure delivery rank).
2. GST Rule 46 (16 characters) overrides the catalogue's invoice-number example; default formats chosen as in §2. Accounts must confirm.
3. Hourly cron requires a Vercel Pro plan (Hobby allows daily crons only). `CRON_SECRET` (≥16 chars) and `SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel.
4. Upload limit 4 MB because of the Vercel request body limit.
5. Opening receivables are invoices numbered `OB-…` with tax 0 and flagged `opening_cutover_id`; there is no GST report in the app today, but future e-invoice/GSTR/Tally exports (AP-081/082/083) must exclude them.
6. Opening-stock movements for stores items are dated on the posting day (existing trigger), not the cut-over date.
7. After plan sign-off, opening entries are corrected with normal documents (credit notes, stock adjustments), not by reversing sections.
8. The existing owner-only "move the books lock back" control still exists alongside the new reopen requests; consider retiring it so every reopen needs a second person.
9. Customers/vendors saved before AP-038 keep `gst_registration = null` until edited.
10. My Work "Work on your records" reads every readable hub view on each dashboard load; fine for one factory, monitor speed.

---

## 10. "Done when" status (to confirm after §6–7)

| ID | Done when | Status |
| --- | --- | --- |
| AP-001 | Two overlapping invocations → one run; failing job visible within a window; no browser-reachable key | Met in SQL tests (true parallel concurrency not testable in PGlite; relies on unique key) |
| AP-002 | All proposal entries use the component; stale cannot be accepted | Met for the three types in this batch |
| AP-004 | Promise before a shutdown moves by its length; calendar-day reports unchanged unless switched | Met (unit + SQL + browser) |
| AP-005 | Concurrent posting unique/sequential; 1 April rollover | Rollover and gap-free tested; concurrency by row lock (not parallel-tested) |
| AP-006 | 500 customers + 1,000 profiles < 2 min with exact rejected-row report | Met locally (~4.5 s) |
| AP-007 | Day-one stock and receivable totals equal the signed Excel totals | Enforced at sign-off and re-verified from ledgers |
| AP-038 | Invalid GSTIN not saved without explicit unregistered choice | Met (DB trigger + forms + import) |
| AP-041 | No daily task needs a /tasks hub; hubs are read-only reports | Entry points moved; hub detail pages still allow follow-up actions on existing hub records (reached from the record) — record this honestly |
| AP-042 | Each role's main nav ≤ 9 | Met (default 4; approved ≤ 9) |
| AP-059 | No posting in a closed period without an approved reopen | Met for the financial tables listed in §2 |

---

## 11. What you need to do (owner)

- Decide on §9 items 2, 3, 8.
- When ready: apply `20261109000000_single_tenant_omalco.sql` (yours) and later `20261109100000_autopilot_batch_1.sql` to hosted — **not done, only on your go-ahead**.
- Set `CRON_SECRET` in Vercel.
- Employee checks after deploy: import one real Omalco customer and profile sheet; run a dry cut-over with the signed Excel totals; accounts confirms invoice numbering; plant head enters this year's holidays; close October through the proposal.
