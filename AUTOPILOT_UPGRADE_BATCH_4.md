# Autopilot Upgrade Batch 4

Date: 12 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md) (batch 4, features NEXT; `[N]`/`[NEXT]` left unfilled, so batch 4 and the Delivery plan's next row were taken)
Base: `feat/autopilot-batch-3` at a0ef08d with the user's uncommitted audit-output, evidence-screenshot and `tsconfig.tsbuildinfo` changes left in place; branch `feat/autopilot-batch-4`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain.
Employee acceptance and the batch 4 hosted migration remain separate gates (see the end of this record).

## Selection

Batch 4 of the catalogue's Delivery plan ("Dispatch and compliance"): AP-018, 019, 051, 081, 083, 017, 035, 036, 089, 060.
Batches 1–3 delivered none of them, so no entry was replaced. Work lives in its module: the order record (loading, packing
plan, status link, summary), the dispatch record (freight, summary), the quotation record (freight, summary), the invoice and
production-job records (summary), the customer record (packing spec), the bundle-recording pages, and new pages under the
Dispatches module (`/dispatches/ready`, `/dispatches/loading`, `/dispatches/gate`, `/dispatches/labels`, `/dispatches/packing`,
`/dispatches/eway`, `/dispatches/freight`) and Invoices (`/invoices/tally`), linked from each module's workflow strip.
The public read-only page `/status/<token>` is outside the app shell. No `/tasks/*` hub was created.

| ID | Feature | Foundation found | Gap closed in this slice | Edge evidence |
| --- | --- | --- | --- | --- |
| AP-018 | Verify truck loading by scanning | Prepared physical bundles (EOS-94) with their tags; the dispatch writer `save_ready_dispatch_atomic` that consumes exactly those bundles; NOV-036 vehicle loads (multi-order, manual planning) | A loading session per order (one open at a time) records each scan. The database resolves the tag (or an `EO2:dispatch_package` QR) and refuses: unknown tag, already dispatched, on another vehicle, another customer's bundle ("Do not load"), another order of the same customer, and QC-held material. Held is computed exactly as `assert_dispatch_ready` does (QC-approved and packaged output, accepted finishing, released stock batch, open fulfilment) minus what is already on this vehicle. More than the order line (with the company completion tolerance) or no matching line needs "load anyway" with a note. Planned vs loaded per order line with live pieces and kg. Completing sends the scanned bundles through the existing `saveDispatchAction` (duplicate warning included), then closes the session against that dispatch; a retry finds the dispatch already written | Same tag twice, case-insensitive tags, other customer, other order, held (no QC), third bundle beyond released kg, parallel loader blocked by the active-bundle unique index, cancel frees bundles, over-plan needs a note, removal needs a reason, sales refused, completion with a foreign dispatch refused, the real dispatch writer accepted the scanned bundles |
| AP-019 | Gate-out from the dispatch | Dispatch activation (stock posted) with `actual_dispatched_at`; blank transport fields may be filled after activation; NOV-077 returnable gate passes | The gate lists activated dispatches still `dispatched` (14 days). Security types the plate; it must match the dispatch vehicle (letters and digits only), or is recorded when the dispatch had none; a different vehicle needs a dispatch supervisor's reason. E-way bill required above a configurable threshold (default ₹50,000; an unpriced consignment counts as required): policy `warn` (reason recorded) or `block`. The exit is one row per dispatch and moves the dispatch to `in_transit`. The gate register (date range, search, 10 rows) replaces the paper register for outbound dispatches | Plate mismatch refused, non-supervisor override refused, missing EWB needs a reason, block policy refuses, second exit is a no-op, register shows the reason; settings writable by dispatch manager/accounts only |
| AP-051 | Ready-to-ship list | NOV-036 load planning; EOS-38 line delivery queue; AP-032 credit holds | Packed bundles not dispatched, per order line: released and held kg (same readiness as the writer, cumulative per source in recording order) with the held reason, due date and lateness, grouped by customer and destination (city), 10 groups per page, search and due-date filter, "only released". Credit state per order (held / approved / refused / expired) is shown and marked, never hidden. "Start loading" / "Continue loading" per line | Released 228 kg vs held 114 kg with "QC has not released", released-only filter, credit hold marked, quality role refused |
| AP-017 | Labels print on bundle confirmation | NOV-079 approved label templates (customer/project/order precedence), `label_payload`, `packing_label_prints` | Recording a bundle (trigger, never blocking the bundle) queues its label to the default station with the template's fields only. Without an approved template the job is blocked with the reason and "Check again" re-resolves it. The station page polls every 4 s; with auto-print on it prints the next label and confirms after the print dialog closes, which writes the `packing_label_prints` row (an existing NOV-079 print is linked instead of duplicated). Reprint/damaged/relabel need a reason and supersede the active print. A dispatched bundle drops out of the print queue. Weekly audit: bundles without a printed label, median and 90th-percentile seconds from recording to print, reprints | Blocked without template, retry after approval, only permitted fields, double confirmation prints once, reprint supersedes, audit lists the unlabelled bundle, only supervisors configure stations |
| AP-035 | Packing from profile and customer spec | NOV-079 templates (max kg/pieces, wrapping); packaging materials with their own consumption method and rate; packaging material movements | Versioned packing spec per customer, or a company default (max bundle kg, max pieces, wrapping, interleaving paper, battens, materials), each change a new revision with a reason. `lib/calculations/bundle-packing.ts` (mirrored by `private.ap4_pack_line`, 2,000-case parity test) proposes pieces per bundle (lowest of max pieces, max kg ÷ piece weight, profile standard), bundles and last-bundle pieces, and standard material per line. Shown on the order record and on both bundle-recording pages. Each recorded bundle is compared with its line: more pieces, fewer pieces mid-run, or heavier than the limit → a deviation with a note. Report: standard material for what was packed vs issued (movements) per order | 21 pcs/bundle from 120 kg ÷ 5.7 kg, 720 m film, 100 sheets, 10 battens; revision 2 supersedes; over-kg, over-pieces and mid-run under-pieces recorded; short last bundle is not a deviation; no limit → blank, never zero; dispatch staff cannot set a spec |
| AP-036 | Freight from a transporter rate card | Freight fields on quote lines; transporters as vendors | Rate cards per transporter: per kg or per vehicle type with capacity, by destination state and optionally city (a city card replaces the state card for the same transporter and vehicle), minimum charge, effective dates, retire with a reason. The estimate is an AP-002 proposal (`freight.estimate`) on the quotation, loading session or dispatch, cheapest first, with every option listed; an edit (other option or amount) needs a reason. Accepting fills a blank transporter on the session or dispatch; the session's decision follows its dispatch. Accounts records the billed amount (from the transporter's expense entry against the dispatch, or entered with the bill number). Variance per transporter (90 days). Internal only | Dispatch staff cannot add cards; non-transporter vendor refused; city card 3.8 × 1,000 = 3,800; 1,500 minimum; override without a reason refused; stale once more weight is loaded; only accounts records billed; variance 450 (5 %) |
| AP-081 | E-way bill bulk-upload file | `eway_bill_number` on dispatches; posted invoices with HSN lines and GST split (AP-037) | Queue of loaded dispatches without an EWB (30 days) with value, threshold flag, invoice and distance. Distance is entered once per destination PIN (remembered). `lib/compliance/eway-bill.ts` validates (GSTINs with check digit, PINs, state codes, HSN, distance, vehicle number, 16-character document number) and builds the portal's bulk JSON (`docType INV`, IGST vs CGST/SGST, `URP` for unregistered). Invalid dispatches are listed with what to fix, never exported half-filled. The export is recorded with its schema version and file hash. Pasted portal output (or its downloaded list) fills blank dispatches only; a recorded EWB is never overwritten | No invoice → no document; wrong document number refused at record; remembered distance; paste with spaces in the EWB, unknown document, invalid number; conflict on an existing EWB; sales refused |
| AP-083 | Tally voucher export | Posted invoices, receipt events, on-account credits (AP-058), supplier purchase bills, credit notes | Ledger mapping (party ledgers default to the party name; sales/purchase ledgers per GST rate and local/interstate; tax, bank, cash, round-off, freight, discount). `lib/integrations/tally-xml.ts` builds one Tally "Import Data / Vouchers" envelope (accounting voucher view; debits negative with `ISDEEMEDPOSITIVE=Yes`), balances each voucher (paise to round-off; anything larger is held back), and leaves any voucher with a missing ledger out (it stays pending with the reason). Each voucher is recorded exported once (unique index); exporting again needs "re-export" with a 10+ character reason. Opening (cut-over) invoices are never exported. On-account money is exported once as "On Account"; its later application (`/OA` receipts) is not exported as new money | Exported once, second export refused, re-export with reason, opening invoice excluded, ledger name with `<` refused, sales refused |
| AP-089 | Copy a WhatsApp-ready summary | Transaction communication (invoices, NOV-033) | "Copy summary" on orders, dispatches, invoices, production jobs and quotations. The database returns the facts for the caller's role (`private.ap4_summary`); `lib/communications/record-summary.ts` formats them. The customer version never contains notes, credit state, press or die; the internal version is marked "do not forward" and is refused to viewers. WhatsApp opens with the customer's number for the customer version. No cost, margin, supplier or freight rate in either | Internal notes absent from the customer version, viewer refused the internal one, sales refused invoices, another company's order not found |
| AP-060 | Safe order-status link | Customer/dealer portal (sign-in) | A 64-hex random token shown once; only its SHA-256 is stored with a 4-character hint, expiry (1–90 days, default 14) and revoke reason. `public.ap_order_status` (the one anonymous entry point) returns a fixed projection: order number and dates, stage label, lines with ordered, produced, packed and dispatched quantities, dispatches with vehicle, LR, transporter and status. View count and last view are kept. `/status/<token>` renders it (no-index, no-referrer, rate-limited 30/min per IP). "Share status" copies the link and opens WhatsApp | Hash only, no prices/cost/notes/order value in the projection, invalid/revoked/expired states, view counted, production refused, anonymous cannot call the staff entry point |

