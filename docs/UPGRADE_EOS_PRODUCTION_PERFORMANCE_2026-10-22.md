# Production performance, order progress and finishing area (features 6, 84, 89, 91, 92)

Date: 22 October 2026. Branch: `feat/upgrade-eos-calc-batch` (worktree `.worktrees/eos-calc`, based on `800b27e`). Produced by an unattended scheduled run; nothing was committed, pushed, deployed or applied to hosted Supabase.

Status: implemented, unit/edge tested, gated locally and visually checked with Playwright on the actual components (synthetic data, no auth or database). Signed-in operator trials are pending, so the catalogue checkboxes stay open.

Batch 1 (features 89, 91, 92) is commit `0228e59`. Batch 2 (features 6 and 84, plus the Playwright acceptance) follows it.

## Delivered scope

| Feature | Working behaviour | Boundary |
| --- | --- | --- |
| 89. Planned billet input and billet count | The production form's billet allocation section explains `planned input kg = planned good output / expected recovery` and, when every compatible billet has the same weight, `billets = ceil(input / billet kg)`. It also states whether the selected billets' nominal weight covers the planned input. | The count is a planning explanation. The existing "Required billets" field and server allocation rules are unchanged. |
| 91. Production performance from actual transactions | Production job detail shows issued input, recovery, scrap % and plan attainment. Input uses the same billet statuses (`allocated`, `issued`, `consumed`) and measured-else-nominal weight as `complete_production_job_with_scrap_atomic`, and says how many billets are measured vs nominal only. | Missing input, unreadable scrap postings or more than 200 scrap rows show **Not captured**. A recorded zero output is 0%. Output per operating hour is not shown: jobs have no recorded operating time. |
| 92. Material discrepancy calculation | Completed jobs show `input - (good output + measured scrap)` as a signed difference. Any non-zero difference stays visible, labelled within/outside the completion tolerance (larger of 0.5 kg and 1% of input, as in the database). The completion form previews the same balance, including scrap posted earlier. | Report only: nothing is booked as scrap. Reversed scrap postings are excluded and listed. The calculation accepts work in progress, returns and other classified lines, but jobs have no source records for them yet. |

| 6. Connected order workspace | Order detail gains an Order Progress section. Per line it shows ordered kg, dealer stock (uncredited), open production plans, completed output and still-to-plan kg, on the same basis as `private.guard_production_order_balance`, with links to each production job. For the whole order it shows dispatched pieces, metres and net kg from verified packing history, plus remaining pieces and metres. | Internal sessions only; job links only for roles that can read production. Over-commitment is flagged instead of a negative balance. Jobs without a valid order line are listed separately and not counted. More than 200 jobs, a failed job read or unverifiable packing shows as unavailable, never zero. Dispatch cannot be split per line: packing records reference source material, not order lines. |
| 84. Finishing area and finishing charges | Per-sq-ft quote lines explain area m2 = total metres x coating perimeter / 1,000, the sq ft conversion and rate x area. The explanation reuses the quote calculation, so it equals the costed finishing charge. | A missing perimeter shows an incomplete-cost alert, never a zero charge; the existing send-blocking warning is unchanged. Minimum-charge rules are not implemented: there is no approved minimum-charge data. |

Shared logic: [`lib/orders/order-progress.ts`](../lib/orders/order-progress.ts), `explainFinishingArea` in [`lib/calculations/quote.ts`](../lib/calculations/quote.ts), and [`lib/calculations/production-performance.ts`](../lib/calculations/production-performance.ts). The UI reads the same functions; no business arithmetic was added to components.

## Defects found and fixed while auditing

1. **Billet count rounding (real over-allocation).** `calculateRequiredBilletCount(700, 25, 70)` returned **41** because `700 / 0.7 = 1000.0000000000001` in floating point. Both the shared count and the new plan now strip floating-point noise before rounding up, so this returns 40. The fix affects the production-form autofill and the quotation-to-order billet preview, which both call the shared function.
2. **Linked billet input on the job page included cancelled and scrapped billets.** The floor message "must reconcile to X kg" could disagree with the input the completion transaction actually checks. The page now uses the transaction's statuses.
3. **`planAttainmentPercent` turned a missing actual into 0%.** It now returns null (Not captured) for missing or negative actuals and keeps a recorded 0 as 0%. Nothing in the product called it; the regression test still passes.

## Audit findings left open (need a business decision)

- **Quotation-to-order billet preview** (`components/modules/orders/quote-order-form-client.tsx`) sizes physical billet demand from `billing_weight_kg`, which includes minimum billing weight. It also assumes 75% recovery and a 5.8 m billet. Feature 89's acceptance says minimum billing weight must not raise manufacturing demand. The factory-minimum check (700 kg) uses the same basis, and the server enforces it, so the basis was not changed unilaterally.
- **Quote costing** (`lib/calculations/quote.ts`) also derives `billet_input_kg` from billing weight. This is a commercial costing choice. It is left as is and recorded here.
- **Production form autofill of "Required billets"** reads `form.billet_weight_kg`, which the production form never defines, so autofill always leaves the count unchanged. The new billet plan explains the count instead. Wiring a billet-weight basis into autofill needs an approved billet specification source; the compatible-billet list loads asynchronously and can be stale at autofill time.

