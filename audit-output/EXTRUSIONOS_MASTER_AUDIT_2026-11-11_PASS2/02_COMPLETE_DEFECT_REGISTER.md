# Complete Defect Register

HEAD `a0ef08d` (`feat/autopilot-batch-3`). IDs are `PA2-nnn`; the earlier same-day audit's `MFA-nnn` IDs are cross-referenced where a finding carries over.

**Evidence classes.** *Reproduced* means a script in [evidence/](evidence/) produced the result at this HEAD on a disposable native PostgreSQL 18 replay of the full migration chain, as a low-privilege signed-in role. *Confirmed (hosted)* means a read-only observation of the linked Supabase project. *Confirmed (version)* is a lockfile match. *Strongly supported* means the code establishes the failure path but it was not executed end to end. Nothing here was reproduced by a signed-in person in the real application.

## Counts

| Priority | Confirmed | Strongly supported or probable (not counted as confirmed) |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 6 (PA2-001 to 006) | 1 (PA2-011) |
| P2 | 5 (PA2-007, 008, 009, 014, 019) | 2 (MFA-012, MFA-013) |
| P3 | 7 (PA2-012, 013, 015, 016, 018, 020, 022) | 3 (PA2-010, 017, 026) |
| P4 | 3 (PA2-021, 023, 025) | 0 |

PA2-024 is a verification gap, not a defect. Three findings from the earlier audit no longer reproduce (see the end of this file).

---

## P1

### PA2-001 | No one can suspend a user or change a role; every `app_users` UPDATE fails

- **Class.** Reproduced; the same two policies are present on hosted. Access control, offboarding.
- **Where.** `supabase/migrations/20260603100000_security_audit_fixes_june2026.sql:7-20` (policy `app_users_update_self`, whose `WITH CHECK` sub-selects `public.app_users`). `components/modules/access-control-client.tsx:124` renders users as a read-only table. No server action, API route or SQL function updates `app_users` (searched `lib/`, `app/`, `components/`, all migrations).
- **Expected.** An owner can deactivate a departed employee and change a role; a user cannot raise their own role.
- **Actual.** Every UPDATE on `app_users` by any signed-in role, including an owner updating someone else, fails with `42P17 infinite recursion detected in policy for relation "app_users"`. Self-escalation is therefore blocked, but so is every legitimate change. The app has no screen or action for suspension, role change or invitation revocation.
- **Reproduce.** `node evidence/security-probes.mjs` (cases `S1-*`); output in [security-probes.log](evidence/security-probes.log). Hosted policy list in [hosted-refresh.json](evidence/hosted-refresh.json).
- **Consequence.** A dismissed employee keeps full access until someone edits the row with the service role in the Supabase dashboard. Hosted has one user today, so nothing has been exposed yet; this becomes live the day staff are invited.
- **Smallest safe fix.** Replace the sub-selects with a `SECURITY DEFINER` helper (as `get_current_user_company_id()` already is) or move role and status changes into one owner-only RPC that writes an audit row; add the owner screen that calls it.
- **Regression test.** Native-role test: owner deactivates and re-roles another user; user cannot change own role or company; deactivated user's next request is refused.

### PA2-002 | A cast can record more good metal than was charged, and melt loss ignores dross (MFA-002, AP-002)

- **Class.** Reproduced at HEAD. Foundry, billet stock, yield.
- **Where.** `supabase/migrations/20261021240000_casting_results_and_chemistry_release.sql:414, :456, :478` (`record_foundry_cast_result`).
- **Expected.** Charged kg = good cast kg + recoverable rejects + dross + documented loss, within an approved weighing tolerance.
- **Actual.** 65.670 kg charged accepted 74.864 kg good plus 5.000 kg dross, storing melt loss −9.194 kg (true residual −14.194 kg). A second heat of 65.670 kg with 62.000 kg good and 4.000 kg dross stored +3.670 kg loss against a true −0.330 kg.
- **Reproduce.** [rerun-business-invariants.log](evidence/rerun-business-invariants.log), id `MFA-002`.
- **Consequence.** The system can create billet stock that was never melted, and yield and valuation figures built on it are wrong.
- **Fix.** Refuse a cast result whose measured outputs exceed the charge beyond tolerance; include dross in the residual.
- **Regression test.** The two cases above, an exact balance, and a within-tolerance case.

### PA2-003 | A physically impossible chemistry result can be recorded and approved (MFA-003, AP-004)