## Per-feature recheck, verification, edge tests and audit

| ID | Recheck against the catalogue | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-018 | System does / Build / Guardrails met | 5 SQL + 2 browser | None beyond planned |
| AP-019 | Met | 1 SQL + 2 browser | Accounts and stores may read the register but not tap "Vehicle out"; the page now opens on the register for them |
| AP-051 | Met | 1 SQL + 2 browser | None beyond planned |
| AP-017 | Met; silent printing needs the station browser in kiosk-printing mode | 1 SQL + 2 browser | In-app check showed a bundle that had already left still waiting in the print queue; queued and blocked jobs of dispatched bundles are now hidden (the audit still reports them as unlabelled). Label fields printed in stored-key order; now in a fixed order |
| AP-035 | Met | 2 SQL (incl. parity) + unit + 2 browser | None beyond planned |
| AP-036 | Met | 1 SQL + unit + 2 browser | None beyond planned |
| AP-081 | Met for the posted-invoice basis | 1 SQL + 3 unit + 2 browser | The paste reader first read "0201 3410 0000" across the document number as an EWB; it now reads cells, then a 12-digit cell |
| AP-083 | Met | 1 SQL + 2 unit + 2 browser | Invoices whose item lines do not add up to the taxable value (or have none) could not balance; they now use one sales line for the subtotal |
| AP-089 | Met | 1 SQL + unit + 2 browser | None beyond planned |
| AP-060 | Met | 1 SQL + 2 browser | None beyond planned |