## Previously delivered features: audit for this run

- Full suite on the base commit before changes: **1,918 tests, 76 suites, 0 failures**.
- Spot checks: no server action or API route takes `company_id` from client input; the service-role client is used only in `lib/supabase/admin.ts`, the invite-acceptance route and rate limiting; browser storage reads are wrapped in try/catch; the collaboration API rejects non-JSON and cross-origin requests and maps database errors to sanitised messages.
- The length-unit parser (feature 11) was reviewed for decimal trimming and exact feet/inch factors. No defect found.
- Features recorded as pending visual acceptance (4, 15, 22, 23, 32, 33, 41, 42, 47, 50, 83, 90) were not visually re-inspected in this unattended run.

## Playwright visual acceptance

[`tests/production-order-acceptance-browser.test.mjs`](../tests/production-order-acceptance-browser.test.mjs) bundles the actual components with esbuild and the app's Tailwind build, and mounts them in headless Chrome at 1280 x 900 and 375 x 812 with synthetic recorded data. Server actions are replaced by capture stubs; no auth or database is involved. It asserts the displayed figures, honest unavailable states, that typing never submits completion, and that the page never scrolls horizontally. Set `PRODUCTION_PERFORMANCE_EVIDENCE_DIR` to save screenshots.

The screenshots below were inspected. One defect was found and fixed: kg values wrapped mid-number in the order-progress table on desktop.

| Screen | Desktop | Phone |
| --- | --- | --- |
| Performance and balance (unaccounted within tolerance) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/panel-unaccounted-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/panel-unaccounted-phone.png) |
| Reversed scrap excluded | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/panel-reversed-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/panel-reversed-phone.png) |
| Manager input exception | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/panel-input-exception-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/panel-input-exception-phone.png) |
| Completion balance preview | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/completion-preview-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/completion-preview-phone.png) |
| Billet plan | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/billet-plan-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/billet-plan-phone.png) |
| Order progress | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/order-progress-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/order-progress-phone.png) |
| Finishing area | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/finishing-area-desktop.png) | [png](evidence/UPGRADE_EOS_PRODUCTION_PERFORMANCE_2026-10-22/finishing-area-phone.png) |

The fixture page uses the browser's default serif font rather than Plus Jakarta Sans, so typography differs from the app.

## Verification

| Gate | Result |
| --- | --- |
| Focused: `production-performance`, `foundry-billet-stock`, `business-logic-regressions` | 32 passed |
| `npm test` (full) | **1,931 passed**, 76 suites, 0 failed (baseline 1,918 + 13 new) |
| Batch 2: `npm test` (full) | **1,940 passed**, 76 suites, 0 failed (adds 8 feature 6/84 unit tests and the Playwright acceptance test); lint, typecheck and build passed again |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed (compiled, 160 static pages). The worktree shares `node_modules` through a junction, so this run temporarily pointed `turbopack.root` at the repository root. The override was reverted and is not part of the change. |

New tests cover the catalogue examples (900 kg / 75% / 30 kg gives 1,200 kg and 40 billets; 1,000 - 780 - 180 - 30 WIP gives 10 kg unaccounted; 800/1,000 gives 80%). They also cover floating-point rounding, the tolerance edge (exactly 1% is visible but within tolerance), signed over-recording, missing vs zero inputs, invalid recovery, billet status filtering, reversed scrap exclusion, unreadable or corrupt scrap rows, input-exception jobs and open jobs.

## Files

Created: `lib/calculations/production-performance.ts`, `components/modules/production-performance-panel.tsx`, `tests/production-performance.test.mjs`, this record.

Modified: `lib/calculations/foundry.ts`, `lib/calculations/operations.ts`, `components/modules/production-output-workflow.tsx`, `components/modules/operations/record-form-client.tsx`, `app/(dashboard)/production/[id]/page.tsx`, `UPGRADE_EOS.md`.

No migrations, RLS changes or dependencies were added. New reads (`scrap_records`, `scrap_record_reversals`, `production_input_exceptions`) use existing tenant-read policies and are scoped by `company_id` from the server session.

## Manual acceptance checklist

- [ ] Completed job with billets: recovery, scrap % and the balance line match a hand calculation.
- [ ] Completed job under a manager input exception: input and recovery show Not captured, with the exception noted.
- [ ] Job with a reversed scrap posting: the reversed weight is excluded and listed.
- [ ] In-progress job: entering output and scrap updates the tolerance preview; a value outside tolerance warns before submission.
- [ ] Production form: the billet plan updates with planned kg and efficiency changes, and the selected-billet coverage changes as billets are ticked.
- [ ] Desktop and 375 px widths: the four metric cards stack without horizontal overflow.
