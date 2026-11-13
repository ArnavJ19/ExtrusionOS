# Autopilot Upgrade Batch 6

Date: 13–14 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md), Features = NEXT (the Delivery plan's "5 onward" row: remaining entries by delivery rank)
Base: `feat/autopilot-batch-5` at 2b61b5b; branch `feat/autopilot-batch-6`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain. The migration is **not** applied to the hosted database. Employee acceptance is a separate gate.

## Selection

The next ten undelivered entries by delivery rank after batches 1–5. Batches 1–5 delivered every U1 entry except AP-027 (rank 26) and AP-030 (rank 28), which batch 5's selection passed over; they lead this batch. None of the ten was delivered earlier, so no replacement was needed.

| Rank | ID | Feature | Foundation found | Gap closed in this slice | Where the work happens |
| --- | --- | --- | --- | --- | --- |
| 26 | AP-027 | Section-weight drift from bundle weights | Weighed bundles (`prepared_physical_bundles`), profile master kg/m and weight tolerance, AP-002 proposals, AP-001 jobs | Each production bundle's kg/m = (gross − tare) ÷ net length; the newest N bundles of a die are averaged against the master. Beyond tolerance (profile's own, else the factory tolerance QC sets) a nightly job proposes **inspect die** (die-shop task) or **review master** (task to the decider, linking the profile edit). Missing tolerance or too few bundles stays "unknown", never "within" | Die record (trend chart), `/dies/weight-drift` |
| 28 | AP-030 | Reprice open drafts from one daily rate | Approved, dated costing rates (`applicable_costing_rate`), quote-line and header triggers, `quote_rate_bindings` | Impact list of draft and internal-review quotations: old/new rate per kg, line and quotation totals, computed by the canonical triggers in a rolled-back trial (no second formula). One owner/admin action reprices all included drafts and keeps a printable run record. Sent quotations within validity are listed as "rate moved since sent", never changed. Approved-but-unsent quotations are listed for return to draft. Nightly proposal offers the same action | `/quotes/reprice`, run record `/quotes/reprice/[id]` |
| 46 | AP-100 | Owner system health page | AP-001 job ledger, export batch tables | Last run/success per job with failed, stuck, overdue and never-run states; proposals waiting by age; last Tally, e-way, e-invoice, IRN and TDS-statement activity; failed runs and phone-entry conflicts today; pg_cron's own run history where readable. Backup status is honestly marked not readable from the database | `/automation/health` |
| 47 | AP-033 | Reorder points from consumption | Inventory movements, packaging jobs, item `reorder_level`, AP-002 | 90-day consumption (stores issues, dispatch-out, scrap-out; completed packaging jobs) × (lead time + safety days) = suggested point; × review days = reorder quantity. Lead time is entered by stores; without it, 14 days of history or any use the suggestion stays blank. Stores approves (reason required when changing the suggestion); only approved points raise nightly requisition proposals; purchase accepts with an editable quantity → requisition + task | `/inventory/reorder` |
| 48 | AP-053 | NCRs from rejections | Quality inspections, rework resolutions, job rejected weight, receipt lines, billet issues, sample readings | QC-head thresholds (job %, job kg, receipt %). Hourly job drafts one NCR per job or receipt above threshold with linked job, die, profile, billet lots, inspections and readings. A customer complaint logged on the order drafts an NCR at once. QC confirms, records cause and action, closes, or dismisses with a reason. Coverage counts jobs above threshold against NCRs | `/quality/ncrs`, order record (complaint form) |
| 50 | AP-077 | Customer TDS reconciliation | Canonical receipt writer (`post_financial_receipt_atomic`), invoices, customers | TDS per invoice recorded through the receipt writer (so balances settle in one ledger), with a register by customer, financial year and quarter. "Invoices open only by TDS" lists part-paid invoices whose balance equals the configured TDS. Form 26AS / AIS CSV import (original kept, rows matched by TAN, quarter, section and amount) | `/payments/tds` |
| 51 | AP-082 | E-invoice JSON and IRN import | Issued invoice snapshots, HSN, GST state codes | Accounts confirms applicability first. Issued B2B invoices export as IRP schema 1.1 JSON (validated; unmappable invoices skipped with reasons). The IRP/GSP response is parsed and each IRN cross-checked with its signed QR before it is saved once per invoice; the invoice PDF prints IRN, acknowledgement and the signed QR | `/invoices/einvoice`, invoice PDF |
| 52 | AP-029 | Billet length per job | Press master (no billet limits existed), die extrusion ratio, profile kg/m and billet diameter | Press billet limits (shortest/longest/standard billet, container bore, butt, run-out, crops, saw step). Optimiser in `lib/calculations/billet-length.ts`: mass balance, run-out fit, whole pieces; options per piece count with recovery. Planner picks a listed length; the server rechecks limits and that inputs did not change. Last-20 recovery against the standard length | Production job record, `/production/billet-length` |
| 53 | AP-094 | Offline phone queue | Batch 2 station tap queue (localStorage), idempotent push IDs | IndexedDB queue per employee with request IDs; `public.ap_offline` records each request with its effect in one transaction, so a retry after a lost response posts nothing twice. Business refusals become conflicts the employee resolves; connection failures retry in order. Wired into press pushes, loading scans, QC sample readings and bundle capture | Press workstation, loading station, sample record, bundle capture |
| 54 | AP-061 | Overnight draft press plan | Factory planning (shift capacity, maintenance blocks, press slots, schedule writer), order line promises | Nightly heuristic for the next working day: promise date, urgency, alloy/temper and die grouping; same-die-same-press preference; shift capacity, maintenance windows and die exclusivity; partial placement. Each line has reasons; unschedulable jobs list why. Planner edits (counted), adds or removes lines, then publishes through the existing `commit_factory_schedule_move` writer, all or nothing | `/production/schedule/draft` |

