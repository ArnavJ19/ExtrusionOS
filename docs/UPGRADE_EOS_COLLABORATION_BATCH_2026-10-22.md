# Five quotation and collaboration upgrades

Date: 22 October 2026. Implementation commit: `8b4a63da1206b1bbcf605dd270c866b3eecabe50`.

Status: **complete for the delivered implementation scope and local acceptance**. Implementation, focused/regression checks, audit, desktop/phone/PDF visual inspection, hosted migrations and all four final development checks passed. Features 8, 11, 46, 62 and 74 are marked complete in `UPGRADE_EOS.md` with their scope stated explicitly.

The final development checkpoint is `codex/v1` at `1ff7586c6cd56a6954bb9e90f462f0936c3590b6`, with the existing uncommitted PDF/report and acceptance work preserved. All 37 files owned by this batch match the implementation commit. The root checkout moved to the separate migration-repair branch at `d31f16166c2f2c6420d9b703edfa88863deb872c` while verification was paused; its independent full suite passed 1,918 tests across 76 suites. That result is recorded separately from the development checkout's broader suite.

Before/after manifests match for all **1,232 source/configuration/captured-schema files**. Aggregate source SHA-256: `99cb343f8f9ede9ec3b807c23339832f95fb47335a98e001dacf0876500f72d9`. [Exact source manifest](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/verified-source-manifest.json). Documentation and generated media are outside that source digest. The final tests exercised the preserved working tree, including its existing PDF/report work; those unrelated edits are not included in this batch's commits.

## Delivered scope

| Feature | Working behaviour | Boundary |
| --- | --- | --- |
| 8. Stage-specific essential fields | Quotation preparation keeps customer, profile, pieces, length and kg/m visible. Delivery/payment, costing/recovery and terms/notes expand on demand and retain entered values. Legitimate incomplete drafts save. A shared preparation rule and database trigger reject unverified costing at approval, sending and customer approval, including direct API writes. | This delivery establishes the quotation workflow. It does not redesign every factory form. Existing role, low-margin and status-transition controls still apply. |
| 11. Automatic quantity and unit calculations | Cut lengths accept metres, millimetres, feet or inches and save canonical metres at twelve decimal places. Display-unit changes preserve the canonical value. Existing shared calculations derive total metres, theoretical weight, billing weight and price. | Theoretical quantities remain distinct from measured output. The saved transaction and PDF are checked with the same inputs. |
| 46. Internal discussions beside records | Orders, production jobs, dispatches and quality inspections have retained messages, replies and supporting reference text. Up to three active colleagues with record access can receive an in-app mention opening the exact message. | These are internal discussions, separate from formal approval. Existing document workflows handle files. No new complaint table, external messaging or public comment surface is introduced. |
| 62. Accountable SOP owners | `/tasks/procedures` identifies the owner, backup, clarification route, review date and availability. Owner/admin reassignment requires a reason and current revision. Authorised owners/backups can record reviews. Prior ownership and method metadata remain in history. | Procedure ownership does not grant financial/stock permissions or replace the assignee of a task. Full SOP publication/version governance remains a separate catalogue feature. |
| 74. Opening and closing routines | `/tasks/routines` generates one current Indian-business-day run for an active procedure and its recorded station/scope. Duplicate generation opens the existing run. Runs preserve prompts and the procedure revision. Scoped current work, holds and recorded exceptions are retrieved automatically; actual observations and a handover outcome are required for completion. | Generation is on demand. Production summaries cover permitted company work and are explicitly not station-filtered. This is not a shift-roster scheduler. Completing a review does not complete tasks/jobs, release holds or manufacture measurements. |

## Database rollout and security

Target was verified as Supabase project `pkawmdxtmsdgigsehcmb` (`AlExMS`). Only this batch's two migrations were applied. The existing operator-workflow migration was already present, and its three function-body fingerprints matched the local rehearsal.

| Local migration | Hosted ledger version | LF-normalised source MD5 |
| --- | --- | --- |
| `20261021190916_collaboration_procedure_routines.sql` | `20261021200851` | `2f7c52d70f53c9b02e87e4983e6d43b5` |
| `20261021201325_collaboration_foreign_key_indexes.sql` | `20261021201717` | `47cffe0cd78e8ae5504e4e1e352ffcce` |