## "Done when" re-check (each entry re-read in full on 12 November)

| ID | Done when | Met? | What is missing, exactly |
| --- | --- | --- | --- |
| AP-018 | Dispatch lines need no typing when all bundles are labelled | Yes | A session covers one order (one dispatch). NOV-036 multi-order vehicle loads remain a separate manual flow; scanning against them is not built |
| AP-019 | The paper gate register can be retired for outbound dispatches | Register built | An operating decision. No `security` role exists, so gate staff use the `dispatch` role; inbound and returnable gate passes stay in NOV-077 |
| AP-051 | Dispatch planning starts from the list, not phone calls | List built | An operating result. Destination is the customer's city (no ship-to address model exists) |
| AP-017 | Labels print within five seconds; no unlabelled bundles in a weekly audit | Audit and timing built (median and 90th percentile shown) | Needs the station hardware: auto-print without a dialog depends on kiosk-printing mode and the label printer as default. The five-second target is measured on the floor. Labels stay blocked until a packing label template is approved (NOV-079 needs a second person) |
| AP-035 | Packing material consumption can be compared with standard | Yes | The comparison uses packaging material movements per order; if packaging issues are not recorded per job the issued side stays blank (never zero). "Fixed" materials count once per bundle in this standard (the packaging-job screen applies "fixed" once per job) |
| AP-036 | Estimated vs billed freight variance per transporter | Yes | Billed freight comes from an approved transporter expense against the dispatch or is entered by accounts |
| AP-081 | A day's e-way bills need one upload | Yes for dispatches with a posted invoice | Field layout follows the NIC bulk JSON 1.0.0621 as known on 12 Nov 2026; confirm on the first real upload (the version is recorded on every export). Delivery challans (docType CHL) and Part-B-only updates are not generated |
| AP-083 | A day's vouchers import into Tally without manual entry | File built and balanced | Needs a trial import into Omalco's Tally company. Party ledgers use the ExtrusionOS party name unless mapped; per-party mapping exists in the database but has no screen yet. Partly reversed receipts are held back for manual entry |
| AP-089 | Each main record type has a copy button | Yes (order, dispatch, invoice, job, quote) | — |
| AP-060 | Status calls drop for pilot customers | Links and view counts built | An operating result to measure with pilot customers |

