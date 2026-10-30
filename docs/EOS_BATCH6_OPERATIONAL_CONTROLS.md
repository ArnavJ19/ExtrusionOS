# EOS Batch 6: Operational controls

This records the locally implemented scope for 29, 52, 56, 59, 60, 73 and 75.
The final batch gates and evidence links are in `../EOS_UPGRADE_BATCH_6.md`.

## Source quantities and controlled returns (29, 56)

Order details show separately planned production, actual production, packed pieces
and metres, measured packed/departed kg, financial-role billed kg and remaining
physical order demand. Exact `order_item_id` linkage replaces ambiguous reservation
or production IDs in order-line packing aggregates. A database line lock and
cumulative caps protect packing. Unlinked legacy quantities are explicitly flagged;
missing query results do not become zero.

Returns start from the original departed packing line. Actual kg, whole pieces and
metres are captured once and capped cumulatively against the shipment. Another
quality reviewer inspects before disposition. Restored material retains actual
observed length and remains on QC hold. Rework creates a linked follow-up task;
the normal production workflow records subsequent work. Financial credit is a
separate proportional action against the issued invoice. Original invoice totals,
cash and order consumption remain intact. Protected transaction authorizations
also prevent legacy disposition/full-credit routes from bypassing the connected
receipt's inspection or creating duplicate stock/credit.

## External self-service (52)

Active portal identities at `/portal/self-service` derive their company/customer
scope in SQL. Safe order, line and shipment projections expose no costs, rates,
margins or internal notes. The permitted downloadable text summary uses the same
projection and no-store response policy. Guessed IDs are checked by the RPC.
Delivery details and service requests retain the exact summary version and go
into internal review; they do not silently edit dispatched or invoiced facts.
Existing portal identity provisioning remains the enablement mechanism.

## Canonical masters and source review (59, 73, 75)

Master cleanup lists likely duplicates and compares exact snapshots. Compatible
customer/vendor identities or profile specifications require a two-person reviewed
consolidation. The duplicate is retired for future selection, with a canonical
identity reference; historical references and issued snapshots are preserved.
Reactivation, cross-company or incompatible merges, cycles and deletion of reviewed
identities are refused. Existing open POs retain their recorded supplier identity
and can complete after consolidation. Historical transactions are not mass-rewritten.

Important profile, quality observation, payment and criterion-evidence changes
capture before/after source projections and flag dependent work for independent
review. Prior completion timestamps and approval evidence remain. Review may accept
the new basis or create a repeat-check task. Reviewing a newer source change
supersedes older pending reviews while preserving their evidence. Completed task
lineage cannot be reassigned to bypass review.

Selected process-boundary policies reconcile dispatch header kg against verified
packing and invoice header INR against issued lines/tax. Values come from the
source; users can record a reasoned hold or reconcile a complete matching source.
An unexplained difference, stale fingerprint or newer hold blocks completion.
Direct insertion of a completed task and lineage changes follow the same guard.
This batch does not enable a universal automatic reconciliation policy for every
business process.

## Isolated practice transactions (60)

The authenticated practice page uses sample identities and browser-memory state.
It contains guided scenarios and an operations desk: a quotation with GST,
inspection with separately observed pieces/weights, and a reviewed partial dispatch.
The sample ledger supports exact replay, rejects changed/stale reviews and caps
remaining pieces, metres and kg. Reset creates a new sandbox identity and invalidates
old reviews. No Supabase writer, file upload, message provider, browser storage or
business action is imported by the practice implementation. Leaving the page clears
the exercise; there is no practice credential connected to real operations.

## Verification and manual acceptance

- Root unit/edge tests: `master-cleanup.test`, `partial-return-assurance.test`,
  `practice-workspace.test`, `practice-transactions.test`.
- Full-chain local SQL: `master-cleanup-sql.test` and `eos-batch6-core-sql.test`.
  These exercise actual RPCs, issued invoices, measured stock and SQL role/grant
  boundaries. Fixtures are synthetic and do not represent physical stock proof.
- Mounted components: `eos-batch6-browser.test` covers sample isolation/reset,
  canonical comparison invalidation, uncertain return retry and external responses.
- Signed-in acceptance should exercise partial quantities through dispatch and
  finance, a partial returned bundle through independent inspection and credit,
  another customer's guessed portal URL, a stale source-review task, a newer
  reconciliation hold and a two-administrator master consolidation.

Hosted ledger application, real JWT/RLS/Storage access, independent-session races,
physical stock/equipment trials and operator UAT remain separate evidence layers.
