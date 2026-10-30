# EOS Batch 6: Factory Planning

Features 30, 31, and 37 add factory capacity planning, delivery forecasting, and multi-order vehicle-load preparation. These flows are planning and assignment tools; they do not create stock, consume inventory, or promise a customer delivery date.

## Feature 31: Press capacity and schedule

- The production capacity page renders the existing production schedule rows against active presses, configured weekday/shift capacity, and active planned maintenance. Jobs also show their existing die and billet-allocation readiness, including billets short.
- A user can propose a press/shift/time/capacity move through drag-and-drop or ordinary form controls. The proposal checks the current schedule fingerprint, maintenance, press status, shift coverage, per-shift kg capacity, and overlaps. A separate confirmation applies the existing atomic schedule writer.
- Released slots are locked. New database guards also cover ordinary legacy scheduled/released slot writes, so callers cannot bypass capacity, overlap, maintenance, or press-availability checks.
- Times entered in the UI are explicitly interpreted as IST (Asia/Kolkata). Overnight shifts are supported.

## Feature 37: Delivery proposal

- Forecast input comes from the physical order-line requirement, eligible profile stock, prepared/packed material that has not departed, committed production slots, machine capacity, and configured finishing lead times.
- The forecast identifies assumptions and missing data. An unlinked packed quantity, unresolved physical demand, or missing capacity/finishing input prevents a calculated date from appearing.
- The date is labeled as an internal forecast, separate from the customer promise. Saving or viewing a forecast does not reserve stock or change order status.
- Physical order demand and canonical packing-line linkage depend on the shared partial-line-balance migration `20261029141000_partial_line_balances.sql`.

## Feature 30: Vehicle loads

- Dispatch staff can configure vehicle capacity and prepare a reviewed load from measured physical bundles across multiple orders and customers.
- Each load item retains its physical bundle and its order, customer, destination, source line/kind, profile, and immutable measurements. The UI displays those references alongside the measured kg total and the vehicle capacity.
- Database locks, version/fingerprint checks, request idempotency, same-company/source validation, and a unique active-bundle assignment constraint prevent stale edits and duplicate active assignment. Removing one bundle releases that bundle without changing another order's availability.
- Adding or removing bundles does not consume stock or insert packing-list rows. The existing dispatch writer is blocked while a bundle is attached to a reviewed vehicle load.
- Saved assignments have a separate selective release action. It works after a source becomes ineligible, the vehicle is deactivated, or the load date passes, and retains the other order's assignment. A reason, current load version and stable request identity are required.
- Delivery capacity excludes inactive or unavailable presses even if historical shift-capacity rows remain configured.

## Security and data boundaries

The migrations create company-scoped capacity, maintenance, finishing, vehicle, load, request, and load-item tables with RLS enabled. Direct client table access is revoked; the authenticated server actions use session-derived company identity and role checks, and call pinned `SECURITY DEFINER` RPCs with explicit authorization. RPC inputs and outputs are validated with strict Zod schemas. Source bundles and production inputs are rechecked inside the database transaction.

## Verification

Verification evidence:

- `tests/factory-planning-unit.test.mjs`: four calculation and edge tests.
- `tests/factory-planning-sql.test.mjs`: six full-chain SQL tests, including selective release from a past load with an inactive vehicle and exclusion of disabled press capacity. The earlier configurator digest-schema replay issue was corrected; the combined focused SQL/unit checkpoint passed all 37 tests.
- `tests/factory-planning-browser.test.mjs`: four mounted component cases passed for accessible move/confirm, capacity enforcement, distinct order destinations, a separately labelled forecast, and selective release of a source absent from the candidate list.
- Targeted ESLint for the new workflow, actions, pages, components, tests, and fixtures — passed.

Fresh desktop/phone captures found and fixed a vehicle-table grid overflow. The
phone regression also proves the table remains horizontally scrollable inside its card.

The final source checkpoint, complete command gates and evidence are recorded in
`../EOS_UPGRADE_BATCH_6.md`. Hosted Supabase JWT/RLS behavior, independent-session
contention, migration application, deployment and signed-in UAT are separate
acceptance layers.

## Manual UAT checklist

- Configure two shifts for a press and verify capacity, overnight coverage, active maintenance, and an inactive/broken press prevent invalid reviewed moves.
- Drag a job to a press and complete the same review through the keyboard-accessible form controls. Verify the current plan refreshes after save and that a released slot cannot be moved.
- Compare a delivery forecast with one order that has stock, committed production, and finishing configured against an order with missing physical demand or an unlinked packed line. Confirm no forecast is presented as a customer promise.
- Build a vehicle load from two measured bundles belonging to different orders/customers. Confirm the source, destination, and document basis for each; try an over-capacity load and a duplicate active assignment; remove only one bundle and verify only that bundle becomes available again.
- Dispatch a bundle after removing it from a reviewed load and verify the established dispatch workflow remains the only writer of packing and inventory state.
