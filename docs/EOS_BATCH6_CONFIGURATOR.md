# EOS Batch 6: Configurator output release (100)

The existing calculation engines now capture an immutable calculation release:
approved project inputs, versioned rules and master projections, exact persisted
cuts/glass/beading/BOM/material rows, costing, optimization and reconciliation.
Each captured output has input, rule and output fingerprints plus monotonic source
revisions. Changes during calculation are refused. Changes after review invalidate
the release without rewriting its historical snapshot.

An active, versioned template must provide explicit cutting, glass, beading and
hardware rules as applicable. Missing rates remain estimates; missing rules,
incompatible profiles, invalid layout/dimensions, nonfinite values or unreconciled
outputs block fabrication readiness. Checks use the existing engine's recorded
precision for mm, kg, areas and INR. Physical observations are not manufactured.

The exact ready snapshot needs another owner/admin's approval. The calculation
author cannot approve it. The public production handoff, a database status trigger,
and the project button enforce the current release. New handoffs require an
existing canonical customer order; the approved quotation must be converted using
the established commercial workflow. Historical in-production replay is retained.
The handoff retains its exact approved snapshot and order relationship.

Technical PDFs show the captured release identity and are marked
`Draft - not fabrication released` until the current output is independently
approved. Their route checks source revisions around the document reads and uses
private no-store responses. Operational readers get readiness metadata, not the
internal rule/cost snapshots; protected history tables have no client grants.

## Verification

- `tests/configuration-release.test.mjs`: real engine output reconciliation;
  missing rules; incompatible profiles; invalid/nonfinite dimensions; wrong
  glass/material/waste values; estimate classification and strict schemas.
- `tests/configuration-release-sql.test.mjs`: complete schema replay; self-review
  refusal; independent approval and replay; immutable history; input/rule/output
  staleness; exact saved-row comparison; protected helpers/tables; transactional
  rollback and successful canonical handoff into an eligible existing order.
- `tests/configuration-release-browser.test.mjs`: mounted blocked readiness and
  exact-snapshot approval retry at phone and desktop widths.
- Final command results and visual evidence are recorded in
  `../EOS_UPGRADE_BATCH_6.md` and `evidence/EOS_UPGRADE_BATCH_6`.

## Acceptance limits

Local SQL runs use PGlite platform stand-ins; they are not hosted JWT/Storage or
independent database-session contention evidence. No hosted migration, deployment,
physical cutting/glass trial or operator sign-off was performed by this batch.

For signed-in UAT, calculate a fully specified project, independently approve its
release, convert its approved quotation to an eligible order, and hand off the
exact profile jobs. Repeat after a template, profile, dimension or saved-output
change; verify approval and fabrication-ready documents are withheld until the
new output is reviewed. Missing rules and rates must remain visibly unresolved.