- **Class.** Reproduced at HEAD. Foundry QC, billet release.
- **Where.** Same migration, `:389, :496, :518, :537`.
- **Actual.** Al 60 % plus Si 60 % was stored as `pass` and approved by a second user. Nothing compares readings with the alloy's limits or checks that the total is possible.
- **Reproduce.** [rerun-business-invariants.log](evidence/rerun-business-invariants.log), id `MFA-003`.
- **Consequence.** Billets from a heat with invalid or out-of-spec chemistry become eligible for release.
- **Fix.** Derive pass or fail on the server from the alloy specification revision; refuse totals above 100 %. Numeric alloy limits must come from Omalco's approved specifications, not be invented.
- **Regression test.** Impossible total, a missing mandatory element, boundary values, and an expired specification.

### PA2-004 | Completing a job after a partial billet issue is refused (MFA-004, AP-001)

- **Class.** Reproduced at HEAD. Production completion.
- **Where.** `lib/actions/production-completion.ts:35`; `supabase/migrations/20261008020000_factory_workflow_integrity.sql:340`; `20261021240000_...:181, :233, :375`.
- **Actual.** A running job with 60 kg issued and 180 kg only allocated, reporting 57 kg good plus 3 kg scrap, fails with `23514 Billet mass balance failed: linked input 240.000 kg, accounted output and scrap 60.000 kg`. The job stays in progress.
- **Reproduce.** [rerun-operator-invariants.log](evidence/rerun-operator-invariants.log).
- **Consequence.** An honest operator cannot close the job. The only ways through are to release the unused allocation first (a path I did not verify for a running job) or to enter scrap that did not happen.
- **Fix.** Balance completion against issued billets only; release or carry forward unissued allocations explicitly.
- **Regression test.** Partial issue, over-consumption, concurrent completion.

### PA2-005 | Any company user, including a dealer, can read, replace and delete files in six storage buckets (AP-003)

- **Class.** Reproduced at policy level on native PostgreSQL with a stand-in `storage` schema; the same 18 policies exist on hosted. Not exercised through the real Storage API.
- **Where.** `supabase/migrations/20260515005900_reports_storage_bucket.sql:8-40` and `supabase/rls.sql` — policies `tenant storage read / insert / update / delete` check only that the first folder equals the caller's company. Buckets: `company-assets`, `profile-drawings`, `die-drawings`, `quote-pdfs`, `dispatch-documents`, `reports`.
- **Actual.** `dealer_admin`, `viewer` and `production` roles could each list and read internal quote PDFs and reports, delete them, rename a quote PDF and upload an `.html` file. A suspended user and a user of another company were refused.
- **Reproduce.** [storage-probes.log](evidence/storage-probes.log).
- **Consequence.** A dealer can read other customers' quotations and internal reports and can destroy document evidence. Hosted holds zero stored objects today, so no file is currently exposed.
- **Fix.** Add the role and record-ownership checks already used for `documents` and `technical-drawings` (`20260715040000_documents_storage_role_rls.sql`) to these six buckets; restrict delete to owner or admin.
- **Regression test.** Per-bucket matrix of role × read, insert, update, delete, run through the real Storage API on staging.

### PA2-006 | The locked Next.js version is inside critical advisory ranges (MFA-001)

- **Class.** Confirmed (version). Not an exploit demonstration.
- **Where.** `package.json:28` (`next ^16.2.11`); the advisory range reported is up to 16.4.0.
- **Actual.** `npm audit` reports 16 affected packages: 1 critical (Next.js, including unauthenticated remote code execution advisories for the image optimiser and for Windows-hosted servers), 6 high, 9 moderate. All report a fix as available; the `zod` fix is a major version. [npm-audit.json](evidence/npm-audit.json).
- **Consequence.** Whether each advisory applies depends on the hosting setup, which I did not assess per advisory.
- **Fix.** Upgrade Next.js to a patched release, rerun the audit, then rerun build, proxy, PDF and session checks.

---

## P2

### PA2-007 | A packaging purchase adds stock that packing cannot see (MFA-017, AP-005)

- **Class.** Reproduced at HEAD.
- **Where.** `20261020010000_expense_ledger_integrity.sql:1604-1617` credits `inventory_items`; `20260515005200_packaging_queue_and_calculation_hardening.sql:85-103` consumes from `packaging_materials.current_stock`.
- **Actual.** A 100 m purchase left inventory at 100 m and the packaging balance at 0 m. [rerun-reconciliation-followup.log](evidence/rerun-reconciliation-followup.log).
- **Consequence.** Packing shows a shortage for material the stores have received; the two balances drift apart permanently.
- **Fix.** One movement ledger for packaging material, or a transactional projection from one to the other.

