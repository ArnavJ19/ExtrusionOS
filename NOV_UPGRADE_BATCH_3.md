# November Upgrade Batch 3

Date: 3 November 2026 (Asia/Kolkata)
Catalogue: [NOV_UPGRADES.md](NOV_UPGRADES.md)
Base commit: `9573426cac124d96acce7d55c6ab9e7e7fd6a360`
Development checkout: `.worktrees/codex-v1`
Delivery state: scope registered before application implementation; gap audit and verification pending.

## Selected first-priority work

These ten entries are U1 (first priority), N1 (essential). They are the remaining
medium-complexity first-priority entries after November batches 1 and 2. Existing
financial, task, handoff, delegation and request workflows will be extended where
their actual source and schema support the requirement.

| ID | Target | Required verification |
| --- | --- | --- |
| NOV-040 | Collections with payment promises, follow-up ownership and actual invoice balances | Partial/reversed receipts, duplicate promises, reschedules, settlement and finance isolation |
| NOV-041 | One accountable order coordinator with reviewed transfers and history | Unassigned/imported orders, inactive employees, concurrent reassignment and tenant isolation |
| NOV-043 | Shared explainable operational priority and reasoned overrides | Equal dates, overdue/partial work, blocked readiness, stable ordering and override history |
| NOV-046 | Versioned department handoff expectations and clarification | Incomplete/stale handoffs, response targets, returns, acceptance and retained responsibility |
| NOV-048 | Eligible time-bounded backup ownership | Overlap, invalid employees, cancellation/expiry, incoming work and unchanged action permissions |
| NOV-049 | Daily coordination from live records with persistent decisions | Missing/stale sources, repeat meetings, unresolved decisions, owners and company isolation |
| NOV-050 | Trackable requests between teams | Acknowledge/clarify/resolve/withdraw, duplicates, access loss and source context |
| NOV-056 | Master-data stewardship and reviewed correction requests | Stale/conflicting proposals, inactive stewards, review authority and historical preservation |
| NOV-097 | Review the consequences of a supported final action | Changed source, duplicate confirmation, expired review, server recheck and uncertainty |
| NOV-098 | Retained authoritative results and interrupted-request recovery | Response loss after commit, actual rejection, repeated taps, reload and authorized outcome lookup |

## Implementation and evidence rules

- Recheck each target against current owning source before editing it.
- Preserve unrelated analytics, navigation, migration, audit and generated changes.
- Keep tenant identity and authority on the server and preserve existing RLS.
- Use additive migrations where necessary; no hosted migration or deployment is implied.
- Keep promises separate from payments and responsibility separate from authority.
- Verify each implemented feature with meaningful domain and integration edge cases.
- Defer lint and broad test commands until a concrete verification need exists.
- Record actual commands/results, created/modified files, security changes, manual
  checks, limitations and remaining hosted/operator gates before completion.

The initial scope commit exists to make the requested draft PR reviewable before
application work begins. It makes no feature-completion claim.
