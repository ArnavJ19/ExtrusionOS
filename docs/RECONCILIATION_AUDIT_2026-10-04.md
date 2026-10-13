# Third audit pass: quantity and money reconciliation

Date: 4 October 2026. Scope: production completion, downstream quantity evidence, stock dispatch/reservation units, and the suspected inclusion of credit adjustments in cash collections. This supplements the first two reports; it is not a full release certification.

## C01 - P1: Completed production output can be changed without reconciling downstream evidence

The general production save RPC permits `actual_quantity_kg` and `actual_meters` updates, including on a completed job. The completion and status guards prohibit reopening the job but do not freeze its output when status remains completed. The downstream handoff runs its quantity propagation only on the transition into completed.

Reproduction: seed a completed job and its packaging record at 100 kg. Call the actual private save function with the same completed status, 200 kg actual output, and no billet IDs. The save succeeds: production becomes 200 kg while packaging remains 100 kg. The fixture includes the current completion guard, current production-status guard, and current handoff function. It uses the actual generic JSON update/whitelist helpers. It does not install every reference, lineage, RLS, audit or timestamp trigger, nor exercise the public authenticated RPC or browser UI. The other inspected reference/lineage guards constrain identity and stage, not reconciliation of changed completed output.

Business impact: production output and downstream packaging can disagree after completion. Yield and source-output-based QC limits can then be based on revised quantities which were not validated by the dedicated billet/scrap completion transaction. The QC impact is a source-derived risk, not an additional executed scenario.

Sources:

- `supabase/migrations/20260715000000_atomic_business_workflows.sql:484` - save role checks, output whitelist and generic update.
- `supabase/migrations/20260718021500_floor_output_and_finishing_workflows.sql:33` - completion guard; positive output required but same-status output changes allowed.
- `supabase/migrations/20260810010000_manufacturing_reference_and_material_guards.sql:63` - status guard permits unchanged completed status.
- `supabase/migrations/20260718020500_finishing_route_and_quality_yield.sql:90` - handoff acts only on initial completion.

Required business behavior: completed output is immutable through ordinary saves. Authorized corrections need an explicit audited workflow that checks billet/scrap mass balance and handles existing finishing, packaging, QC and dispatch dependencies atomically. Acceptance: block direct output edits after completion; prove a permitted correction reconciles all affected quantities; reject corrections that invalidate shipped or approved material.

## C02 - P1: Dispatch leaves batch meters stale and corrupts subsequent reservation lengths

The dispatch consumer writes consumed weight and length to the consumption ledger. On full reservation consumption it subtracts batch weight and scales pieces, but leaves `profile_stock_batches.length_m` unchanged. The latest reservation-capacity trigger then calculates a new reservation's length from the stale batch length divided by the reduced weight.

Reproduction with both current capacity guards installed:

| State | Weight | Pieces | Batch length |
| --- | ---: | ---: | ---: |
| Initial batch | 400 kg | 40 | 200 m |
| Dispatch consumes | 100 kg | 10 implied by proportion | 50 m recorded in ledger |
| Remaining batch in database | 300 kg | 30 | 200 m |
| Expected remaining batch under this fixture's uniform ratio | 300 kg | 30 | 150 m |

A new 100 kg reservation calculates **66.667 m**, instead of 50 m. This is distinct from the first audit's stock-capacity ordering failure: sufficient unreserved stock is deliberately left so the dispatch succeeds and the unit inconsistency becomes visible.

Business impact: available metres and subsequent reservation lengths become overstated even though weight appears correct. Material commitments and length-based planning cannot reliably reconcile to the remaining physical batch.

Sources:

- `supabase/migrations/20260721091307_physical_dispatch_stock_provenance.sql:262` - consumption function, especially batch update near line 350.
- `supabase/migrations/20260930000000_astra_audit_fixes.sql:174` - new reserved length derived from batch length/weight.
- `lib/systems-configurator/actions.ts:692` - application reservation flow also uses that ratio.

Required business behavior: weight, pieces and length must describe the same physical remainder. Define exact unit/provenance rules, update remaining dimensions atomically, and reconcile historical batches before trusting length availability. Acceptance: partial and full consumption, multiple reservations, mixed cut lengths, returns and retries must reconcile without inventing pieces or metres. This test covers a uniform batch and full consumption of one reservation, not every scenario in that acceptance list.

## Negative finding: credit-note adjustments are excluded from cash collections

The suspected cash-inflation defect was not confirmed on the inspected reporting path. `private.get_financial_collection_events` explicitly excludes `payment_method = 'credit_note'`. Executing the actual function against a 100 credit-note adjustment and a 200 cash receipt returned only the 200 cash receipt.

Source: `supabase/migrations/20260718010100_financial_collection_analytics.sql:10`.

Invoice settlement uses adjustments separately from this cash-event query. Whether a standalone adjustment can duplicate a separately issued credit remains an open reconciliation question, not a confirmed finding in this pass. This control test does not validate every dashboard/report.

## Evidence and remaining scope

Fresh command: `node scripts/audit-20261004-reconciliation.mjs`.

Result: exit 0; two defect reproductions plus one positive control. These are synthetic in-memory PGlite checks using extracted repository functions, not a full migration replay. An intermediate expanded fixture initially failed because its minimal schema lacked the press-slot table; the fixture was corrected, and the complete command then passed. No application code was modified to obtain the result.

Fresh targeted lint: `node node_modules/eslint/bin/eslint.js scripts/audit-20261004-reconciliation.mjs` passed with exit 0 on the final script. The application unit suite, typecheck and build were not rerun for these audit-only additions.

No new live database access, deployment, business-data mutation or browser UAT was performed. Prior audit findings remain unresolved. Direct-order commercial lineage, partial reservation release, return-stock reconciliation and duplicate adjustment/credit handling still require dedicated end-to-end investigation. No claim of exhaustive coverage is made.

Created only this report and `scripts/audit-20261004-reconciliation.mjs`. No application or migration fixes were made. Business sign-off remains blocked by the accumulated high-priority findings.
