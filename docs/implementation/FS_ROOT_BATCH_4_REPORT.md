# FABLE_SUGGESTIONS root batch 4

18 November 2026, root checkout `feat/autopilot-batch-10`, starting at `0ad63a5`. The user's uncommitted e-invoice, Tally, offline and TDS changes were left as they were. Codex is still working on FS-06, 08, 43, 89, 109, 113, 115, 116, 117 and 133 in `.worktrees/codex-v1`. None of those IDs were touched here, and the Codex tracker is the authoritative record for them.

## 1. Batch summary

| | |
|---|---|
| Selected | 10: FS-82, FS-07, FS-51, FS-125, FS-107, FS-65, FS-77, FS-75, FS-132, FS-79 |
| Implemented | 3: FS-82, FS-132, FS-125 |
| Partial | 7: FS-77, FS-79, FS-07, FS-51, FS-65, FS-75, FS-107 |
| Blocked / verified existing | 0 / 0 |
| Final git state | Uncommitted on `feat/autopilot-batch-10` (HEAD `0ad63a5`), alongside the user's own uncommitted work. Nothing pushed. |

**How the IDs were chosen.** They follow the roadmap's phase order, skipping any ID that overlaps Codex's work.
- **Phase 0:** FS-82, 07, 51, 125, 107.
- **Phase 1:** FS-65, 77, 75, 132.
- **FS-79:** its prerequisite, FS-90, is done.

FS-14 is Critical but was not selected. Its multi-lot charge sheet deducts lots through the stock ledger that Codex is rebuilding (FS-08/109).

**Found already in place.**
- Login and logout recording (`record_current_login_event`).
- API rate limiting in `proxy.ts`.
- `private.ist_today()` and `private.business_today()`.
- The KPI registry and dictionary (AP-044).

These were extended rather than duplicated.

## 2. Implementation table

