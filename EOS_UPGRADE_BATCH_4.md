# EOS upgrade batch 4

Implementation: 28 October 2026. Final verification: 29 October 2026. Catalogue: `UPGRADE_EOS.md` (called EOSUPGRADE.md in the request).
Development checkout: `.worktrees/codex-v1`, branch `codex/v1`.

## Delivered features

These ten catalogue features are high complexity. This batch connects the commercial-to-factory record flow, using existing authoritative transaction actions for commitment.

| Feature | Delivered behavior and entry point | Unit, edge and integration evidence |
| --- | --- | --- |
| 5 Next valid action | Quote, order, production, dispatch and invoice details show a permitted next operation or explain its prerequisites. Source identity follows the link; conversions and posting retain server guards. | Role/tenant/dealer refusals, invalid IDs, terminal states, source-specific links, actual reviewed quote conversion and existing factory queue. |
| 12 Stock and die suggestions | Quotation lines show eligible and excluded stock, location, remaining quantities and reservations, compatible dies and reasons. Selecting a die retains its source; stock links open its authoritative balance. | Remaining reservations after consumption; QC holds; alloy/temper, finish, stock length and customer-owned dies; changed availability is refused by the existing commitment guard. |
| 28 Conflicting edit protection | Quotation editing retains the originally opened revision and microsecond timestamp. A newer saved version produces a comparison while preserving unsaved lines and notes; explicit reconciliation is required before retrying. | Missing/stale tokens, same timestamp with changed revision, sub-millisecond timestamps, server role masks, browser draft retention and a real atomic save after reconciliation. |
| 34 Confirmed transaction progress | Order details derive completed production, verified departed dispatch, recorded physical returns and net outward from one database snapshot. Finance roles also see issued billing, net receipts, credits and balances. | Planned/pending events excluded; zero versus missing observation; SQL NULL, inconsistent packing and future departure fail closed; physical returns, quarantines, corrected output and reversed receipts; no operational financial exposure. |
| 36 Reusable document links | Quote review and order details link existing approved document revisions with a recorded purpose. Every open rechecks the target, original document audience, lineage, current revision and company storage path. | Duplicate request replay, unrelated/foreign source, superseded and null approval, cost-document privacy, forbidden quote metadata for production, path traversal/encoding and bounded signing. |
| 55 Comparable supplier offers | `/vendors/comparisons` has overview, ten-row searchable/sortable database, requirement creation, offer entry and comparison detail. Normalize units, distinguish unknown/excluded freight, retain unmatched conditions and record a reasoned recommendation. | Mass/length/count conversion, incompatible dimensions, quantity/specification mismatches, dates, freight/GST, exclusions, expired sources, vendor/document scope, exact retries and private rates. |
| 81 Customer and site details | Quote review selects the saved delivery site, previews explicit transaction overrides and records their source. Issuing freezes the party revision; accepted orders and new invoices carry that recorded party. | Master/site/transaction precedence; stale preview refusal; cross-customer/tenant rejection; master changes and reopened drafts cannot rewrite issued party history; invoice immutability. |
| 82 Approved profile specifications | Profile detail links `/profiles/[id]/specifications` for independently reviewed alloy/temper options. Quotation lines show the drawing, section weight, dimensions, perimeter and missing data; sole current choices select automatically, alternatives require a choice. | Self-approval refusal, multiple choices, inactive/changed alloy or temper, stale drawing, source locks, immutable option content and issued-line technical snapshots; actual editor save retains the chosen option. |
| 86 Commercial totals | `/quotes/[id]/review` reconciles saved line amounts, per-line rounded GST, total and separate theoretical/billing quantities. Database recalculation now preserves line-specific tax instead of applying one header rate to all lines. | Mixed GST, saved totals, costing completeness, commercial-basis warnings, no submitted-total override, cost/margin role projection and existing quotation/PDF regression coverage. |
| 87 Accepted quote version to order | Reviewed conversion binds exact accepted quote and line content, party data, terms and specifications. Existing factory/dealer conversion also retains an immutable accepted-source snapshot and checks the version opened by the form. | Changed fingerprint/version refusal, exact retry creates one order, later source edits cannot rewrite the captured agreement, active dealer/role scope and existing minimum factory-load consolidation queue. |

Suggestions are advisory until the existing reservation, production or dispatch action commits them. They do not create inventory movements. Progress does not release a quality hold or change workflow status. Commercial calculation reuses the existing supported quotation rules; this batch does not invent a separate discount or tax engine.

## Database and security

Eight forward migrations were added, in order:

- `20261028100000_commercial_review.sql`
- `20261028110000_quote_party_population.sql`
- `20261028120000_profile_technical_options.sql`
- `20261028130000_material_suggestions.sql`
- `20261028140000_order_transaction_progress.sql`
- `20261028150000_reusable_document_links.sql`
- `20261028160000_supplier_offer_comparisons.sql`
- `20261028170000_accepted_order_source_snapshots.sql`

