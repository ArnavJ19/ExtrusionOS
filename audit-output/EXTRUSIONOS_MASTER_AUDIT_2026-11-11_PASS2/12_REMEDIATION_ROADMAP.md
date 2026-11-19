# Remediation Roadmap

Ordered by what unblocks what. No fix was applied during the audit. Every migration below should be additive, replayed locally, then applied to hosted only on approval.

## 1. Immediate containment (hours; no workflow change)

| Fix | Finding | Note |
|---|---|---|
| Add the hosted-only onboarding revoke to the repository as a migration | PA2-009 | Hosted is already safe; this protects every future environment |
| Upgrade Next.js to a patched release; rerun audit, build and tests | PA2-006 | Do this before anything else ships |
| Enable leaked-password protection in Supabase Auth | PA2-014 | Dashboard setting |
| Confirm public sign-up is disabled in Supabase Auth and write it into the deployment checklist | PA2-009 | Could not be read by the audit |
| Do not invite dealers or additional staff until groups 2a and 2b are done | PA2-001, 005 | Hosted has one user and zero stored files, so nothing is exposed today |

## 2. Data integrity and security

**2a. User lifecycle (PA2-001).** Replace the self-referencing policy with a definer helper; add one owner-only RPC for deactivate, reactivate and role change, with an audit row; add the screen. Depends on nothing. Risk: the invite-acceptance path inserts into `app_users`; retest it.

**2b. Storage (PA2-005, PA2-019).** Role and record-ownership policies on the six open buckets, modelled on the existing `documents` policies; delete limited to owner and admin; size and MIME limits per bucket. Risk: PDF generation and logo upload write to these buckets; test each writer as its real role.

**2c. Dealer directory (PA2-016).** Narrow the `app_users` select policy for dealer roles. Risk: screens that show "created by" names to dealers.

**2d. Structural delete protection.** Change cascades from invoices, orders, production jobs, foundry batches and quotes to `RESTRICT` where history must survive; refuse deleting a sent quote (PA2-022).

## 3. Production-critical workflow corrections

Do these in order; each changes the numbers the next one relies on.

1. **Completion balances on issued billets only (PA2-004).** Decide what happens to unissued allocations at completion (release automatically, or require explicit release). Existing completed jobs are unaffected.
2. **Cast mass balance (PA2-002).** Include dross in the residual and refuse output above charge beyond a tolerance. *Needs from Omalco:* the weighing tolerance.
3. **Chemistry validation (PA2-003).** Server derives pass or fail from the alloy specification; totals above 100 % refused. *Needs from Omalco:* approved limits per alloy. Until supplied, the system should say "specification missing", not pass.
4. **Downstream hold on source rejection (PA2-011).** *Needs from Omalco:* a recall policy — what is held when a lot is rejected after its metal has been cast, extruded or shipped.
5. **Packaging single balance (PA2-007).** One ledger, or a transactional projection; backfill existing differences with a reviewed adjustment.

## 4. Commercial and financial corrections

| Fix | Finding |
|---|---|
| Decide the invoice basis: rate × kg, or the quoted line amount. If rate × kg, show the customer that the quotation total is indicative | PA2-010 |
| Credit gate: treat an unpriced dispatch as "unknown, needs approval", not ₹0 | MFA-013 |
| Receipt amounts limited to two decimals | PA2-020 |
| Same weight rounding in the TypeScript and SQL quote engines | PA2-018 |
| Origin check on `/api/payments` | PA2-026 |

## 5. Operational usability

| Fix | Finding |
|---|---|
| `camera=(self)` so scanning works | PA2-008 |
| Signed-out links go to login with a return path | PA2-013 |
| Stock card shows "unavailable" on bad data | PA2-012 |
| Overview counts from real aggregates, not capped lists | MFA-012 |
| Fix or update the two pin tests | PA2-015 |

## 6. Test and release hygiene

| Fix | Finding |
|---|---|
| ESLint ignores `audit-output/` | PA2-021 |
| Include `lib/systems-configurator/__tests__` in `npm test` | PA2-023 |
| Convert this audit's probe scripts into suite tests as each defect is fixed | [10](10_TEST_AND_PERFORMANCE_REPORT.md) |
| Replace the 34 text-only tests that claim security behaviour with behavioural ones, starting with invitations | PA2-024 |
| Staging Supabase project with one account per role; run `test:e2e:staging` | [08](08_UI_UX_AND_OPERATOR_AUDIT.md) |
| Policy and grant diff, hosted versus replay | [07](07_DATABASE_AND_MIGRATION_AUDIT.md) |

## Dependencies

```text
Group 1 ──► Group 2a, 2b ──► invite staff and dealers
Group 3.1 ──► 3.2 ──► 3.3 ──► parallel run on the shop floor
Staging environment ──► signed-in acceptance ──► release decision can change
Omalco inputs needed: weighing tolerance, alloy limits, recall policy, invoice basis
```

## Suggested first slice

Group 1 plus 2a and 2b: no workflow redesign, no Omalco input needed, and it removes three of the six P1 findings.