### PA2-008 | The site-wide browser policy blocks the scanner camera (MFA-009)

- **Class.** Configuration confirmed at HEAD (`next.config.ts:51`, `camera=()`); the browser reproduction is from the earlier audit and was not rerun.
- **Consequence.** QR scanning by camera on `/scan` and `/mobile/scan` is denied even after the operator grants permission. Manual code entry still works.
- **Fix.** `camera=(self)`, then verify on a phone against the deployed site.

### PA2-009 | The repository would let the first stranger become owner of a fresh environment; hosted is protected only by a change that is not in the repository (MFA-008)

- **Class.** Deployment discrepancy, both sides confirmed.
- **Where.** `supabase/migrations/20260721091808_atomic_company_onboarding.sql:131` grants `onboard_company_atomic` to `authenticated`. Hosted has the grant revoked by ledger entry `20261111064948 audit_revoke_self_service_onboarding`, which has no file in the repository.
- **Actual.** On the replay, a signed-in account with no staff row is refused a second company (single-company trigger) but succeeds when no company exists yet (`S4-stranger-onboards-when-no-company-exists` → executed). On hosted the grant is `false`, one company exists, and the trigger is enabled.
- **Consequence.** Hosted is closed today. Any environment rebuilt from the repository (staging, disaster recovery, a new project) is open until someone remembers the manual step. Whether public sign-up is disabled in Supabase Auth itself could not be read.
- **Fix.** Add the revoke as a repository migration; record the Auth sign-up setting in the deployment checklist.

### PA2-014 | Leaked-password protection is disabled on hosted (MFA-015, AP-020)