## Scope and operating boundaries

- Nothing posts stock, money, quality approval or a customer message by itself. A load posts stock only when a person completes it and the existing dispatch writer accepts it; the gate records an exit; exports are files a person uploads; reminders, summaries and links are sent by a person.
- The scan refusal for held material mirrors the writer's readiness; the writer still re-checks everything at completion.
- Supplier freight rates appear only on internal screens; the status page and customer summaries contain no prices of any kind beyond the customer's own invoice and quotation totals in the customer summary.
- The gate-out now moves the dispatch from `dispatched` to `in_transit` (an existing valid transition).

## Data and security audit

Migration `supabase/migrations/20261112100000_autopilot_batch_4.sql` (additive, ~2,240 lines). 18 new tables, each with
`company_id`, RLS, a role-scoped company read policy, a company-leading index and **no client grants** (all access through
functions). Changes to existing objects: a superset check list on `proposals.proposal_type` (adds `freight.estimate`); an
AFTER INSERT trigger on `prepared_physical_bundles` (label queue and packing check, each catching its own failure so a bundle
is never refused); `private.ap_proposal_versions`, `ap_proposal_editable` and `ap_proposal_apply` replaced with the same
signatures, dispatching the new type first and falling back to the batch 1–3 bodies unchanged. Clients can execute only
`public.ap_dispatch, ap_freight, ap_eway, ap_tally, ap_share` (authenticated) and `public.ap_order_status` (anonymous and
authenticated) in addition to batches 1–3. Company and actor come from `auth.uid()`; dealers are refused; every
security-definer function pins `search_path`; no private batch 4 function is executable by clients. The public status read
accepts only a 64-hex token, compares SHA-256 hashes, and returns a fixed projection. The status route is rate-limited in
`proxy.ts`. Gate updates go through a definer function (the client still cannot change a dispatch status directly).

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | Full chain, 299 files, 0 failures |
| tests/autopilot-batch4-sql.test.mjs | 16 passed (the real dispatch writer accepts scanned bundles; RLS/grant audit; TS/SQL packing parity over 2,000+ cases) |
| tests/autopilot-batch4.test.mjs | 8 passed |
| tests/autopilot-batch4-browser.test.mjs | 18 passed at 375 px and 1280 px; screenshots in docs/evidence/AUTOPILOT_BATCH_4 |
| Earlier suites touched | autopilot-batch1-sql (callable list now includes the six batch 4 entry points), nov-batch9 (allows `20261112*`), autopilot-batch2-sql, autopilot-batch3-sql: all passing (94 tests in the focused run) |
| npm run typecheck | Passed |
| npm run lint | 0 errors from this batch. 1 error remains in `audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11/evidence/capture-inventory.mjs` (outside this batch, as in batch 3) plus earlier warnings in batch 8 tests |
| npm run build | Passed; the ten new routes built (`/dispatches/loading`, `/dispatches/loading/[id]`, `/dispatches/gate`, `/dispatches/ready`, `/dispatches/labels`, `/dispatches/packing`, `/dispatches/eway`, `/dispatches/freight`, `/invoices/tally`, `/status/[token]`) |
| npm test | Full run on 12 November: 3,416 tests, 3,414 passed, 2 failed. Both failures are the NOV-002 workspace pins in `tests/nov-batch2-browser.test.mjs`, caused by the earlier uncommitted `components/layout/workspace-shortcuts.tsx` change that is not part of this batch (the same two as batches 1–3). No failure was caused by this batch |
| In-app browser | `scripts/autopilot-batch4-preview.mjs` (launch config `autopilot-batch4-screens`) serves the real screens with the real gateway on the replayed local database and a demo data set. Checked: loading station at 375 px (scan loaded, an already-dispatched tag refused in red, planned vs loaded table scrolls inside its card), ready list, gate, label station and the order record at desktop width; no console errors. The signed-in real app cannot show these screens until the hosted database has a company, an employee and this migration |

