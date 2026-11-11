# Defect Register

**Evidence scale.** Reproduced means the captured source produced the result below. Strongly supported means the implementation establishes the failure path and an end-to-end run remains open. Version matches, deployed artifacts, and hosted configuration have separate evidence classes. Release acceptance is tracked in [the decision](13_RELEASE_READINESS_DECISION.md).

## P1

### MFA-001 | Runtime dependency advisories

- **Class and scope.** Confirmed affected-version match. Next.js runtime and dependency chain.
- **Evidence.** package-lock.json:5649 locks Next.js 16.2.11, :6785 locks sharp, and :7963 locks Zod. The npm registry reported 16 package-level entries, including a critical entry for Next.js. Several vendor advisories include the locked Next.js version. Application exposure depends on advisory prerequisites. [Registry result](evidence/npm-audit-retry.log) · [Next.js advisory GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) · [Next.js advisory GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) · [Next.js advisory GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
- **Expected and observed.** Deployable versions should be outside applicable affected ranges. The locked runtime falls inside them. The version match establishes a dependency problem. Application compromise was outside the evidence scope.
- **Fix and regression.** Resolve mutually compatible patched versions and repeat the advisory scan. Rebuild and check proxy, image, PDF, validation and session behavior. Assess the deployed artifact's lockfile and runtime separately.

### MFA-002 | Cast output exceeds charged metal and melt loss omits dross

- **Class and scope.** Reproduced. Foundry, billet stock, scrap and recovery. October AP-002.
- **Source.** supabase/migrations/20261021240000_casting_results_and_chemistry_release.sql:414, :456 and :478. `record_foundry_cast_result` compares with theoretical billet weight and writes `foundry_cast_results`. The residual omits dross.
- **Expected and observed.** Actual charge should equal measured good output, recoverable rejects, dross and documented loss within approved instrument tolerance. The command accepted 65.670 kg charged, 74.864 kg good and 5.000 kg dross. It stored −9.194 kg loss instead of the −14.194 kg residual including dross. A second 65.670 kg charge with 62.000 kg good and 4.000 kg dross showed +3.670 kg loss against a −0.330 kg residual.
- **Reproduction and impact.** Submit the quantities for synthetic cast heats with an authorized production role and active write guards. The result can overstate billet stock and corrupt yield, scrap and valuation evidence. [Fixture output](evidence/business-invariants-verified.log)
- **Fix and regression.** Lock actual charge evidence and require a coherent measured mass balance in the cast transaction. Test the two overbalances, exact balance, dross, measured rejects, retries and approved measurement tolerances.

### MFA-003 | An impossible chemistry composition can be approved

- **Class and scope.** Reproduced. Foundry chemistry, QC and release. October AP-004.
- **Source.** supabase/migrations/20261021240000_casting_results_and_chemistry_release.sql:389, :496, :518 and :537. The recorder validates each percentage and stores the entered result. The approver adds approval evidence without checking combined composition or alloy limits.
- **Expected and observed.** Invalid measurements should preclude an approved pass. A quality user recorded synthetic readings of 60% aluminium and 60% silicon as a pass. A different authorized user approved it. Release checks the latest approved pass.
- **Reproduction and impact.** Record the composition for a synthetic cast heat, then approve with a different authorized user. The result establishes physically impossible composition acceptance independently of an alloy specification. It can make invalid evidence eligible for billet release. [Fixture output](evidence/business-invariants-verified.log)
- **Fix and regression.** Validate composition and revision-specific approved limits on the server. Preserve raw readings and authorized concessions separately. Test impossible totals, missing elements, valid boundaries, latest failure and expired specification.

### MFA-004 | Completion treats allocations as physical input

- **Class and scope.** Reproduced. Production completion, billet custody and recovery. October AP-001.
- **Source.** lib/actions/production.ts:249; lib/actions/production-completion.ts:35; supabase/migrations/20261008020000_factory_workflow_integrity.sql:340; supabase/migrations/20261021240000_casting_results_and_chemistry_release.sql:181, :233 and :375.
- **Expected and observed.** A partial issue should reconcile against physical issue. A synthetic running job had 60 kg issued and 180 kg allocated. Posting 57 kg good plus 3 kg scrap failed with SQLSTATE `23514` because completion compared it with 240 kg. The job stayed in progress.
- **Reproduction and impact.** Submit those observations as a production operator on the partial-issue fixture. The defect blocks honest closure and can pressure operators to record incorrect scrap. The audit exercised the refusal case. [Fixture output](evidence/partial-issue.log)
- **Fix and regression.** Use issued and consumed input consistently in ordinary completion, scrap and correction paths. Preserve or explicitly release unused allocations. Test partial issue, overconsumption, rollback, concurrent completion and historical jobs.

### MFA-006 | Bank parser treats a deposit as an outgoing debit

- **Class and scope.** Reproduced. Candidate Autopilot bank import and receipt matching.
- **Source.** lib/financials/bank-statement.ts:24 and :102–114; supabase/migrations/20261111100000_autopilot_batch_3.sql:1717–1731. The single-amount parser recognizes any type starting with `d` as debit. The importer excludes debit rows from customer matching.
- **Expected and observed.** An INR 2,500 deposit should become a credit. A synthetic Date/Narration/Amount/Type export with type `Deposit` became a debit of INR 2,500 and persisted as ignored. Withdrawal and CR controls classified correctly.
- **Reproduction and impact.** Parse the fixture and import its normalized record as accounts. An incoming receipt can disappear from matching and leave receivables overstated. [Fixture output](evidence/business-invariants-verified.log)
- **Fix and regression.** Enumerate supported directions and flag conflicting or unknown markers. Test deposit, withdrawal, signed amounts, CR/DR suffixes, blank markers and persistence into the receipt queue.

### MFA-007 | Bank dedupe silently drops ambiguous receipts

- **Class and scope.** Reproduced. Candidate Autopilot bank import.
- **Source.** supabase/migrations/20261111100000_autopilot_batch_3.sql:1713–1729. The key combines date, direction, amount and either reference or normalized narration, then suppresses collisions.
- **Expected and observed.** Without a durable bank transaction reference, distinguish separate statement occurrences or require duplicate review. Two synthetic INR 2,500 cash deposits on separate lines with identical dates and narration yielded one inserted row and one duplicate. Only INR 2,500 of the INR 5,000 remained.
- **Reproduction and impact.** Import the two-row statement as accounts and compare the stored total to the source. A second real receipt can vanish from the review queue. [Fixture output](evidence/business-invariants-verified.log)
- **Fix and regression.** Prefer stable bank identity and hold ambiguous collisions for review while preserving occurrences. Test file replay, overlapping periods, equal legitimate deposits and repeated stable references.

### MFA-008 | Omalco invitation-only policy differs across layers and releases

- **Class and scope.** Verified deployment discrepancy and strongly supported control gap. Signup, Auth and organization bootstrap.
- **Source.** app/(auth)/signup/page.tsx:5; app/(auth)/onboarding/page.tsx:6; components/modules/auth-forms.tsx:63 and :86; supabase/migrations/20260721091808_atomic_company_onboarding.sql:15 and :115–132; supabase/migrations/20261109000000_single_tenant_omalco.sql:4–23.
- **Expected and observed.** Omalco mode requires consistent invitation checks. The latest production deployment's source still renders signup. The captured source redirects that route, while retaining the onboarding form and authenticated grant. The linked hosted catalog has the single-company insert guard and the authenticated onboarding grant. Provider signup configuration and unauthorized app entry remain unverified.
- **Fix and regression.** Align provider policy, the deployed route and bootstrap. Verify invited staff, uninvited accounts, suspended accounts and approved bootstrap behavior on the intended release. [Security evidence](06_SECURITY_AUDIT.md)

### MFA-011 | Source disposition leaves downstream quarantine open

- **Class and scope.** Strongly supported control gap requiring recall policy. Foundry, release and dispatch. October AP-010.
- **Source.** supabase/migrations/20261022130000_metal_source_disposition.sql:209, :248, :258 and :293–317. The writer locks and updates the source, records disposition and calculates return/credit evidence. It has no downstream quarantine write.
- **Expected and observed.** A recall-triggering rejection needs a linked hold or review across descendants under an approved policy. The implemented command's disposition scope is the source lot. Handling of mixed heats, already issued billets and shipped material remains open.
- **Fix and regression.** Add traceable recall assessment and disposition over source → heat → billet → batch → dispatch. Test in-stock and shipped descendants, mixed ancestry and closure evidence.

## P2

### MFA-005 | Dashboard reports the whole batch as reserved

- **Class and scope.** Reproduced. Dashboard stock and order reservations.
- **Source.** supabase/migrations/20261109010000_stock_snapshot.sql:21–29; components/modules/dashboard-client.tsx:261–263; supabase/migrations/20261022250000_profile_stock_balance_explanation.sql:44–64.
- **Expected and observed.** Reserved kg should equal open reservations. A 100 kg reserved-status batch with a 20 kg open reservation reported 100 kg reserved. The canonical explanation returned 100 kg on hand, 20 kg reserved and 80 kg available.
- **Reproduction and impact.** Compare both reads after seeding that partial reservation. Management may react to a false shortage. [Fixture output](evidence/business-invariants-verified.log)
- **Fix and regression.** Derive cards and breakdowns from the canonical stock basis. Test partial reservation, partial dispatch, release, QC hold and dealer-owned material.

### MFA-009 | The global browser policy blocks scanner camera access

- **Class and scope.** Reproduced at the browser policy boundary. Scan and mobile scan.
- **Source.** next.config.ts:43–53; app/(dashboard)/scan/page.tsx:60 and :92; app/(dashboard)/mobile/scan/page.tsx:13.
- **Expected and observed.** An authorized operator granting camera consent should be able to scan. Chromium returned one synthetic camera track under the same-origin control policy. Under the configured `camera=()` it returned `NotAllowedError` with permission granted.
- **Reproduction and impact.** Run the browser header fixture. Camera QR capture is blocked under this configuration. Manual code entry remains available. [Browser output](evidence/camera-policy.log)
- **Fix and regression.** Allow the same-origin camera only where the scanner needs it. Verify camera permission, denial, duplicate scans, stop and manual entry on a phone and the deployed route.

### MFA-012 | Task and dealer overview sources are capped at 250

- **Class and scope.** Strongly supported. Tasks and dealer orders. October AP-025.
- **Source.** app/(dashboard)/tasks/page.tsx:19; app/(dashboard)/dealer-orders/page.tsx:26–27.
- **Expected and observed.** Whole-company summaries should use complete aggregates or identify their sample. These pages derive overview results from capped lists. Database pages provide separate pagination.
- **Fix and regression.** Calculate totals independently from displayed rows. Seed 251 or more records with a material older exception and compare the result with a complete count.

### MFA-013 | Credit gate treats unknown exposure as zero

- **Class and scope.** Strongly supported at the Batch 3 SQL boundary. Reachability through normal gate-out for every packing source remains unverified.
- **Source.** supabase/migrations/20261111100000_autopilot_batch_3.sql:684, :714–727 and :828–841. `ap3_dispatch_value` returns null without usable weights or rates. The guard coalesces the current value to zero. Earlier unpriced dispatches are counted but add zero to exposure.
- **Expected and observed.** A credit limit decision needs a priced exposure or an explicit exception. The code can pass on the known subtotal. Per-customer serialization across simultaneous gate-outs also needs independent-session evidence.
- **Fix and regression.** Bind credit assessment to the authoritative billing basis, flag unknowns and test missing rates, partial packing, multiple pending dispatches and simultaneous gate-out.

### MFA-015 | Leaked-password protection is disabled on the linked hosted project

- **Class and scope.** Confirmed hosted configuration finding. Supabase Auth. October AP-020.
- **Evidence and impact.** The current security advisor reports `auth_leaked_password_protection`. The provider reports the additional compromised-password check as disabled. [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- **Fix and regression.** Confirm plan and policy, enable the control through the approved release process, then verify permitted password, invitation and reset behavior in staging.

## P3

### MFA-010 | Malformed stock data appears as legitimate zeros

- **Class and scope.** Reproduced. Dashboard stock snapshot.
- **Source.** lib/dashboard/stock-snapshot.ts:14–38; app/(dashboard)/dashboard/page.tsx:27–31.
- **Expected and observed.** Incomplete stock data should appear unavailable. A response with `finishedKg="unknown"`, a null piece count and a genuine zero billet balance produced a complete all-zero snapshot.
- **Reproduction and impact.** Run the parser fixture. A malformed or incompatible response can be mistaken for empty stock. [Fixture output](evidence/business-invariants-verified.log)
- **Fix and regression.** Validate the required payload and preserve zero only when it is a valid explicit value. Cover omitted fields, null, nonnumeric input, true zero and read failure.

### MFA-014 | Earlier Autopilot tests assert obsolete job and grant inventories

- **Class and scope.** Reproduced test-suite defect. Cron and RPC inventory assertions.
- **Source.** tests/autopilot-batch1-sql.test.mjs:53–55 and :422; supabase/migrations/20261111100000_autopilot_batch_3.sql:1976 and :2095 onward. The older job assertion expected eight fixture runs and observed ten. The exact RPC list excludes new intended Batch 3 entry points.
- **Expected and observed.** Regression tests should compare against the intended full current registry and allowlist. The two old assertions fail. Focused Batch 3 registry/grant checks pass.
- **Fix and regression.** Define the complete intended registry and allowlist explicitly at the release boundary while retaining tests that catch unintended extra grants. Rerun the whole suite. [Suite output](evidence/test-isolated.log)
