# EOS previously unchecked features: local acceptance audit

Date: 29 October 2026
Base: `cd4f9773d649c95a470d1d528267504146e0795f` on `codex/v1`.
Scope: the 17 entries that had an explicit unchecked delivery marker in `UPGRADE_EOS.md`.

All 17 were exercised with actual components at 1280 and 375 px. The final independent headless Playwright run passed 35 checks and produced 48 screenshots, with no reported browser runtime errors or document overflow. Twelve pending visual gates are closed. Five entries retain their original signed-in operator acceptance requirement: 6, 84, 89, 91 and 92.

The catalogue now has 77 checked delivery records, five unchecked records and 18 features without a delivery record. This is not a claim that all 100 features are delivered or deployed. Each delivery record retains its implemented scope and rollout limitations.

## Evidence boundary

The route checks use a synthetic HTTP Auth/REST fixture with the actual Next.js application. Entry and production checks bundle the actual components with source Tailwind CSS and local Plus Jakarta fonts. Operator write flows use the existing real server actions and database functions against a disposable PGlite database. These fixtures do not establish hosted Supabase JWT verification, live RLS/Storage behavior, concurrent hosted transactions, employee UAT or physical factory reconciliation.

The requested Computer Use skill was attempted, but its Windows policy guard could not determine the current browser URL and stopped native interaction. Automatic approval review also rejected further commands to that stopped interactive session. No more native input was issued. The evidence here comes from fresh, independent headless browsers; they never attached to the stopped desktop session. The separate regression path was permitted and completed.