## Per-feature recheck, tests and audit

| ID | Recheck against System does / Build / Guardrails | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-027 | Met. Nightly job `dies.weight_drift`; drift in `lib/calculations/section-weight.ts`, mirrored in SQL and compared in tests. Master weight never changed by the proposal | 2 SQL + 2 unit + 2 browser | The schema already forbids a die without a profile and a non-positive master kg/m, so "master missing" is unit-tested only |
| AP-030 | Met. Draft/internal-review only; issued snapshots and sent quotations untouched | 2 SQL + 2 browser | Found the existing owner/admin-only guard on priced quote lines: applying is owner/admin; others read the impact list. The header is re-derived by the existing triggers, not by a copy of the formula |
| AP-100 | Met for jobs, proposals, exports and errors. Backups: not readable from the database (recorded, not faked) | 1 SQL + 2 browser | None |
| AP-033 | Met. Levels trigger nothing until approved | 2 SQL + 2 unit + 2 browser | UI kept the old (blank) inputs after the lead time produced a suggestion; rows now remount on a new suggestion and report above the list |
| AP-053 | Met. Threshold set by QC; drafts are records the system prepares, confirmed or dismissed by QC | 2 SQL + 2 browser | None |
| AP-077 | Met. Rates and sections are accounts settings with a no-tax-advice note; the system records what was deducted | 1 SQL + 1 unit + 2 browser | Success message was lost when the list refreshed; reversed TDS receipts would still have counted in the register — now excluded (regression test) |
| AP-082 | Met. Applicability gate; issued snapshots used; IRN stored separately, never edits the invoice | 1 SQL + 3 unit + 2 browser | `react-dom/server` is not allowed in route handlers, so the QR encoder bundled in qrcode.react (Project Nayuki, MIT) is vendored at `lib/qr/qrcodegen.js`; a test proves module-for-module equality with qrcode.react's own output |
| AP-029 | Met within press limits; recommended length is never worse than the standard length when the standard fits | 1 SQL + 2 unit + 2 browser | A standard length that overruns the table was shown as an option with 0% recovery; it is now excluded and labelled "does not fit" |
| AP-094 | Met for the four listed entry types | 2 SQL + 1 unit + 2 browser (Playwright offline/online) | Old localStorage taps are adopted into the new queue with their IDs. The first full run showed that importing the bundle action from the shared hook pulled a server module into other screens' bundles; the hook core (`offline-core.tsx`) now takes its transport from the screen. A refusal while the employee is watching is shown on screen and closed server-side; only entries sent later from the queue become conflicts |
| AP-061 | Met; existing plan validation runs on publish (capacity, maintenance, die, press) | 3 SQL + 2 browser | The draft screen crashed before any draft existed; fixed |

## "Done when" recheck

