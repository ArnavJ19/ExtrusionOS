# Cross-Module Integrity

The tables separate a schema or source link from an executed cross-module transaction. Some tests exercise a representative workflow with pre-seeded evidence. A sourced join or passing isolated command gives no assurance that every ancestor is present in historical records.

## Forward and Backward Lineage

| Link | Required durable identity or evidence | Current evidence | Failure or open condition |
|---|---|---|---|
| Purchased metal → receipt/source | Supplier/bill/receipt and specific source lot | Source, purchase and disposition tables | Historical rate and external source reconciliation remain open. A bill and physical lot must match by approved evidence. |
| Scrap → charge | Lot ID, weighed kg and consumed balance | Foundry batch source links and disposition writer | One scalar scrap source and one external source do not encode a complete multi-lot charge sheet. Quarantine propagation is open. |
| Charge → cast heat | Heat ID, charged and measured dispositions | `foundry_cast_results.foundry_batch_id` and foundry batch | MFA-002 reproduced. Dross and charged mass disagree with reported loss. |
| Heat → billet | `foundry_batch_id` and individual billet identifier | `sync_foundry_billets` and cast result functions | Measured total is apportioned to billets. Individual variation and weighed remnant ancestry need separate evidence. |
| Heat → chemistry release | Batch ID, latest test ID, approved specification and decision | Latest approved-pass trigger | MFA-003 reproduced. Approval alone does not validate chemistry. |
| Billet → issue → extrusion | `production_job_id`, billet ID and actual issued state | `issue_production_billets` and push events | MFA-004 reproduced on ordinary completion. A physical issue and allocation are separate events. |
| Order line → job/die/profile | Source item ID, stable profile/die and specification snapshot | Source-line validation and `technical_spec_snapshot`; Batch 3 draft groups in candidate | Legacy/incomplete line identity, changed profile, unavailable die and split runs require checks against exact job allocations. |
| Production → good stock and scrap | Job ID and recorded output dispositions with units | Completion, origin/QC and scrap-genealogy migrations | Source genealogy can be present with wrong input quantity. Rework and reuse need measured tests. |
| Job/stock → finishing vendor → QC | Same source job or material ID, issue/receipt event, weight basis and decision | Finishing lineage, dispositions, custody and NOV assurance | Partial acceptable returns, coating mass and operator custody acceptance open. |
| QC → release → packing | Stock origin, inspection ID/decision and authorization | `20261021230000_finished_goods_origin_and_qc_hold.sql` and release commands | Release coverage varies by item configuration and sample history. Manual fallback and rejection replay remain open. |
| Stock → bundle split/merge → transfer | Immutable bundle ID, parent/child edges and physical location | NOV-067/068, `november_lifecycle` and `november_specialist` | Whole transfers and splits are different commands. Mixed lineage, damage and replay need real scans and inventory reconciliation. |
| Bundle → packing → dispatch | `packing_list_item_id`, source kind/record and actual departure | Physical packing provenance and reservation consumption | Old packing can lack line attribution. Partial source consumption and timing must reconcile through rollback and retry. |
| Dispatch → invoice | Billable dispatch ID, packed source lines, reviewer fingerprint and commercial snapshots | `reviewed_invoice_source_fingerprint` and retained dispatch invoice guards | Missing packed prices, revised shipping evidence and historical invoice/PDF snapshots need separate validation. |
| Invoice → customer / settlement | Customer snapshot, receipt/credit allocation IDs and reversals | Finance posting commands and retained ledger events | MFA-006/007 can omit upstream bank receipts in the candidate. Advances, credits and returns have different posting bases. |

For a backward query, start from invoice source identity or dispatched packing-line identity, follow each physical source edge to its job/billet/heat, and then recover operators, QC, die and source receipt. A printable reference can help locate a record but cannot fill a missing durable key. NOV-027 trace views are useful navigation and must identify incomplete lineage without fabricating a parent. No single run here reconstructed a real customer shipment all the way back through mixed heats, outsourced finishing and a return.

## Transaction Boundaries

| Workflow | Ownership and control | Evidence and outstanding gate |
|---|---|---|
| Quote approval → order | Server conversion RPC, quote/line snapshots, state and duplicate guards | Source and fixture coverage. Stale preview, two approvers and a lost-response retry on intended release open. |
| Order → production demand | Order-item and manufacturing bases, job scheduling guard | Local demand tests exist. Batch 3 drafts are proposed work with separate release. Audit capture preceded later concurrent UI edits. |
| Production planning → allocation | Order requirement, compatible billet and job assignment | Allocation and normalization fixtures. Parallel competing orders and actual 750/1,500-tonne press configuration open. |
| Allocation → issue → consumption | Separate issue RPC, billet state and job lock | Ordinary completion refusal on 60 kg issued plus 180 kg allocated reproduced. It must keep unissued allocations separate. |
| Completion → stock/scrap | Completion authorization, row locks and triggered side effects | Single-transaction paths reviewed. Independent sessions for simultaneous completion, scrap and final QC remain open. |
| QC hold → release | Inspection outcomes, approved numeric inputs and stock disposition | Release source reviewed. Chemistry condition and missing specifications limit readiness. |
| Finished goods → packaging | Source lines, QC state and package quantity/material evidence | Packaging evidence immutability present. Actual multi-material stock usage and accepted vendor-return basis open. |
| Packaging → dispatch | Source and packing verification, load planning and actual activation | Fixture coverage across source type and partial units. Device evidence, force-failure and independent gate-out cases open. |
| Dispatch → stock reduction | Activation and reserved-batch/consumption posting | Retained movement evidence and replay rules. Reconcile rollback after late dispatch failure, double scan, cancellation and release race. |
| Dispatch → invoice | Billable dispatch source, review, approved fingerprint and persisted invoice snapshot | Financial review fixtures. Draft coverage and final invoice price/basis parity need separate release tests. |
| Invoice → payment and credit | Posting and reversal in financial RPC, settled balances derived from events | Synthetic allocations covered. Bank identity errors are upstream. Explicit bank/accounting control totals and two-session settlement open. |
| Purchase → receipt and valuation | Supplier bill, receipt and stock source tables | Partial procurement implemented. Complete PO, GRN, bill/credit match, provisional rate and valuation sign-off open. |
| Source rejection → downstream hold | Source status changes through `set_metal_source_disposition` | Disposition scope source-reviewed. Descendant quarantine/recall decision open. |
| Return → stock and finance | Return receipt observation, approved stock disposition and separate credit | Local partial return and retained invoice tests. Refund, reopen, nonreturn credit and actual stock receipt need integrated acceptance. |
| Warehouse issue → transit → receipt | Transfer status, bundle identity, source/destination and discrepancy evidence | Whole-bundle specialist command and SQL/browser fixtures. Actual transit custody, historical bundles and concurrent scans open. |
| Configurator → BOM → production | Source revision, saved outputs and approved release fingerprint | Configuration-release SQL covers changed input/rule/output, independent release and handoff guard. Engineering-master and signed-in production acceptance remain open. |

Batch 3 also introduces a credit decision before release or departure. The candidate's exposure read accepts an unknown dispatch price as zero in the comparison. It needs the same pricing identity as the invoice writer and a concurrency case spanning different dispatches for one customer. The two-session number allocator result covers its counter only. [Test report](10_TEST_AND_PERFORMANCE_REPORT.md)