The user canceled staging after the account had no free Supabase project slot, prohibited Docker, and declined interruption of existing projects. No Supabase staging project was created and no hosted migration or business-data write was applied for this verification. The empty Vercel placeholder `extrusionos-staging` (`prj_oAsi9I4Afu2XaSedtgcXRqEM1Uos`) was created before cancellation. It has no deployment, database, environment secrets or Git connection. The connector has no delete-project mutation and its deletion link requires dashboard confirmation, so it remains an empty placeholder. [Review deletion in Vercel](https://vercel.com/d?to=%2Farnavj19s-projects%2Fextrusionos-staging%2Fsettings%2Fgeneral%23delete-project&title=Review+in+Vercel).

## Feature checks

All paths below are relative to [the evidence directory](evidence/EOS_UNCHECKED_ACCEPTANCE_2026-10-29/). The JSON report lists every check and capture. A representative capture for every feature and the production missing-input states was inspected directly; the runner captured both desktop and phone evidence. Full-page fixed overlays can appear in the middle of the image because their position is relative to the captured viewport.

| Feature | Verified behavior | Evidence example | Remaining acceptance |
| --- | --- | --- | --- |
| 4: Work context | Real Next routes restore the exact filtered page-two URL and scroll after opening an order; another user/company cannot see the saved view. | `f4-order-return-1280.png` | Local visual gate closed. |
| 6: Order progress | Recorded line and job progress, whole-order packing totals, remaining pieces/metres and unlinked work are visible at both widths. | `f6-order-375.png` | Signed-in operator trial; dispatch remains whole-order because packing lacks order-line identity. |
| 15: Actionable alerts | Exact source link, read receipt, resolved source history and unavailable-source handling remain distinct. | `f15-resolved-source-375.png`, `f15-source-unavailable-375.png` | Local visual gate closed; hosted rollout separate. |
| 22: Customer aliases | Customer-code creation/deactivation retains history; ambiguous quotation aliases require a canonical selection. | `f22-ambiguous-code-375.png` | Local visual gate closed; hosted rollout separate. |
| 23: Spreadsheet entry | Mixed valid/unknown rows cannot partially import; correction appends all lines atomically to the draft, with mm-to-m conversion. | `f23-unmatched-preview-375.png` | Local visual gate closed. |
| 32: Physical location | A reasoned move keeps previous/new locations and leaves stock at 420; die guidance remains visible. | `f32-recorded-move-375.png` | Local visual gate closed; physical rack reconciliation and hosted rollout separate. |
| 33: Production exceptions | Lost-response retry creates exactly one attributed exception and keeps the job in progress. | `f33-uncertain-retry-375.png` | Local visual gate closed; photos/automatic holds remain outside delivered scope. |
| 41: Record previews | Preview issues no extra query, retains URL, omits internal fields and restores focus on Escape; a long identifier remains readable. | `f41-long-identifier-375.png` | Local visual gate closed. |
| 42: Column preferences | Actual accounts/dispatch defaults differ; show/hide, reorder and width persist on reload; controls are accessible beside the sidebar and on phones. | `f42-accounts-defaults-1280.png`, `f42-phone-controls-375.png` | Local visual gate closed; existing projection migration still needs hosted rollout. |
| 47: Customer promises | Original date survives rescheduling with a reason; history and completed outcome are retained. | `f47-retained-deadline-375.png` | Local visual gate closed; hosted rollout separate. |
| 50: Data source and age | Old observation date remains old after refresh; failure cannot advance successful fetch time; source details fit inside the phone card. | `f50-old-observation-375.png`, `f50-failed-refresh-375.png` | Local visual gate closed. |
| 83: Theoretical profile weight | 100 x 6 m x 0.8 kg/m gives 480 kg; changed length, manual override and missing kg/m are distinct; no business posting occurs. | `f83-theoretical-375.png` | Local visual gate closed; master-data suitability requires the factory. |
| 84: Finishing area | 600 m x 250 mm gives 150 m2 / 1,614.587 sq ft; rate and charge agree; missing perimeter is incomplete cost. | `f84-finishing-375.png`, `f84-missing-perimeter-375.png` | Signed-in operator trial; approved minimum-charge policy remains absent. |
| 89: Planned billet input | 900 / 75% = 1,200 kg; 30 kg compatible billets require 40, and selected 1,140 kg is short. The actual quote-order review separates 480 physical kg from 700 billing kg. | `f89-billets-375.png`, `f89-physical-commercial-review-375.png`, `billet-basis-after.json` | Signed-in operator trial, hosted migration and existing automatic-allocation assumption review. |
| 90: Geometric billet weight | Dimension displays change without changing mass; formula/source/precision are visible; missing density has no estimate. | `f90-geometry-375.png` | Local visual gate closed; company approval of density assumptions remains separate. |
| 91: Production performance | Linked measured/nominal input, recovery, non-reversed scrap, plan attainment, missing evidence and recorded zero remain distinct. | `f91-performance-375.png`, `f91-missing-input-375.png` | Signed-in operator trial; no approved job operating-time allocation exists. |
| 92: Material discrepancy | Reversed scrap is excluded; signed discrepancy stays visible inside tolerance; completion preview reports the excess and performs no posting. | `f92-reversed-375.png`, `f92-completion-preview-375.png` | Signed-in operator trial; WIP/return calculations still lack job-level source records. |

## Defects corrected and rechecked

1. **Feature 23, phone paste grid.** An editable wide preview expanded the page to approximately 850 px on a 375 px viewport. Explicit `minmax(0,1fr)` grid constraints keep scrolling inside the preview. The region is focusable and has a scroll hint. A regression checks page bounds, invalid-row refusal and keyboard horizontal scrolling.
2. **Feature 42, clipped column picker.** The card overflow boundary and sidebar clipped an absolutely positioned picker. A fixed portal follows its anchor, clamps to viewport bounds, chooses space above/below, handles scroll/resize, dismisses outside and returns focus on Escape. Regression checks exercise actual controls and persisted width.
3. **Feature 50, clipped source evidence.** A document-width assertion missed content clipped inside a phone card. Grid and flex minimum sizes are now bounded, long identifiers/source references wrap, and expanded details use the card width. The regression checks both page and card `scrollWidth`.
4. **Feature 89, physical versus commercial demand.** Actual save/review/convert SQL reproduced a 480 kg physical quotation with 700 kg billing weight becoming a 700 kg manufacturing order. The before/after JSON artifacts retain this evidence. New conversions now use recorded physical line quantities, while order value and accepted commercial snapshots retain billing quantities. The quote-order form shows both bases and rejects missing physical weights.

The shared browser fixture now keeps its search-parameter object stable, and the route fixture uses webpack. Capture code scrolls through full pages and waits for viewport-triggered quantity tickers, so screenshots show settled recorded values rather than animation intermediates. These are verification-support changes.

The first full run passed 2,758 of 2,759 tests and exposed an existing time-dependent setup defect in `tests/subscription-sql.test.mjs`. At 23:00 IST, the requested next daily hour wraps to midnight; the first check correctly delivers the queued event. The next case reset the delivery timestamp but supplied no new event and incorrectly expected another digest. A fresh packing observation now makes the current-hour case independent. The unchanged production digest logic then passed all 13 focused tests. `digest-before.txt`, `digest-after.txt` and `tests-before-clock-fixture-fix.txt` preserve this investigation; the final full-suite result is recorded below.

## Database and authorization audit

Added migration: `supabase/migrations/20261029100000_quote_physical_manufacturing_basis.sql`. It adds a version marker with default 0; existing orders retain their recorded planning basis. Only new quote conversions opt into version 1. No historical row backfill, deletion, RLS disablement or client-company input was introduced.

The migration patches reviewed expressions in the existing functions with exact prerequisite match counts and fails on drift. It preserves their signatures, locking, authorization gates and financial snapshots. New helpers have pinned search paths, use invoker rights and revoke execution from PUBLIC, anon and authenticated. The sales conversion fix permits only a derived billet-summary update inside the existing transaction-specific quote authorization, with counters checked against actual requirement rows. It cannot change financial fields or invent counts/stages. Direct sales table writes remain rejected.

The downstream billing basis was also rechecked: the existing quote/invoice rate-basis migration derives the shipped-kg rate from the commercial line amount divided by physical kg, and retains separate charge handling. Reducing manufacturing demand to its physical basis does not replace that commercial amount with the billing-weight rate. This audit does not apply a new invoice or tax policy.

New tests cover mixed physical/billing quantities, missing/nonfinite weights, authenticated sales conversion and exact retry, legacy requirement rebuild, mixed profiles, full dealer fulfillment and zero manufacturing demand, private helper grants, and forged summary updates. Browser tests prove the form sends neither company ID nor a client-supplied manufacturing quantity.

The existing automatic order allocator still contains its historical 75% recovery, 5,800 mm length and density assumptions. This change removes those assumptions from the quotation form and fixes physical quantity derivation; it does not invent or approve a new factory allocation policy. Production entry explains the selected compatible billets and recorded recovery separately. Hosted application of this migration has not occurred.

## Executed checks

| Command | Result | Evidence |
| --- | --- | --- |
| `node --no-warnings --experimental-strip-types scripts/verify-eos-unchecked-headless.mjs` | 35 passed; zero failed; 48 captures; 17 features | `headless-verification.json`, `browser-checks.txt` |
| `node --no-warnings scripts/replay-migration-chain.mjs` | 271/271 applied; zero failures (269 migrations plus two baseline files) | `migration-replay.txt` |
| `npm run lint` | Passed | `lint.txt` |
| `npm run typecheck` | Passed | `typecheck.txt` |
| `npm run build -- --webpack` with `NEXT_DIST_DIR=.next-eos-unchecked` | Passed; 194/194 static generation tasks | `build.txt` |
| `npm test` | 2,759 passed across 76 suites; zero failures, skips or cancellations | `tests.txt` |

The first build compiled and completed TypeScript, then the filesystem sandbox denied a prerender directory creation. The filesystem-authorized build passed with the local fixture stopped and a dedicated output directory. No Docker command is part of the final verification workflow.

New/strengthened regression coverage is in `tests/entry-acceptance-integration.test.mjs`, `tests/quote-physical-demand.test.mjs`, `tests/quote-physical-demand-sql.test.mjs` and `tests/quote-physical-demand-browser.test.mjs`. Existing operator action/SQL/browser, production performance, order progress, notification, workspace and column preference tests are included in the full suite.

To reproduce the route screenshots, first run `node --no-warnings --experimental-strip-types scripts/serve-my-work-fixture.mjs` in a separate terminal, then run the headless verification command from this checkout. The runner creates and closes its other fixtures automatically. Stop the route fixture afterward. Its `3580`/`3581` services use synthetic responses and the separate `.next-my-work` development output. The normal full test suite does not require that service.

## Remaining signed-in checklist

- Entry 6: an authorized employee opens an actual order with linked jobs and packing, reconciles the displayed progress with its recorded transactions and exercises unavailable-source handling.
- Entry 84: an authorized employee reviews actual coating perimeter/rates and missing-perimeter behavior; any minimum-charge policy must be approved before implementation.
- Entry 89: an operator reviews actual recovery and compatible billet weights, plus new physical-demand conversion after the reviewed migration is rolled out; factory allocation assumptions require an explicit approved policy.
- Entry 91: an operator reconciles a real job's linked input, output and reversals; unavailable evidence must remain unavailable. Operating-hour performance needs an approved source/allocation.
- Entry 92: an operator reconciles a real job's discrepancy and authorized completion/correction. Missing WIP/return sources must not be fabricated or booked as scrap.

These five checkboxes remain unchecked. The completed local evidence does not substitute for those trials.

## Change manifest

Product files modified: `components/modules/quotes-client.tsx`, `components/ui/table-column-preferences.tsx`, `components/data/data-table.tsx`, `components/ui/data-freshness.tsx`, and `components/modules/orders/quote-order-form-client.tsx`.

Product files created: `lib/orders/quote-physical-demand.ts` and the migration named above. Test files created: `tests/quote-physical-demand.test.mjs`, `tests/quote-physical-demand-sql.test.mjs`, and `tests/quote-physical-demand-browser.test.mjs`. The existing entry integration test was strengthened and gained two regressions.

Verification files created: `scripts/verify-eos-unchecked-headless.mjs`, `scripts/audit-billet-planning-basis.mjs`, `scripts/lib/production-visual-fixture.mjs`, and `scripts/lib/quote-physical-browser-fixture.mjs`. Existing `scripts/lib/entry-acceptance-browser-fixture.mjs`, `scripts/serve-my-work-fixture.mjs`, and `scripts/visual-entry-acceptance.mjs` were adjusted as described above. Generated Next.js declarations/config include the dedicated production-build output, without retaining the temporary route-fixture types.

`UPGRADE_EOS.md`, this audit and its evidence directory record the resulting status. `source-checkpoint.json` records LF-normalized UTF-8 SHA-256 hashes of the changed code/configuration tested here. Unrelated audit documents, prior batch screenshots, local-acceptance helpers and the pre-existing dirty TypeScript cache were excluded from commits. Changes are committed locally per corrected feature, followed by a digest-fixture correction and one verification/evidence commit; nothing is pushed.

Local correction commits: `0093508` (23), `4a8430a` (42), `a61ee2b` (50 and shared entry regressions), `d0fd4e1` (89), and `5fcdfd7` (daily-digest test setup). The final evidence commit is the descendant that adds this audit and the updated catalogue.