| ID | What was wrong or missing | What was built | Status |
|---|---|---|---|
| FS-82 Business date | 30 live functions (47 uses) and 8 date defaults used the server's UTC date. 20 app call sites used the UTC date. There was no shift-day or financial-year service. | One SQL "today in India" (`private.business_today`, with `ist_today` as an alias). Added `business_date_of`, `business_shift` (a shift belongs to the date it started) and `business_financial_year`, plus `public.business_calendar`. Every function body and default was rewritten. Matching TypeScript helpers were added and the 20 call sites replaced. Guard tests fail on any new raw use. | IMPLEMENTED |
| FS-132 One KPI path | Command Center summed 13 tables itself. Shipped kg used dispatch header weight, not packed net kg. Receivables left out "generated" invoices. It also had invented targets (85% recovery, 20% conversion, 50% receivables). | Every Command Center KPI now comes from `public.fs_kpi`. The invented targets are gone; the page states facts only. A fixture test requires `fs_kpi`, the analytics snapshot and the dashboard snapshot to show equal figures. | IMPLEMENTED |
| FS-125 Die Intelligence | `die_health_metrics` had no key to dies and nothing wrote to it. | **Keying:** the table now has a foreign key to dies. Orphan rows are kept aside in a separate table, not deleted. **Writes:** only the database writes it. Triggers fire on usage updates (the dies row that `refresh_die_usage` updates), job completion, QC, trials, corrections and nitriding, and every die was backfilled. **New data:** kg, runs and billets since nitriding; open corrections; rated life used; recovery trend over 5 against 5 runs. These are shown on the die page. | IMPLEMENTED |
| FS-77 KPI dictionary | No SQL definition for OEE, OTIF, DSO, win rate, die life, kWh/t or conversion cost. Some numbers had no "i". | `private.kpi_values` defines each KPI, with a status: measured, not captured, or not measurable. Added the `/insights/kpis` page with an "i" on every figure. The registry and dictionary were extended and are kept equal by a test. The production-attainment text was corrected to match what is actually computed. | PARTIAL: the "i" is not yet on analytics and dashboard figures. The snapshots compute equal values but do not call `kpi_values`. OEE availability/performance and conversion cost wait for FS-15 and FS-12. |
| FS-79 History tab | Audit rows existed, but no screen showed who changed what. Masters and jobs logged no values. | `public.fs_history` shows field changes, stage moves and approvals, 10 per page. It checks the record's company and the role's page access, and hides cost and margin from other roles. Value capture was added on 6 more tables. The tab is mounted on 12 detail pages. | PARTIAL: foundry, finishing, packaging, quality, purchase-order and expense pages still have no tab. |
| FS-07 Monitoring | No error capture, no health endpoint, and failed jobs were silent. | **Error capture:** browser errors (an error boundary plus a global listener) and server errors (`onRequestError`) are stored with personal data removed. **Alerts:** a new error alerts the owner and admin once a day. A failed job alerts until its next successful run. **Screens and endpoints:** a `/settings/system-health` page, plus `/api/health` (token or owner session) and `/api/health/live`. | PARTIAL: no external tracker, uptime monitor or phone alerts (these need a provider). No `global-error.tsx`. |
| FS-51 Security | Sign-in happened in the browser with no lockout. Browsers could write login rows. There was no origin check, no bucket limits, and no rate limit on PDFs. | Server-side sign-in with a rate limit and a lockout after 5 failures in 15 minutes. The IP address and browser are recorded from the server. Browser login inserts are revoked. Added login history, a cross-site check on `/api` writes, rate limits on PDF, reports and health, and bucket size and type limits. | PARTIAL: 2FA belongs to FS-06 (Codex) and the hosted Auth settings. Leaked-password protection, session and device list, CSP, dependency automation, incident-response plan and penetration test are not done. |
| FS-65 Weight basis | No single policy. Theoretical and actual weight were compared ad hoc. | **Policy:** stock is fixed at actual kg. The owner decides the invoice basis, per company or per customer; it starts undecided and every change is logged in an append-only table. **Shared calculation:** one function in SQL and in TypeScript, equal by test. **Screens:** a settings screen and a dispatch panel showing both weights. | PARTIAL: Omalco decision #4 is needed before invoice drafting can use the basis. Both weights show on dispatches only. |
| FS-75 Authority matrix | Approval limits were hard-coded per function. There was no delegation and no second approver. | **Tables:** rules (append-only), dated delegations, and an approvals log. **Checks:** amount bands, a second, different approver above a threshold, and "nobody approves their own entry", which applies to the owner too. **Enforcement:** the inbox reads the matrix, and record triggers on quotations and expenses enforce it. **Screens:** a settings screen and a monthly report, and the inbox shows "awaiting second approver". | PARTIAL: enforced only for quote, low-margin quote and expense. The Rs 25,000 accounts ceiling inside the expense workflow still applies. |
| FS-107 Documentation | No single place said which document was current. | Decision records 0001–0005, `docs/DOCUMENTATION_HOME.md` (the living set plus the full archive plan), and a pointer from the index. | PARTIAL: the archive move was refused by this session's permission guard and needs your go-ahead. |

## 3. Detailed changes

**Migrations.** All five only add things, and none deletes data. FS-125 copies orphan metric rows aside before keying.
- `20261119100000_fs_batch4_business_date.sql`: FS-82. Rewrites function bodies through `pg_get_functiondef`, so signatures, security and grants are kept.
- `20261119110000_fs_batch4_kpi_dictionary.sql`: FS-77/132.
- `20261119120000_fs_batch4_die_health.sql`: FS-125.
- `20261119130000_fs_batch4_history_monitoring_security.sql`: FS-79/07/51.
- `20261119140000_fs_batch4_weight_basis_authority.sql`: FS-65/75.

**Access.**
- Every new table has row-level security on and no direct grants.
- Gateways take the company, user and role from the session (`private.ap_ctx`).
- `fs_monitoring_service` and `fs_security_service` can be executed only by the service role.
- Signed-in roles can no longer write directly to `die_health_metrics` or `login_events`.

**Application.**
- `lib/fs-batch4/commands.ts`: Zod schemas and role lists.
- `lib/actions/fs-batch4.ts`: the allow-listed server action.
- `lib/actions/sign-in.ts`: server-side sign-in.
- `components/modules/fs-batch4/*`: the new screens.
- `lib/calculations/weight-basis.ts`, `lib/security/origin.ts`, `lib/monitoring/report.ts`.
- `instrumentation.ts`, `app/(dashboard)/error.tsx`, `app/api/health{,/live}`.

**Authority enforcement detail.** When a second approver is required, the first approval leaves the quotation or expense exactly as it was, apart from `updated_at`. Its version therefore moves on, and the inbox's one-decision-per-version rule still holds. The second approval must come from a different, permitted person on that held version.