| ID | Done when | Met? | Exactly what is missing |
| --- | --- | --- | --- |
| AP-027 | Each active die shows actual vs theoretical kg/m trend | Built: die record trend + list of every active die | Needs weighed production bundles and QC's factory tolerance (or profile tolerances) |
| AP-030 | A rate change updates all drafts in one action with a printable impact list | Yes | Only owner/admin can apply (existing priced-line guard) |
| AP-100 | A failed job is visible on the page within one run window | Yes (read live from the run ledger; overdue/never-run also flagged) | Backup status must still be checked in the Supabase dashboard |
| AP-033 | Each active consumable has an approved reorder point | Coverage shown ("x of y approved") | An operating result: stores must enter lead times and approve. Billets are covered by AP-062 by alloy/diameter, not here |
| AP-053 | Rejects above threshold always have an NCR or a recorded dismissal | Detection + coverage built | QC head must set thresholds; jobs are examined for 60 days back, receipts 60 days |
| AP-077 | No invoice is open only because of unrecorded TDS | "Invoices open only by TDS" list built | Needs the default section and rate from accounts and customer TANs for statement matching |
| AP-082 | IRN and QR appear on invoices without retyping | Yes, after import of the IRP/GSP response | Upload to the IRP stays manual (no GSP API connection); IRN cancellation is not handled |
| AP-029 | Planned recovery improves on a sample of 20 jobs vs standard length | Last-20 comparison built | Needs press limits from the plant and 20 planned jobs; not yet measured |
| AP-094 | An entry made offline posts exactly once after reconnecting | Yes (SQL replay test + Playwright offline test) | Pages must be loaded while online first; there is no service worker |
| AP-061 | Planner publishes with fewer than five edits on a typical day | Edits counted per draft; last-10 summary built | Needs shift capacities, promise dates and two weeks of use to measure |

## Scope boundaries

- Nothing automatic posts stock, money, quality approval or a customer message. Jobs prepare drafts and proposals; reprice, TDS recording, NCR confirmation, requisitions, IRN import and plan publication are explicit employee actions.
- AP-030 applies to draft and internal-review quotations; approved-for-sending quotations are listed, not changed (their approval was on the old price).
- AP-033 covers stores items and packing materials. Billets stay with AP-062 (alloy/diameter forecast). Supplier lead time is not inferred because purchase lines are not linked to items.
- AP-053 creates its own NCR record (there was none). Customer complaints are logged on the order record.
- AP-077 records TDS as a non-cash receipt (`other`) through the canonical writer; reversing it uses the normal receipt reversal, which the register then excludes. Collections reports include the TDS settlement amount.
- AP-082 has no GSP/IRP API connection and no IRN cancellation flow.
- AP-094 has no service worker; screens must have loaded once. Bundle capture still needs its material sources loaded online.
- AP-061 drafts only jobs without a slot and never moves published slots; one slot per job (larger jobs are placed partially).

## Data and security audit

Migration `supabase/migrations/20261114100000_autopilot_batch_6.sql` (additive, one file). 23 new tables, each with `company_id` (or company-scoped primary key), RLS, one role-scoped read policy and a company-leading index; no client insert/update/delete grants. One read grant: `invoice_irns` to `authenticated` (RLS-limited to owner, admin, accounts, sales manager, viewer) so the invoice PDF prints the IRN. Ten gateways (`ap_weight`, `ap_reprice`, `ap_health`, `ap_reorder`, `ap_ncr`, `ap_tds`, `ap_einvoice`, `ap_billet_length`, `ap_offline`, `ap_press_plan`) take company and actor from `auth.uid()`, refuse dealers, check roles per command and pin `search_path`; private helpers are not client-executable. The AP-002 functions (`ap_proposal_versions/_editable/_apply`) and AP-001 registry/executor are extended by rename-and-wrap, as in batches 1–5. `ap_offline` dispatches only to an allow-list (press push, loading scan, sample record) and stores a refusal as a conflict inside a subtransaction so the effect and its receipt commit together. The AP-030 trial update clears the session identity only inside a block that is always rolled back.

Customer-facing outputs are unchanged. Vendor/customer messages, the e-invoice file and the IRN contain no cost, margin or supplier rate; the repricing impact list is internal (marked so).

Server-side validation: Zod schemas in `lib/autopilot-batch6/commands.ts` and `lib/actions/autopilot-batch6.ts`; offline entries are validated as the command they carry. No new dependency (the vendored QR encoder is the code already shipped inside qrcode.react).

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | 304/304 files, 0 failures |
| tests/autopilot-batch6-sql.test.mjs | 12/12 (AP-027, 030, 100, 033, 053, 077, 082, RLS/grants/registry) |
| tests/autopilot-batch6-floor-sql.test.mjs | 6/6 (AP-061, 029, 094) |
| tests/autopilot-batch6.test.mjs | 10/10 units (optimiser, drift, reorder, e-invoice, IRN/QR, statement CSV, offline queue, schemas, QR parity) |
| tests/autopilot-batch6-browser.test.mjs | 14/14 at 375 and 1280 px; screenshots in `docs/evidence/AUTOPILOT_BATCH_6` |
| tests/autopilot-batch6-floor-browser.test.mjs | 6/6 at 375 and 1280 px, including Playwright offline → online push |
| npm run typecheck | Passed |
| npm run lint | Passed, 0 errors, 0 warnings |
| npm run build | Passed; all 11 new routes compiled |
| Full npm test | 3,528 / 3,529 (see "Full suite") |
| In-app browser | Preview `autopilot-batch6-screens` (real screens and gateways on replayed local SQL, synthetic records): section weight, die trend, repricing, health, reorder, NCR record and TDS at 1280 px and 375 px; no console errors; no page-level horizontal scroll (wide tables scroll inside their cards) |