- **Class.** Confirmed (hosted advisor, 17:28 UTC). [Supabase guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- **Fix.** Enable in Supabase Auth settings.

### PA2-019 | No storage bucket limits file size or file type

- **Class.** Confirmed (hosted): all 9 buckets have no `file_size_limit` and no `allowed_mime_types`. No migration sets either. The policy probe accepted an `.html` upload.
- **Consequence.** Combined with PA2-005, any company user can store arbitrary files of any size. Application-side upload checks were not tested.
- **Fix.** Set per-bucket size and MIME allow-lists in a migration.

---

## P3

### PA2-012 | A malformed stock response is shown as real zeros (MFA-010)

- **Class.** Reproduced at HEAD. `lib/dashboard/stock-snapshot.ts:14-38`. A payload with a non-numeric value parses to a complete all-zero snapshot. [rerun-business-invariants.log](evidence/rerun-business-invariants.log), id `MFA-010`. A suspended user's call also returns the all-zero object rather than a refusal.
- **Fix.** Show "unavailable" unless every required field is a valid number.

### PA2-013 | A signed-out deep link lands on "Account unavailable" instead of the login page (MFA-016)

- **Class.** Source confirmed unchanged at HEAD (`proxy.ts:78-83` runs before the login redirect at `:92-96`); the built-app reproduction is from the earlier audit.
- **Fix.** Treat "no session" as signed-out, and only real Auth errors as unavailable.

### PA2-015 | Two workspace-pin tests fail (NOV-002, NOV-100)

- **Class.** Reproduced: tests 1288 and 1289 in [test.log](evidence/test.log). The earlier audit attributed this to the tests not opening the collapsed "Pinned and recent work" section; I did not re-diagnose it. Until it is fixed, pinning has no passing browser evidence.

### PA2-016 | A dealer login can read the whole factory staff directory

- **Class.** Reproduced: `dealer_admin` reads 16 `app_users` rows (`S6-dealer-reads-staff-emails`). `supabase/rls.sql:53` allows any user of the company to select all users.
- **Fix.** Restrict dealer roles to their own row and their dealer's users.

### PA2-018 | The quote screen and the saved quote can differ by a few paise

- **Class.** Reproduced: 600 random lines through `lib/calculations/quote.ts` and the SQL trigger `recalculate_quote_item_financials` gave 3 lines that differ, by at most ₹0.60, from a 0.001 kg weight rounding difference. Header totals matched exactly. [quote-differential.log](evidence/quote-differential.log), `Q1`, `Q3`.
- **Consequence.** Cosmetic; the saved value is authoritative. Matters only if someone compares a screenshot with a PDF.
- **Fix.** Round weight the same way in both engines.

### PA2-020 | The receipt function accepts an amount with fractions of a paisa

- **Class.** Reproduced by direct RPC only: `100.005` was accepted and stored as `100.01` (`F4-direct-rpc-fractional-paisa`). The form was not tested. After a reversal the invoice returned to status `sent` where it had been `generated` (`F7`); whether that is intended was not established.
- **Fix.** Refuse amounts with more than two decimals.

### PA2-022 | An owner or admin can hard-delete a sent quotation

- **Class.** Reproduced: a quote in status `sent` was deleted (`DEL-owner-quotes`, `DEL-admin-quotes` → 1 row). On hosted, `quote_items`, `quote_revisions` and validity history cascade with it ([hosted-refresh.json](evidence/hosted-refresh.json)). The fixture quote had no order; deleting a quote that has an order was not tested.
- **Fix.** Refuse deletion once a quote has been sent; cancel instead.

---

## P4

### PA2-021 | `npm run lint` fails on an audit artefact

`eslint .` exits 1 because of one error in `audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/evidence/capture-inventory.mjs:85`; ESLint has no ignore for `audit-output/`. Application code has zero errors and four unused-variable warnings in one test file. [lint.log](evidence/lint.log).

### PA2-023 | Fourteen configurator tests are never run by `npm test`

`lib/systems-configurator/__tests__/formula-engine.test.ts` and `preview-geometry.test.ts` sit outside the `tests/*.test.mjs` glob (`package.json:13`). Run by hand, all 14 pass ([configurator-orphan-tests.log](evidence/configurator-orphan-tests.log)).

### PA2-025 | A signed-in account with no staff row can read two reference tables

`subscription_plans` (4 rows) and `permissions` (25 rows) are readable by any authenticated account. No business data; tidy-up only.

---

## Strongly supported or probable (not executed end to end)

| ID | Would be | Finding | What is missing |
|---|---|---|---|
| PA2-011 (MFA-011, AP-010) | P1 | Rejecting a metal source lot does not hold the heats, billets or stock made from it. `20261022130000_metal_source_disposition.sql` changes only the lot. | A recall policy decision, then an executed case with descendants. |
| MFA-012 (AP-025) | P2 | Task and dealer-order overview counts are computed from the newest 250 rows (`tasks/page.tsx:19`, `dealer-orders/page.tsx:26-27`, confirmed at HEAD). | A seeded 251-row case. |
| MFA-013 | P2 | The credit gate counts a dispatch with no computable value as ₹0 (`20261111100000_autopilot_batch_3.sql:744, :835`, confirmed at HEAD). | Reachability through a normal gate-out; two-session test. |
| PA2-010 | P3 | Billing the quoted kg at the stored per-kg `net_rate` does not reproduce the quoted line amount: 464 of 600 lines differ by more than ₹1, worst ₹395 on ₹8.59 lakh, because the rate is rounded to two decimals. | I did not trace which basis the invoice writer uses, so this may be a policy choice rather than a defect. |
| PA2-017 | P3 | A negative billet rate was stored by a direct insert (`Q4-negative-rate`). | The probe had other user triggers disabled; the form schema refuses negatives (`lib/validations/schemas.ts:218`) and the costing-rate check (`20261022340000:243`) was not exercised. Probably unreachable from the UI. |
| PA2-026 | P3 | `/api/payments` has no Origin check, unlike the other mutating routes; it relies on the session cookie's SameSite setting. | A cross-site request test against the built app. |

## Verification gap

**PA2-024.** 34 of 352 test files assert only that strings exist in source files, and 4 more are mostly that ([test-quality.json](evidence/test-quality.json)). They include files whose names suggest security behaviour: `access-invites-security`, `role-aware-sensitive-rls`, `dealer-boundary-hardening`, `onboarding-atomicity`, `server-owned-writes-regression`, `invite-acceptance-integrity`. A pass in those files shows the code was written, not that it works.

## No longer reproduced at this HEAD

| Earlier ID | Was | Now |
|---|---|---|
| MFA-005 | Dashboard showed a whole 100 kg batch as reserved | Shows 20 kg, matching the reservation ledger (fix `20261111110000_stock_snapshot_open_reservations.sql`, applied to hosted) |
| MFA-006 | Bank import classified a deposit as a debit | Deposit stored as a credit awaiting matching |
| MFA-007 | Second identical bank receipt silently dropped | Both lines stored; ₹5,000 of ₹5,000 retained |
| MFA-014 | Seven suite failures from stale expectations | Two remain (PA2-015) |
