# UI, UX and Operator Audit

**This is the weakest part of the audit, and it is not a pass.** No screen was used by a signed-in person in this pass. The hosted project has one real account and I may not enter its credentials; no staging environment with test accounts exists. What follows is source reading, the suite's mounted-browser fixtures, and the earlier audit's smoke checks of a local build. Nothing here says an operator can complete a job on a phone.

## What can be said

| Area | Finding | Basis |
|---|---|---|
| QR scanning | Camera is blocked site-wide by `Permissions-Policy: camera=()` (PA2-008). Manual entry remains | `next.config.ts:51`; earlier Chromium reproduction |
| Signed-out deep links | Go to "Account unavailable", not login (PA2-013) | `proxy.ts:78-83`; earlier built-app reproduction |
| User management | No screen to deactivate a user, change a role or revoke an invitation; the users list is read-only (PA2-001) | `access-control-client.tsx:124` |
| Workspace pins | The two browser tests for pinning fail (PA2-015) | [test.log](evidence/test.log) |
| Overview counts | Tasks and dealer-order overviews compute from capped row sets (250 to 1,000 rows), so totals understate once volume passes the cap (MFA-012) | `tasks/page.tsx:19`, `dealer-orders/page.tsx:26-27` |
| Dashboard stock card | Shows zeros when the data is malformed or the user is suspended (PA2-012) | Reproduced at parser level |
| Module structure | 36 `/database` list pages exist across the modules, following the overview / database / new / detail pattern | File inventory |
| Pagination | List pages delegate to shared client components (for example `ModuleDatabaseClient`). Whether each one pages on the server with a 10-row default was **not verified** per module | Source |
| Large fetches | 22 page files request between 250 and 2,000 rows in one query, mostly lookup lists under `/tasks` and the configurator | Source search |
| Loading and error states | 11 `loading.tsx` and 8 `error.tsx` files for 339 pages; most routes rely on a parent's | File inventory |
| Fake buttons | No "coming soon" placeholders found by text search. Whether every Export, PDF and Send button works was not tested | Source search |
| Browser fixtures | 36 test files mount real components against a fixture database; 57 November features have one | [test-quality.json](evidence/test-quality.json) |

## Not tested at all

- Any role's actual navigation and page visibility.
- Any form submission through the real application, including double-click, stale edits and draft recovery.
- Phone and tablet layouts beyond the earlier audit's login page check at 375, 768 and 1280 px.
- Touch targets, keyboard use, contrast, screen readers.
- PDF, print, download and export output.
- Hindi or other language display.
- The eight operator journeys in the brief (press operator, sales, supervisor, quality inspector, stores scan, dispatch, accounts receipt, director exception).

## Operator risks visible from the defects

| Person | Risk |
|---|---|
| Press operator | Cannot close a job after a partial billet issue; the system pushes them to enter scrap that did not happen (PA2-004) |
| Foundry supervisor | Can save a cast heavier than the charge with no warning (PA2-002) |
| Quality inspector | Can pass a chemistry result that is physically impossible (PA2-003) |
| Stores and packing | Packaging received by stores shows as zero at the packing bench (PA2-007) |
| Stores with a phone | Camera scanning does not work (PA2-008) |
| Director | Cannot remove a departed employee's access from the app (PA2-001) |

## What is needed to close this section

A staging Supabase project with one test account per role, the intended build deployed against it, and a half-day walk-through of the eight journeys on the actual shop-floor phone and office PC. `npm run test:e2e:staging` exists for the automated part and has never been run against a bound environment in any audit.