## Hosted migration state

Applied to the hosted project on 13 November 2026 as `autopilot_batch_4_part01`–`part07` (the file split at top-level
statements, `begin;`/`commit;` dropped, each part with the same lock and statement timeouts). It needs no new extension
(`extensions.digest` from pgcrypto is already used by earlier migrations). No scheduled job was added.

Before the apply, the three hosted-only migrations of 11 November (`audit_integrity_repairs`,
`audit_stock_reservation_snapshot`, `audit_packaging_consumption_projection`) were checked: none of their objects is
redefined by batch 4 or 5. After the apply: all 18 tables exist with RLS, one company read policy and no client grants;
`ap_dispatch`, `ap_freight`, `ap_eway`, `ap_tally` and `ap_share` run for `authenticated` only, `ap_order_status` for
`anon`; trigger `zz_ap4_bundle_recorded` is enabled; every hosted function body matches the file when whitespace and
comment lines are ignored. Rolled-back smoke calls as the owner returned for every read command, and station, settings,
packing-spec and Tally-mapping saves worked; `anon` is refused `ap_dispatch`.

## Remaining acceptance

Approve the company packing label template (NOV-079, second person) and set up the packing station browser in kiosk-printing
mode with the label printer; dispatch manager sets the company packing standard and the main customers' specs; enter the
main transporters' rate cards; accounts confirms the e-way bill threshold and gate policy, enters Omalco's PIN code and
city in company settings, and does one trial e-way bill upload and one trial Tally import (mapping the sales, tax, bank
and round-off ledgers first); one week of loads by scan with the paper register kept in parallel, then retire it; share
status links with two pilot customers and count their calls; measure fields typed per dispatch and freight-proposal
acceptance before and after, as the catalogue's batch rules require.