Hosted ledger count after the rollout: **128**. All eight new function bodies match the tested local definitions. The five new tables have RLS enabled; direct authenticated SELECT/INSERT/UPDATE/DELETE/TRUNCATE and anonymous SELECT are denied. Reads and writes use bounded, validated projections and commands. New private helpers are denied to browser roles except the narrow customer-policy predicate, which requires authenticated execution for RLS. The public command is authenticated-only. Function search paths are pinned.

The real authenticated-role quote-save rehearsal found an existing customer-read policy referencing the restricted quotes table. The migration replaces only its dealer-lineage subquery with a company- and dealer-scoped boolean helper, preserving the existing internal-role list. Tests cover all fifteen application roles, both dealer lineage paths, foreign companies and denied direct pricing reads. Safe quote ID/company/status column grants were already present hosted and are repeated explicitly so the reconstructed catalog can exercise the existing status-update action. Price columns remain denied on the base table.

No business backfill, record deletion or hosted fixture insertion was performed. All five new hosted table counts were zero after installation. Hosted runtime probes used read-only transactions with temporary session claims, then reset them at transaction end. Procedure/routine RPC reads and customer lookup succeeded; direct price/base-table reads and anonymous RPC execution were denied. This is **session-claim simulation**, not a signed employee JWT test.

The performance advisor initially found ten uncovered foreign keys on the new tables. The second migration adds company-related indexes beginning with those foreign-key columns; local and hosted coverage checks now return no gaps for the new tables. The two pre-existing expense foreign-key findings remain outside this batch. Existing security-definer view findings (22), password-protection warning and other legacy advisor findings remain recorded. The authenticated security-definer function warning includes the new guarded public RPC; its active-user, role, company, record, key whitelist and mutation checks were reviewed and tested. The complete project advisor report is not clean.

Machine-readable hosted catalog, hashes, permissions, rollout results and advisor comparisons: [hosted-verification.json](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/hosted-verification.json).

## Verification

| Gate | Result |
| --- | --- |
| Focused SQL/action/unit/notification checks | **36 passed** after the final source changes. |
| Actual mounted browser components and affected quote regressions | **26 passed**. |
| Captured-catalog reconstruction and both migrations | Passed with **zero catalog failures**; 28 earlier hosted migrations replayed before this batch. |
| Actual quote action and `save_quote_atomic` under authenticated role | Passed; incomplete draft saved, incomplete confirmation denied, complete confirmation allowed, direct pricing denied. |
| Engineering-unit reconciliation | 20 ft = 6.096 m; 100 pieces at 0.8 kg/m = 609.6 m and 487.68 kg in the shared calculation and saved row. |
| Export reconciliation and visual inspection | PDF contains 6.096 m, 609.60 m and 487.680 kg; rendered and inspected as a readable single page. Internal discussion text is absent. |
| Hosted read-only role probes | Passed for authenticated and anonymous roles, with no business writes. |
| `npm run lint` and `npm run typecheck` on final `codex/v1` | Passed, exit code 0. |
| `npm run build` on final `codex/v1` | Passed, exit code 0; production routes generated successfully. |
| `npm test` on final `codex/v1` | **2,077 passed**, 76 suites, zero failed/skipped/cancelled; exit code 0. |
| Independent root migration-repair checkpoint, `npm test` | **1,918 passed**, 76 suites, zero failed/skipped/cancelled. |

A fresh hosted read-only catalog check on 22 October reconfirmed all eight function bodies, pinned search paths, authenticated-only command execution, denied direct table writes and zero rows in all five new tables. Subsequent RLS initplan changes from the separate audit work preserve these company/dealer boundaries.

The initial development-wide test run found eleven older browser assertions that assumed optional quote fields were always expanded. Those checks now open costing/terms explicitly. All four affected browser suites were rerun successfully. No product field was forced open to satisfy a test.

SQL/action coverage includes tenant boundaries, role parity, forbidden/deactivated ownership, missing upgrade, malformed payloads and confirmations, unknown database-error sanitisation, immutable replies/history, ten-row pagination, literal search, archive retention, stale revisions, daily duplicate prevention, prompt snapshots, read-only query branches, stale source fingerprints, required follow-up notes, lost acknowledgements and exact-request retries without duplicate messages/mentions/completions. Confirmation cache failures preserve confirmed writes.

## Visual inspection

The browser was enabled for this batch. Inspection used the actual components and styles, the real collaboration API/action and actual migration on disposable PGlite data, with synthetic authentication. The quotation screen captures saves without writing business data; the separate full-catalog rehearsal exercises its real save action, database function and PDF generator. The review fixture loads the application's Plus Jakarta Sans font.