**Expected merge conflict.** Codex's FS-133 also edited `app/(dashboard)/command-center/page.tsx` and `command-center-client.tsx` in `codex/v1`.

## 4. Quality report

| Check | Result |
|---|---|
| `npm run lint` | Passed, 0 errors |
| `npm run typecheck` | Passed |
| `npm run build` | Passed. All 6 new routes compiled: `/insights/kpis`, `/settings/{system-health,authority,weight-basis}`, `/api/health`, `/api/health/live` |
| `tests/fs-batch4-sql.test.mjs` (PGlite, full migration chain) | 11/11. Expected values are worked out by hand. Role and other-company refusals, append-only histories and the three-path KPI equality are all checked |
| `tests/fs-batch4.test.mjs` | 8/8. TypeScript and SQL parity, the guards against UTC dates, schemas, routes, the origin check and grants |
| Full `npm test` | 3,757/3,773 on the first run. 14 failures were caused by this batch: the browser bundle that renders the quotation detail page pulled in the new History tab's server code. The tab is now stubbed in `scripts/lib/workflow-browser-bundle.mjs`, as other panels already are. After the fix, `upgrade-workflow-browser` and `dispatch-form-consistency` pass. One `autopilot-batch7-browser` 375 px test failed under full parallel load but passes alone, twice; it touches nothing changed here. The whole suite was not run again after the fix. |
| Touched suites re-run after the fixes | 71/71 (`fs-batch4*`, `nov-batch9`, `admin-command-center-practicality`, `role-aware-sensitive-rls`, `autopilot-batch8`) |
| Hosted apply (AlExMS) | The 5 batch migrations were applied in order by a Haiku agent and re-verified on hosted: no raw `current_date` in any function or default, 9 new functions, the inbox reads the matrix, authority/history/job triggers present, die-health key and new columns present, signed-in roles cannot write `login_events` or `die_health_metrics`, bucket limits set. The user then approved the two uncommitted migrations `20261117120000_einvoice_buyer_snapshot_repair` and `20261117121000_tds_tally_receivable`; both were checked against hosted definitions first and applied (ledger 312 → 319). |
| Browser walk-through of the new screens, staging end-to-end | Not done. No staging environment exists (FS-02), and no browser tests were written for the new screens in this batch |

## 5. Remaining risks and operator actions

**Hosted database**
- All five migrations are applied, and the FS-82 guard holds on hosted.
- The bucket type limits are live. They mirror the app's own upload rule, so any CAD format uploaded another way would now be refused.
- Many older local migration files are not in the hosted ledger under their file names. They were left alone, because re-running them could overwrite newer function definitions.
- The new screens are not deployed until this branch is.

**Settings to configure**
- Set `HEALTH_CHECK_TOKEN` (at least 16 characters) in Vercel.
- Point an uptime monitor at `/api/health` and `/login`.
- Error tracking and phone alerts still need a provider (Omalco input #10).

**Decisions needed from Omalco**
- Invoice weight basis (#4), and any customer exceptions to it.
- The authority bands for each transaction type.
- Whether 2FA and leaked-password protection should be switched on in hosted Auth (owner authorisation needed).

**FS-107**
- Approve the archive move listed in `docs/DOCUMENTATION_HOME.md`.

## 6. Next batch (recommended)

1. **FS-79:** finish the History tab on the remaining detail pages.
2. **FS-75:** connect stock adjustment, write-off, purchase order, payment and credit override approvals to `authority_check`.
3. **FS-77:** add the "i" on analytics and dashboard, and have the snapshots call `kpi_values`.
4. **FS-107:** the archive move, once approved.
5. **FS-98:** consequence reviews instead of `confirm()`.
6. **FS-129:** detail-page neighbourhoods.
7. **FS-37:** role home pages.
8. **FS-104** and **FS-139:** after Codex's FS-43 and FS-113/116/117 land.
9. **FS-65:** apply the invoice basis once Omalco has decided.

## 7. Progress summary (all 139)

IMPLEMENTED 20 · VERIFIED_EXISTING 0 · PARTIAL 21 · BLOCKED 3 · SUPERSEDED 1 · NOT_STARTED 94. This includes Codex-owned statuses copied from the Codex tracker.
