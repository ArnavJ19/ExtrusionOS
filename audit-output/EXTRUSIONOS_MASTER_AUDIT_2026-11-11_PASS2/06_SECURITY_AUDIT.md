# Security Audit

**Verdict.** Company isolation and the money-writing functions held under every attack tried. Three things did not: user offboarding is impossible (PA2-001), six storage buckets ignore roles (PA2-005), and the repository does not contain the change that keeps strangers out of a fresh environment (PA2-009). The Next.js version is inside critical advisory ranges (PA2-006).

All probes ran on a native PostgreSQL 18 replay as the `authenticated` role with a synthetic identity. Hosted facts are read-only observations. Nothing was tested through a real signed-in session.

## 1. Sign-up and organisational access

| Question | Result | Evidence |
|---|---|---|
| Can a stranger create a second company? | No. Refused by the single-company trigger. | `S4-stranger-onboards-second-company` |
| Can a stranger become owner when no company exists? | **Yes on a repository replay; no on hosted.** Hosted has the grant revoked by a ledger entry that has no repository file. | `S4-stranger-onboards-when-no-company-exists`; [hosted-refresh.json](evidence/hosted-refresh.json). PA2-009 |
| Can a signed-in account with no staff row read business data? | No. Zero rows from orders, customers, invoices, staff, companies, profiles, alloys, roles, templates. It can read `subscription_plans` and `permissions` (PA2-025). | `S4-*` |
| Can it insert its own staff row? | No (`42501`). | `S1-stranger-inserts-own-app_user` |
| Can it call privileged functions? | 168 of 176 refuse with a permission error; 6 fail on argument validation before reaching a permission check; 2 return an empty value. None returned data. | [rpc-sweep.log](evidence/rpc-sweep.log) |
| Is public sign-up disabled in Supabase Auth? | **Not verified.** The setting is not readable with the access available. Hosted has exactly one Auth user. | — |
| Does the app's sign-up page still work? | The route redirects to login in source. The deployed build was not opened in this pass. | Source |

The six functions that validate arguments before checking the caller are `complete_production_job_with_scrap_atomic`, `configuration_release_command`, `onboard_company_atomic`, `portal_self_service_command`, `purchase_lifecycle_command` and `record_current_login_event`. With valid arguments each was expected to reach its permission check; I confirmed that only for `onboard_company_atomic` (above). The other five are a small residual to test with well-formed payloads.

## 2. Roles and privilege escalation

| Attack | Result |
|---|---|
| User raises own role (viewer, sales, production, dealer, admin) | Refused, but by a broken policy rather than a working one (PA2-001) |
| Admin promotes another user to owner | Refused by the same recursion; the legitimate case fails too |
| User moves self to another company | Refused |
| Suspended user reactivates self | Refused |
| Suspended user reads orders, customers, invoices | 0 rows. Can still read own staff row. Stock snapshot returns all zeros rather than an error (PA2-012) |
| Suspended user runs a November command | Refused, "Not permitted" |
| Viewer, production or sales marks an invoice paid or edits order value | 0 rows changed |
| Accounts edits invoice total or paid amount directly, or inserts, edits or deletes a payment row directly | 0 rows or RLS refusal; the invoice was unchanged afterwards |
| Sales, viewer, production, dealer, suspended or other-company owner records a receipt | All refused |
| Dealer reads internal invoices, costing rates, customers | 0 rows |
| Dealer reads the staff directory | **16 rows** (PA2-016) |
| Owner edits or deletes audit logs, enterprise audit logs, sensitive-action logs or order stage history | 0 rows changed |

**Suspension cannot actually be performed** (PA2-001), so "a suspended user is blocked" is true only for a user suspended by hand in the Supabase dashboard.

**Custom roles.** Not tested. Route and SQL checks use the fixed role list; a custom role configured in settings has no evidence of being enforced (AP-024 stays open).

## 3. Database surface

| Check (native catalog) | Result |
|---|---|
| Public tables with RLS enabled | 516 of 516 |
| Tables with RLS enabled and no policy (deny-all to end users) | 115 |
| Policies | 806; none is a literal `true`; none is granted to `anon` or `public` roles by name |
| `SECURITY DEFINER` functions | 856; every one has a pinned `search_path` |
| Definer functions callable by signed-in users | 176 public, 40 private |
| Definer functions callable without signing in | 5, all identity helpers that return nothing without a session |
| Definer functions that accept a company id from the caller | 1 (`current_portal_user_owns`); returned empty for a non-portal caller |
| Views that run with their owner's rights | 23 `*_authorized` and review views. The hosted advisor flags the same 23 as errors. They are the app's deliberate column-filtering layer; their filters were exercised only through the dealer and viewer read probes above |
| Cross-company reads (13 tables) and writes | 0 rows; inserts into another company refused |

## 4. Storage

Nine private buckets. Three (`documents`, `technical-drawings`, `maintenance-bills`) have their own role-aware policies and were not attacked beyond listing. The other six share four policies that check the company folder only:

| Role | Read | Delete | Upload `.html` | Rename a quote PDF |
|---|---|---|---|---|
| dealer_admin | quote PDFs, reports, company assets | yes | yes | yes |
| viewer | same plus documents and drawings | yes | yes | yes |
| production | same | yes | yes | yes |
| suspended | nothing | no | no | no |
| other company | nothing | no | no | no |

No bucket has a size or type limit (PA2-019). Hosted currently stores zero objects. Signed-URL expiry, PDF filename headers and customer-level ownership of documents were **not tested**.

## 5. API routes

All 32 route handlers were read. Each one authenticates through the session helper or a server action, except invitation acceptance (token) and the cron endpoint (bearer secret), which are public by design. `/api/payments` lacks the Origin check the other mutating routes have (PA2-026, not executed). Rate limiting and the external AI request path were not tested.

## 6. Session handling

A signed-out visitor following a protected link is sent to "Account unavailable" rather than login (PA2-013). Whether an active session is cut off promptly after suspension was not tested and cannot be until suspension exists.

## 7. Dependencies and provider settings

- Next.js 16.2.11: 1 critical advisory entry; 6 high and 9 moderate elsewhere (PA2-006).
- Leaked-password protection is off on hosted (PA2-014).

## 8. Not covered

Real Auth sessions and JWT behaviour, the real Storage API, invitation reuse and expiry, password reset, custom roles, rate limits, secrets in browser bundles and logs, AI request redaction, and the portal beyond one RPC refusal.
