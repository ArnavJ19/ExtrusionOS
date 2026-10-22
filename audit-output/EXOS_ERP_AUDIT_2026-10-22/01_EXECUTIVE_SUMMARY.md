# Report 1 — Executive Audit Summary (22 October 2026)

## Verdict

ExtrusionOS is **not yet fit to be the system of record for a live extrusion plant**, but it is close. The 20 October audit's 33 findings are fixed and live on hosted, and the core write paths are now database-enforced: dispatch capacity, invoicing coverage, the period lock, QC release, die and press exclusivity, and the input-evidence gate.

This second pass found a different class of failure:

- **Privileged deletes** that bypass the lifecycles those fixes built.
- **Metal-balance and chemistry checks** that validate against the plan instead of physical reality.
- **Stock records split across two tables** in packaging and dealer stock.
- **A deployment that cannot be rebuilt from git.**

| Severity | Count | Confirmed by execution | Confirmed statically or on hosted | Probable / NBD |
| --- | --- | --- | --- | --- |
| P1 | 7 | 6 | 1 | 0 |
| P2 | 11 | 4 | 4 | 3 |
| P3 | 4 | 0 | 2 | 2 |
| IMP | 2 | — | — | — |

## Most consequential findings

1. **AUD2-001.** An owner/admin can hard-delete a delivered dispatch that hasn't been invoiced yet. The goods vanish from the books, and the same output then ships again (executed).
2. **AUD2-002.** Completing a job consumes billets that never went to the press. An honest completion is rejected, so the operator must invent about 1,000 kg of "loss" (executed). On hosted, J-2026-0001 would consume all 15 billets today without one issue record.
3. **AUD2-003.** The cast result accepted 74.9 kg of billets from 65.7 kg of charged metal (melt loss −9.2 kg) and released the batch (executed).
4. **AUD2-004.** An operator can return a quarantined, off-spec metal lot to "available" and charge it, with no approval or audit row. A "returned" lot stays in stock and stays payable (executed).
5. **AUD2-005.** Deleting an open breakdown lifts the press lockout without a root cause. Breakdown, calibration and die-correction history can be hard-deleted with no trace (executed).
6. **AUD2-006.** Deleting a profile master erased 696 kg of finished-goods stock and an order's reservation (executed).
7. **AUD2-007.** Five migrations applied to hosted exist only as untracked files in one worktree, and a committed migration calls a function they define. Restoring from git produces a different, partly broken schema.

## Highest-exposure modules

1. **Foundry and metal sources:** AUD2-003, 004, 009, 016, 017, 020.
2. **Production completion and billets:** AUD2-002, 018.
3. **Dispatch:** AUD2-001, 008.
4. **Maintenance:** AUD2-005.
5. **Dealer stock:** AUD2-012, 013.
6. **Packaging materials:** AUD2-011.

## Traceability weaknesses

- Genealogy is now **structurally present**: source → batch → cast result → billet → issue → job → packing → dispatch → invoice.
- It is **corrupted by normal operations** in three places:
  - Unissued billets are recorded as consumed (AUD2-002).
  - Remnant logs have no identity (AUD2-018).
  - A lot rejected after charging doesn't propagate a hold (AUD2-017).
- It is **erasable by privileged users** through AUD2-001, 005 and 006, and AUD2-015 means many of those erasures leave no old values.

## Go-live blockers

AUD2-001, 002, 003, 004, 005, 006 and 007, plus the AUD2-016 data-baseline decision.

## Business decisions needed

| Topic | Question | Finding |
| --- | --- | --- |
| Dispatch weighing tolerance | What percentage or kg is acceptable between production, packaging and dispatch weighings? | AUD2-008 |
| Coated weight basis | Are finishing and dispatch weights pre-coat (mill) or post-coat? | AUD2-010 |
| Log vs billet | Are 5.8 m logs cut into billets before issue, or issued as logs with remnants? | AUD2-018 |
| Metal recall | Does rejecting a lot after charging put the dependent batches on hold? | AUD2-017 |
| Dealer stock | Is dealer stock the factory's own stock (one ledger) or the dealer's property? | AUD2-013 |
| Purchase valuation | Can purchased metal be received at ₹0? | AUD2-020 |
| Hosted data | Reset the transactional tables or repair them before go-live? | AUD2-016 |

## What was verified, and what remains uncertain

**Verified:**

- The replica runs the exact hosted catalog. The fingerprint of all 386 functions, 598 policies and 324 triggers is identical.
- Ten executed scenarios (`harness/results/`) and eight negative controls held.
- Read-only queries ran against hosted data, storage policies and settings.

**Not verified:**

- Browser and UI journeys, real JWTs and PostgREST.
- Concurrent sessions: PGlite is single-connection, so locking was reviewed only.
- The configurator, CRM, tenders, portal, PDFs and the report builder (relied on earlier audits).
- Performance at production volume.
- The uncommitted app changes in the codex-v1 worktree (PDF overhaul, collaboration workflows), which are not deployed.