- [x] Desktop discussion, exact reference and permitted mention; phone composer and retained thread.
- [x] Desktop owner directory, purpose/backup/review details and ownership history.
- [x] Phone procedure creation, owner reassignment and retained previous owner/backup/reason.
- [x] Desktop routine context and phone observation/result/outcome controls.
- [x] Completed phone routine retains the follow-up and carry-over outcome; unfinished source work remains open.
- [x] Desktop/phone essential quote fields, feet-to-metres conversion, theoretical quantities and expandable costing.
- [x] Actual quotation PDF rendered and inspected for quantities, readability and complete signature/footer placement.

| Evidence | Artifact |
| --- | --- |
| Desktop discussion | [Screenshot](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/discussion-desktop.jpg) |
| Phone discussion | [Screenshot](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/discussion-phone.jpg) |
| Owner directory | [Screenshot](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/owners-desktop.jpg) |
| Ownership details and history | [Desktop](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/ownership-change-desktop.jpg), [phone](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/ownership-history-phone.jpg) |
| Phone procedure entry | [Screenshot](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/procedure-create-phone.jpg) |
| Routine work context | [Desktop](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/routine-desktop.jpg), [phone](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/routine-phone.jpg) |
| Observations and retained completion | [Phone form](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/routine-observations-phone.jpg), [completion](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/routine-completed-phone.jpg) |
| Quotation quantities | [Desktop](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/quote-quantity-desktop.jpg), [phone](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/quote-units-phone.jpg) |
| Reconciled quotation export | [PDF](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/canonical-length-quotation.pdf), [rendered page](evidence/UPGRADE_EOS_COLLABORATION_2026-10-22/canonical-length-quotation.png) |

## Source inventory

The implementation commit changes 37 files: 26 created and 11 modified. Unrelated PDF/report, audit and migration-replay edits were preserved and were not included in this commit. There are no package/dependency changes in this batch.

Created application files:

- `app/(dashboard)/tasks/procedures/page.tsx`, `new/page.tsx`, `[id]/page.tsx`.
- `app/(dashboard)/tasks/routines/page.tsx`, `[id]/page.tsx`.
- `app/api/collaboration-workflows/route.ts`.
- `components/modules/operations/collaboration-tools.tsx`, `components/modules/shared/length-unit-input.tsx`.
- `lib/actions/collaboration-workflows.ts`, `lib/calculations/length-units.ts`, `lib/workflow/quote-preparation.ts`.
- `lib/operations/collaboration-workflows.ts`, `lib/operations/collaboration-client.ts`.

Created verification and migration files:

- `scripts/lib/collaboration-workflow-fixture.mjs`, `collaboration-action-fixture.mjs`, `collaboration-browser-fixture.mjs`.
- `scripts/serve-collaboration-fixture.mjs`, `scripts/rehearse-collaboration-upgrade.mjs`.
- `sql/verify-collaboration-upgrade.sql`, `sql/probe-collaboration-readonly.sql`.
- The two migrations listed above.
- `tests/collaboration-workflows-sql.test.mjs`, `collaboration-workflows-action.test.mjs`, `collaboration-workflows-browser.test.mjs`, `quote-length-preparation.test.mjs`.

Modified files:

- `app/(dashboard)/notifications/page.tsx`, `orders/[id]/page.tsx`, `tasks/page.tsx`.
- `components/modules/operations/record-detail-client.tsx`, `components/modules/quotes-client.tsx`.
- `lib/actions/quotes-orders.ts`, `lib/operations/notification-actions.ts`.
- `tests/notification-actions.test.mjs`, `entry-acceptance-integration.test.mjs`, `in-task-customer-browser.test.mjs`, `quote-paste-browser.test.mjs`.

## Remaining acceptance boundaries

Real employee JWT sessions, real-user/physical shift trials, independent PostgreSQL-session write races, and application deployment are separate acceptance layers. The local Docker engine was unavailable for independent-session testing, including after an attempted startup; PGlite retries/uniqueness tests and the reviewed transaction locks are not presented as a parallel-session race test. No hosted business records were inserted to manufacture that evidence.

The five completed catalogue entries describe the delivered scope above. The catalogue retains all 100 numbered features and now has 15 scoped completion entries. Other catalogue features and earlier deferred visual checks remain unchanged.