### Full suite

| Run | Result |
| --- | --- |
| First full run | 3,529 tests, 3,415 passed, 114 failed. Causes: the shared offline hook pulled a server module into ten older browser-test bundles; four registry/grant/migration-order invariants needed batch 6; one OneDrive file lock on an older screenshot. All fixed; every failing suite rerun green |
| Final full run | 3,529 tests across 76 suites: **3,528 passed, 1 failed**, 0 skipped, 0 cancelled (16 min). `npm run build` passed again afterwards |
| The one failure | `nov-batch5-sql` NOV-069 "vendor rates are not projected": the test checks that the serialized row contains no "210" (the fixture's vendor rate). It passed 7 of 7 times when rerun alone and as a whole file, and fails only late in the full run, which fits a time-dependent value in that row containing "210". Batch 6 does not touch the purchase-receipt assurance views. Left unchanged and recorded here; the check could be made field-specific in a later fix |

### Changes to earlier tests

Registry and grant invariants in earlier suites were updated for batch 6, as batch 5 did: `autopilot-batch1-sql` (client-callable gateway list; nightly runs 22 = 11 nightly jobs × 2 fixture companies), `autopilot-batch5-sql` (23 registered jobs), `nov-batch9` (migration-order prefix 20261114). The batch 2 browser fixture's offline switch now also covers taps sent through `ap_offline`, and the station's queue message keeps the wording "1 tap(s) waiting to send from this station."

## File inventory

| Area | Created | Modified |
| --- | --- | --- |
| Database | `supabase/migrations/20261114100000_autopilot_batch_6.sql` | None |
| Library | `lib/autopilot-batch6/commands.ts`, `lib/actions/autopilot-batch6.ts`, `lib/calculations/{section-weight,reorder-point,billet-length}.ts`, `lib/compliance/e-invoice.ts`, `lib/financials/tds-statement.ts`, `lib/offline/queue.ts`, `lib/pdf/qr-modules.ts`, `lib/qr/qrcodegen.js` (vendored) | `lib/actions/autopilot.ts`, `lib/jobs/registry.ts`, `lib/proposals/proposals.ts`, `lib/pdf/invoice-pdf.ts` |
| Screens | `components/modules/autopilot-batch6/*` (weight, reprice, health, reorder, ncr, tds, einvoice, billet-length, press-plan, shared), `components/modules/offline/{offline-core,offline-queue}.tsx`; pages `dies/weight-drift`, `quotes/reprice` (+`[id]`), `automation/health`, `inventory/reorder`, `quality/ncrs` (+`[id]`), `payments/tds`, `invoices/einvoice`, `production/billet-length`, `production/schedule/draft` | Die, job and order records; dies, automation overview; loading, bundle and sample pages; press station, loading station, sample record, bundle capture, proposal cards, module links; invoice PDF route |
| Verification | `tests/autopilot-batch6{,-sql,-floor-sql,-browser,-floor-browser}.test.mjs`, `scripts/lib/autopilot-batch6{,-browser}-fixture.mjs`, `scripts/autopilot-batch6-preview.mjs`, screenshots `docs/evidence/AUTOPILOT_BATCH_6` | Earlier invariant tests and the batch 2 browser fixture (above) |

## Hosted migration state

Not applied. Apply `supabase/migrations/20261114100000_autopilot_batch_6.sql` to `AlExMS` only when authorised. After applying, pg_cron's existing hourly/nightly windows pick up the five new jobs (`dies.weight_drift`, `quotes.reprice_check`, `stock.reorder`, `press.plan_draft` nightly; `quality.ncr_detect` hourly).

## Remaining acceptance

QC sets the factory weight tolerance and NCR thresholds; stores enters supplier lead times and approves reorder points; accounts sets TDS sections, the default rate and customer TANs, and confirms e-invoice applicability; production enters press billet limits and shift capacities. Then: a week of drift reviews, two weeks of overnight plans (count edits), 20 billet-length choices against the standard length, a real IRP round trip printing the QR, a quarter's 26AS import, and a phone used through a Wi-Fi drop on the floor.