Nine new business tables store conversion reviews, party drafts and issued snapshots, profile options, reusable links, supplier requirements/offers/recommendations and accepted order snapshots. They have company identity, company indexes and RLS; clients have no direct table grants. Authenticated RPCs derive active company/role from the session, pin their search path and project only permitted fields. Private helpers are not executable by authenticated or anonymous clients. Server actions validate strict inputs and do not expose raw database errors or service credentials.

Document opening rechecks database permission before requesting a 60-second signed URL in the existing documents bucket. It does not broaden the original document's audience. Linking requires an approved revision with target lineage. Supplier source files, when supplied, must be approved documents belonging to the selected vendor. The written supplier reference is always required; file extraction is not part of this batch.

New invoice snapshots follow the accepted source when it was recorded. Existing invoices and orders are not backfilled with reconstructed history. Existing quote conversion overloads remain available for compatibility; the updated application form uses the overload carrying its opened version, while reviewed conversion uses its full content fingerprint. Orders created through all quote-backed paths capture accepted-source content.

**These migrations have not been applied to the hosted database. No deployment or push was performed.**

## Recheck and audit

The feature-by-feature review found and corrected these issues before final verification:

- Passed the browser's original edit token to the atomic save. Refetching a fresh timestamp at save time would have hidden a competing edit. Microsecond precision and revision identity are both retained.
- Kept unsaved notes and lines visible during conflict reconciliation. A cache-refresh failure after a confirmed write no longer reports a failed save or conversion.
- Recalculated draft tax as the sum of rounded line tax, preserving mixed GST. Reviewed conversion reconciles recorded totals before committing.
- Reused the existing factory/dealer conversion path, preserving its minimum factory-load queue instead of bypassing it through generic conversion.
- Made an issued party snapshot immutable even if the quote is reopened. Reissuing the same revision preserves its original party; new invoices retain the accepted party independently of later customer changes.
- Included active alloy/temper values in technical approval fingerprints, locked their sources and rejected inactive profile masters. Independent technical review is permitted without granting general profile-maintenance access.
- Calculated stock availability using remaining reservations after consumption. Unknown provenance, incompatible specifications, QC holds and unowned/incorrect customer dies stay excluded.
- Treated missing and SQL NULL shipment evidence as unavailable. Counted only verified packing with actual departure; quarantined returns do not silently reduce outward movement. Quality exceptions join through their production job.
- Refused null document approval, superseded revision access, raw/encoded traversal and cross-company storage paths. An exact recorded link retry remains a replay even after the source is superseded; opening still rechecks current access.
- Kept unknown freight separate from zero and excluded unmatched offers from recommendation eligibility. Removed an over-broad schema transform, retained explicit command validation and checked optional source-file ownership.
- Marked auxiliary supplier search/paging buttons as non-submitting and added precise accessible labels. Existing quote browser fixtures now mock the newly imported server boundaries instead of pulling server-only dependencies into client bundles.
- Updated the existing customer-entry browser selectors for the quotation notes field's explicit accessible name, retaining all draft-preservation assertions. The navigation fixture now waits for its React portal and final destination before checking focus/scroll state; it no longer races the portal mount.

No unresolved defect from this audit is being accepted as complete. Hosted security behavior, independent database-session contention and real factory data acceptance remain separate proof layers below.

## Files and verification

New shared domain modules are under `lib/workflow/`: `quote-edit-conflicts`, `record-next-action`, `commercial-review`, `quote-party`, `profile-technical-options`, `transaction-evidence`, `linked-documents` and `supplier-comparisons`.

Six new authenticated action modules are under `lib/actions/`: `commercial-review`, `quote-party`, `profile-technical-options`, `transaction-evidence`, `linked-documents` and `supplier-comparisons`.

New components are under `components/modules/quotes/`, `profiles/technical-options.tsx`, `vendors/supplier-comparisons.tsx` and `shared/{record-next-action,transaction-evidence,linked-documents}.tsx`. New routes are quote review, profile specifications and the five supplier comparison pages. Existing quote/order/production/dispatch/invoice/profile/vendor pages connect them; quote validation, saving, conversion and route permissions were updated.

Eight new test files contain 64 tests: `quote-edit-conflicts`, `quote-edit-server`, `record-next-action`, `commercial-upgrade-unit`, `commercial-upgrade-actions`, `commercial-upgrade-sql`, `transaction-progress-sql` and `commercial-upgrade-browser`. Two fixtures are in `scripts/lib/commercial-upgrade-{fixture,browser-fixture}.mjs`. Existing quote browser fixture adapters and the keyboard assertion were updated for the new server boundaries and version token.

