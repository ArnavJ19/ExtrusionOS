# Git consolidation, 20 October 2026

The user requested only `codex/v1` and `main`, with all useful work consolidated
into `codex/v1` before updating `main`. The user specifically required preserving
Claude's latest PDF and report work.

## Retained layout

| Branch | Checkout | Purpose |
| --- | --- | --- |
| `main` | `C:/Users/arnav/OneDrive/Desktop/ExtrusionOS` | Verified consolidated baseline |
| `codex/v1` | `C:/Users/arnav/OneDrive/Desktop/ExtrusionOS/.worktrees/codex-v1` | Ongoing development |

Both checkouts have their own ignored dependencies, build outputs and local
environment file. `.worktrees/` is excluded from Git, ESLint and TypeScript so
the main checkout does not scan the development checkout as application source.
Use the existing two checkouts. Do not create additional working branches or
worktrees without an explicit user request.

## Work preserved

- `d52155b` (`Fixes on PDF Generation`): Claude's latest PDF/report rewrite,
  including the shared document writer, quote/invoice/voucher/configurator PDFs,
  PCDA reports, Report Builder, fonts and original handover in `pdf fix.MD`.
- `9d5ad3a` and `af6d889`: local main commits, including the separately captured
  PDF formatting helper and codebase-index history.
- `71c24dd`: the existing GitHub main merge history.
- `174e744`: the older Claude branch, including its twelve historical SQL files,
  Node 22 pin, compatible export/production checks and customer-field filtering.
- `ec5ef34`: the legacy route-types branch, reconciled with the current generated
  build path. The older practical-workflow branch was already an ancestor.
- The separately verified billet-allocation continuation is imported after its
  owning chat finishes saving its current work and stops its processes.

All branch histories are merged, rather than replacing a branch with another
branch's filesystem. Overlapping older implementations were reviewed against the
newer workflow guards. Atomic invitation acceptance, owner/admin quote approval,
immutable order identity, perimeter-based finishing, recovery/margin validation,
PCDA line totals and the latest PDF layout remain authoritative. The older
experimental custom-role payment changes were not substituted for the current
authorization model. The older redirect-only reservation action was removed;
dispatch consumption continues through the existing atomic database path.

Two legacy test expectations were adapted to current behavior: valid stock
readiness includes available length, and PDF group labels remove internal UUIDs
before shortening the displayed value. PDF renderer behavior was not changed to
satisfy a source assertion. The current quote save also preserves zero numeric
charges after the optional PCDA mapping, retaining the older NOT NULL repair.

## PDF and report preservation

Before promotion, the 18 authored files from `d52155b` (excluding the generated
`tsconfig.tsbuildinfo` cache) were compared by Git blob identity. All product
files match that commit. The Report Builder source test subsequently received
the assertion correction described above. The original PDF handover remains
available; its pending visual/deployment acceptance items are not silently
reclassified as completed by this branch consolidation.

Focused regression verification covers invoice pagination/validation, Unicode
parties and fonts, quote/voucher generation, PCDA customer sanitization, report
finance semantics, grouping, and the reconciled quote/stock/reservation logic.
Full-suite, lint, typecheck and build results are recorded when completed below.

## Recovery and local files

Before mutation, a verified Git bundle of all refs, binary staged/unstaged
patches, copied working/untracked files and local-only environment/test evidence
were saved under:

`C:/Users/arnav/.codex/visualizations/2026/10/20/01a15848-d6f5-74f0-bae0-401bcc15e385/git-consolidation-backup/`

Each snapshot has a manifest with commit refs and SHA-256 hashes for copied
working files and the bundle. Private environment files remain outside Git.
Generated caches and installed dependencies can be recreated. Extra worktrees
are removed only after their final work is captured and included in `codex/v1`.
Old remote branches are removed only after their commits are reachable from the
retained branches. No force push is needed.

No database migration, hosted-data change or application deployment is part of
this consolidation. Restored historical SQL files match names in the already
recorded 20 October hosted ledger; this is source reconciliation, not a new
hosted probe or an instruction to replay them. The allocation continuation's
new candidate migration retains its own not-applied status.

## Verification result

- Initial standalone `npm run typecheck`: passed.
- Focused PDF/report and merge regression set: 54 passed, zero failures/skips.
- Final full-suite, lint, typecheck, build and two-branch parity: pending final
  allocation import and verification.