Final verification passed on 29 October 2026:

| Check | Result |
| --- | --- |
| `npm test` | 2,668 passed, 0 failed, 76 suites, no skipped/cancelled tests; includes all 64 new tests and ten mounted browser flows |
| `npm run lint` | Passed, no warnings |
| `npm run typecheck` | Passed |
| `NEXT_DIST_DIR=.next-eos-batch4 npm run build -- --webpack` | Passed, 189 pages generated |
| Full-schema SQL/browser fixtures | All 261 forward migration files replayed without failure before fixture tests; actual saved transactions and triggers exercised |
| `git diff --cached --check` | Passed |

The full-suite checkout checkpoint is `9066d437e561d51f5aa8609573d37b073462923ec98c7831aebbcf955b8ea7ce`, unchanged before/after the run (1,386 files under `scripts/verify-upgrade-source.mjs`, including pre-existing untracked local helpers). The tracked source/configuration checkpoint contains 1,373 files: `8371aa5e572d1269e345776e5723bc96170ec3fa07fd6bd941ed2a4ac2f340ac`, based on sorted Git paths, modes and blob identities. This second checkpoint excludes unrelated untracked helpers and is suitable for checking the fast-forwarded root checkout.

Earlier full runs exposed browser selectors and a portal-readiness race that were corrected; those earlier counts are not reused as final proof. Production source is unchanged since the successful build; only the two browser fixture corrections followed it. Build-generated `next-env.d.ts` and TypeScript configuration changes were restored to their original local state. Command output and machine-readable results are retained in [the evidence directory](docs/evidence/EOS_UPGRADE_BATCH_4/verification.json); trailing spaces and excess final blank lines were removed from the copied logs for Git whitespace checks, with the original raw logs retained locally.

Five rendered browser captures are retained in `docs/evidence/EOS_UPGRADE_BATCH_4/`: conflict recovery, commercial review, customer/site review and supplier offer entry at 375 px, plus supplier comparison at desktop width. Actual images were inspected for readable text, controls and table containment. Browser assertions check no page-wide overflow on the exercised phone screens.

Before the feature commit, `codex/v1` was fast-forwarded to the existing `main` audit checkpoint `01466bd`. A scoped preservation stash protected the overlapping audit/generated files during that step. The five pre-existing audit/generated file contents were verified byte for byte afterward; unrelated local documents and acceptance scripts remain outside the feature manifest. No new branch or worktree was created.

The full regression run also regenerated the earlier batch's `docs/evidence/EOS_UPGRADE_BATCH_3/guided-phone.png`. Automatic approval review refused a restore because it would discard working-tree content under the repository instructions. That image remains unstaged in the development checkout and is excluded from this batch; no alternate restoration was attempted.

## Manual acceptance and remaining proof

1. With two authorised commercial sessions, open the same draft, save one, then save the other. The second session must retain its entries and require reconciliation against the latest version.
2. Select a customer/site, preview an override, then change the master in another session. Saving or issuing a stale reviewed party must require a fresh review. An issued invoice must retain its original details.
3. Approve profile options using a different authorised reviewer. Verify sole versus multiple choice, then change the drawing or deactivate a master and confirm new selection is blocked while historical instructions remain intact.
4. Load stock suggestions, introduce a reservation or QC hold in another session and attempt commitment through the ordinary flow. The authoritative action must reject the newly ineligible material.
5. Record confirmed output, verified departure, return disposition and authorised financial corrections. Refresh order evidence and reconcile it to the original transaction records, keeping quality holds independent.
6. Link one approved source file to two eligible records. Test an allowed and denied role, a superseded revision and foreign company identity; every new open must recheck access.
7. Compare supplier offers with different units, freight bases and exclusions. Record a recommendation only after matching conditions and retaining its explanation.
8. Convert an accepted quote from its opened version, retry it, then revise the source. The order and its original source snapshot must remain singular and unchanged; a subminimum factory requirement must retain the consolidation queue.

Local proof includes TypeScript/unit tests, real migration-chain PGlite execution, database role/grant checks, synthetic mounted Playwright flows and a production build. Browser fixtures use a local session/database adapter and synthetic signing; they do not establish hosted Supabase JWT/RLS/Storage behavior or independent-session database locking. Hosted migration rehearsal/application, signed-in role testing, physical stock reconciliation and deployment require their own scoped rollout.

The contextual next-operation panel covers the five core transaction families listed above. Document linking currently targets quotes and orders, with source lineage from profile/die and related commercial records. Supplier comparison supports INR and linear mass/length/count units, records recommendations without purchase-order posting, and leaves missing conditions visible. Historical records without a captured source remain historical evidence gaps rather than reconstructed facts.
