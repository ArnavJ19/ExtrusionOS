# Autopilot Upgrade Batch 7

Date: 14 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md), Features = NEXT (the Delivery plan's "5 onward" row: remaining entries by delivery rank)
Base: `feat/autopilot-batch-6` at 178b5b7; branch `feat/autopilot-batch-7`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain. The migration is **not** applied to the hosted database. Employee acceptance is a separate gate.

## Selection

The next ten undelivered entries by delivery rank after batches 1–6. Every U1 entry and the first ten U2 entries were delivered earlier. Ranks 59 (AP-015) and 60 (AP-019) were delivered in batches 2 and 4, so they were skipped and the selection continued to rank 66. No selected entry had been delivered before.

| Rank | ID | Feature | Foundation found | Gap closed in this slice | Where the work happens |
| --- | --- | --- | --- | --- | --- |
| 55 | AP-086 | Date chips on every date filter | Shared `DateRangeFilter` used by the module database pages | Today, Yesterday, This week (Monday start), This month, Last month, This FY (from 1 April) chips on the shared filter; IST days; pressing the active chip clears it. The gate register and the Tally export, which had their own date inputs, now use the shared filter | Every module database page with a date field, gate register, Tally export |
| 56 | AP-090 | Recently used values first | `SearchableSelect` | The person's last five choices for that field (per signed-in user, in this browser) appear first under "Recently used" while nothing is typed. Only values still in the field's current, server-authorised options are shown; storage that is blocked or full is ignored | Every searchable selector (customer, profile, die, order, invoice and lookup fields) |
| 57 | AP-099 | Paste screenshots into attachments | Technical-document upload (dies, profiles) and the proof-of-delivery upload | Shared `AttachmentDropZone`: click to choose, drop a file, or click it and press Ctrl+V. Clipboard images get a dated name (`pasted-YYYYMMDD-HHMMSS.png`); the same company-scoped upload checks (type, 10 MB) apply | Die and profile records (technical documents), dispatch record (POD) |
| 58 | AP-003 | Proposal acceptance tracking | AP-002 `proposals` (status, edited fields, decision payload) | Read model per proposal type and per deciding role (recorded at the decision): prepared, accepted, edited, rejected, expired unanswered, stale, fields typed per decision, median time to decide. Twelve-week trend; most corrected fields with the value people type instead. Flags: overridden more than accepted (review), always accepted with 20+ decisions (sample), mostly expiring. Rule changes are recorded and compared before/after on acceptance and fields typed | Settings → Automation quality (`/settings/automation-quality`) |
| 61 | AP-025 | USB scanner in any field | Scan page resolver (`resolveScanAction`), QR label prefixes `EO`/`EO2` | App-wide keyboard-wedge listener: a fast EO-prefixed burst ending in Enter is a scan. In a field that accepts scans it fills that field through the authorised lookup; in an ordinary text field nothing is intercepted; with nothing focused the record opens. Unknown or withdrawn labels show the resolver's message | Dispatch "Exact material source" (bundle/job), profile and quotation die fields, die profile field, lookup fields by name (die, billet lot, stock batch, job, machine, profile); scan page |
| 62 | AP-039 | City and state from PIN | Address fields on customers, sites, in-task customer; GST state names (AP-038) | Offline table `public/data/pin-prefixes.json` (lazily loaded, no outside call) maps PIN prefixes to GST state codes; shared prefixes (Chandigarh/Punjab, Daman/Gujarat, Puducherry enclaves, Lakshadweep, Ladakh) ask the person to choose. A different state already typed is offered as a correction, never overwritten. The database stores any known state name or alias with its GST spelling on customers, vendors and project sites. Vendors gain a PIN field | Customer and vendor forms, in-task customer, project sites |
| 63 | AP-040 | Lengths in any unit | `length-units.ts`, quotation length field | The quotation length field accepts "21ft", "6.4m", "6400", "12' 6\"", "12ft 6in", "640cm", "250in" and shows the millimetres beside it before saving. The text as said is kept on the line (`quote_items.length_input_text`) | Quotation line entry |
| 64 | AP-057 | Last price and variance on PO entry | Purchase order lifecycle (lines carry description and unit, no item link) | Every PO line gets a database price check when written: the last three prices on issued POs for the same description and unit (any supplier), this supplier's last price, variance against the most recent price. Above the threshold (default 5%, owner/admin set) a reason is required before the PO can be issued; a reason can be given while drafting or on the draft PO. Visible to purchase and management roles only | PO entry and PO record (`/vendors/purchasing`), `/vendors/purchasing/prices` |
| 65 | AP-064 | Customer delay notices | AP-063 daily line predictions | When the nightly prediction turns a line red, a notice per order is drafted in customer wording (internal blockers such as "finishing lead time missing" never appear) with the new expected date. A newer estimate replaces an unsent draft; a recovered line withdraws it. Sales edits, copies or opens WhatsApp, then records sent (channel) or skipped (reason). An unknown estimate needs a date before sending. Coverage counts late lines with a recorded communication | Order record panel, `/orders/delay-notices` |
| 66 | AP-079 | Monthly customer statements | Receivables rule (`recalculate_invoice_collection_state`), AP-001 jobs, AP-004 calendar, PDF engine, email provider | From the first working day of each month the morning job prepares last month's statement for every customer with a balance (once; a missed day catches up): opening, invoices, receipts (refunds count back), credit notes, closing, open invoices, money on account. PDF statement; WhatsApp/copy text; provider email; recorded sent per channel or skipped; rebuild an unsent statement after a correction; coverage | `/payments/statements`, `/api/pdf/statement/[id]` |

## Per-feature recheck, tests and audit

| ID | Recheck against System does / Build / Guardrails | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-086 | Met. One shared component; IST, Monday weeks, April FY | 1 unit + 2 browser | The gate register and Tally export must always have a range, so their chips do not clear |
| AP-090 | Met. Local storage with fallback; per user | 1 unit + 2 browser | Pressing Enter with nothing typed now picks the most recent value (first in the list); typed searches are unaffected |
| AP-099 | Met for the record attachment areas that upload files | 1 unit + 2 browser (synthetic paste and drop) | Other upload screens (maintenance, supplier documents, assurance evidence) keep their file pickers |
| AP-003 | Met. Counts by type and role, never by person | 3 SQL + 2 browser | The corrections list showed proposed/corrected values to every reader; it is now limited to roles that may decide that proposal (owner/admin always), with a regression test |
| AP-025 | Met. Resolution through the authorised lookup; unknown codes explained | 1 unit + 2 browser (keyboard emulation) | A scan in a plain text field is left as typed (never intercepted), so a misfire cannot replace someone's notes |
| AP-039 | Met for state; district needs the India Post directory (see Scope) | 1 SQL + 1 unit + 2 browser | None |
| AP-040 | Met. Stored in metres (exact), mm shown, text kept | 1 SQL + 2 unit + 2 browser | Existing tests and screens use the unit selector; a bare number follows it, except a bare number of 100 or more with metres selected is read as millimetres. The kept text always names its unit |
| AP-057 | Met. Purchase and management roles only | 2 SQL + 2 browser | The purchase screen's older browser tests bundle it with only the purchase actions stubbed; the price check therefore goes through `purchasePriceAction` in the purchase action module, not the generic gateway |
| AP-064 | Met. Never sent automatically; copying is not sending | 3 SQL + 2 browser | The notice printed "600.0 kg"; weights now print without trailing zeros. A copy reported its note twice; fixed |
| AP-079 | Met. Each statement reads only that customer's invoices and reaches receipts and credit notes through them | 4 SQL + 1 unit + 2 browser | The generic "send" accepted the provider channel, so anyone could record "sent by provider"; it is now refused and only `send_provider` (called by the server action after the provider accepted) records it |

## "Done when" recheck

| ID | Done when | Met? | Exactly what is missing |
| --- | --- | --- | --- |
| AP-086 | All database pages use the shared filter | Yes for every database page with a date filter (module database pages, gate register, Tally export) | Database pages without a date dimension (dies, dealer orders, finishing workload, purchasing, supplier comparisons, tasks) have no date filter to replace |
| AP-090 | Common selections take one tap | Yes: open the field, tap the recent value | Recents live in this browser only (a different PC starts empty) |
| AP-099 | A copied image attaches in one step | Yes on die/profile documents and the dispatch POD | The upload still needs storage configured as today |
| AP-003 | A rule change can be compared before/after on acceptance rate and fields typed | Yes | Fields typed is measured on proposals only, not on every form |
| AP-025 | A bundle selector can be filled by scanning on a desktop | Yes (dispatch material source), verified with keyboard emulation | Not yet tried with Omalco's actual USB scanner model; the scanner must be in keyboard mode with Enter as the suffix |
| AP-039 | New addresses have consistent state names | Yes (database stores GST spelling; PIN fills the state) | District fill needs the India Post "All India Pincode Directory" CSV: `node scripts/build-pin-prefixes.mjs --directory <csv>` writes `public/data/pin-districts.json`; not bundled because it was not available offline here. The prefix table is state level and should be spot-checked against Omalco's customer PINs |
| AP-040 | No separate conversion step in quotation entry | Yes | Order and production length fields keep their existing entry |
| AP-057 | High-variance POs carry a reason | Yes: a draft PO with an unjustified flagged line cannot be issued | Lines match on description and unit (no item master link on purchase lines), so differently worded descriptions are separate items |
| AP-064 | Late lines have a recorded customer communication | Coverage built | An operating result: sales must send or skip each notice |
| AP-079 | Every customer with a balance receives a monthly statement | Coverage built | An operating result. The provider email sends the statement text; the PDF is downloaded and attached by a person (the email provider integration has no attachment support) |

## Scope boundaries

- Nothing automatic sends a customer message or posts money. Delay notices and statements are prepared; a person sends and records them. "Copied", "sent" and "sent by provider" are separate states.
- AP-003 readers are owner, admin and factory manager; only owner and admin record rule changes.
- AP-025 resolves through the same scan lookup as the scan page; it opens a record only when no field is focused.
- AP-039 uses an offline state-level table; no address is sent outside. A different typed state is offered as a correction, not replaced. Two-digit codes and unknown text in the state field are stored as typed.
- AP-040 keeps the stored value in metres (the existing column), exact to the micrometre; millimetres are shown. Changing the stored unit would have been a destructive change to a priced column.
- AP-057 price history uses issued purchase orders only (drafts are not prices yet). The threshold applies to lines written after it is saved.
- AP-064 runs inside the nightly late-line prediction (no separate job). Statement and notice texts contain no cost, margin or internal note.
- AP-079 shows money received on account but not yet allocated separately (its allocations already appear as receipts). Reversed receipts and credit notes are excluded as they stand now. A provider email sends text only.

## Data and security audit

Migration `supabase/migrations/20261114200000_autopilot_batch_7.sql` (additive, one file). Five new tables (`automation_rule_changes`, `purchase_price_settings`, `purchase_line_price_checks`, `order_delay_notices`, `customer_statements`), each with `company_id`, RLS, a role-scoped read policy and a company-leading index; no client grants (reads and writes only through the gateways, as in batch 6). New columns: `proposals.decided_role` (set by trigger at the decision), `vendors.pincode` (format check, not validated against old rows), `quote_items.length_input_text` (length and control-character check). `quote_items_authorized` gains `length_input_text` at the end; every other column and rule is unchanged (the migration appends to the stored definition and fails if it cannot). Four gateways (`ap_quality`, `ap_price`, `ap_delay`, `ap_statement`) take company and actor from `auth.uid()`, refuse dealers, check roles per command and pin `search_path`. `purchase_lifecycle_command` is wrapped: the original moved to `private.ap7_purchase_lifecycle_v1` (not client-executable) and keeps all its checks; the wrapper only adds the price-reason gate on issue and records reasons given at creation. `private.ap5_predict_lines` is wrapped the same way to draft notices. AP-001 registry and executor are extended by rename-and-wrap as in batches 1–6.

Customer-facing outputs (delay notice text, statement text and PDF) contain only that customer's order lines or invoices, receipts and credit notes; no cost, margin, supplier rate or internal note. Price history and supplier rates are visible to owner, admin, accounts, stores and the plant head only.

Server-side validation: Zod schemas in `lib/autopilot-batch7/commands.ts`, `lib/actions/purchase-lifecycle.ts` (price action) and `lib/actions/autopilot-batch7.ts` (statement email); the database re-checks every command. No new dependency.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | 305/305 files, 0 failures |
| tests/autopilot-batch7-sql.test.mjs | 13/13 (AP-003, 039, 040, 057, 064, 079, wiring, RLS/grants) |
| tests/autopilot-batch7.test.mjs | 8/8 units (length parser, PIN table, date chips, recent values, scanner burst, pasted names, schemas/registry/statement rows) |
| tests/autopilot-batch7-browser.test.mjs | 10/10 at 375 and 1280 px; screenshots in `docs/evidence/AUTOPILOT_BATCH_7` |
| npm run typecheck | Passed |
| npm run lint | Passed, 0 errors, 0 warnings |
| npm run build | Passed; the five new routes compiled (`/settings/automation-quality`, `/vendors/purchasing/prices`, `/orders/delay-notices`, `/payments/statements`, `/api/pdf/statement/[id]`) |
| Full npm test | See "Full suite" |
| In-app browser | Preview `autopilot-batch7-screens` (real screens and gateways on replayed local SQL, synthetic records): quality, statements and delay notices checked at 1280 px and 375 px; no console errors; no page-level horizontal scroll |

### Full suite

| Run | Result |
| --- | --- |
| Full run (20 min) | 3,560 tests across 76 suites: **3,556 passed, 4 failed**, 0 skipped, 0 cancelled |
| `autopilot-batch2-browser` ×2 | Writing a screenshot to the OneDrive folder failed (`UNKNOWN: open …die-service-375.png`, `…samples-375.png`), the file lock seen in batch 6. Re-run alone: 17/17 |
| `autopilot-batch7-browser` shared inputs at 375 px | Under full-suite load Playwright typed the second (unknown) label slower than the 40 ms scanner gap, so it was not treated as a scan. Re-run alone: 10/10. Real scanners type a character every few milliseconds |
| `autopilot-batch2-sql` AP-028 | **Pre-existing, not caused by batch 7.** The test edits the die-service booking to "today + 2 days"; on Saturday 14 November that equals the proposed date (Monday, the next working day), so the decision is recorded as accepted, not edited. It fails identically on the batch 6 commit (178b5b7, checked in a temporary worktree). It passes on other weekdays |
| After the run | `npm run lint` 0 problems, `npm run typecheck` passed, `npm run build` passed |

### Changes to earlier tests

Registry and grant invariants were updated for batch 7, as earlier batches did: `autopilot-batch1-sql` (client-callable gateway list gains `ap_delay`, `ap_price`, `ap_quality`, `ap_statement`), `autopilot-batch5-sql` (24 registered jobs). The purchase-lifecycle and EOS batch 6 browser fixtures stub the new `purchasePriceAction`.

## File inventory

| Area | Created | Modified |
| --- | --- | --- |
| Database | `supabase/migrations/20261114200000_autopilot_batch_7.sql` | None |
| Library | `lib/autopilot-batch7/commands.ts`, `lib/actions/autopilot-batch7.ts`, `lib/address/pin-code.ts`, `lib/utils/{date-ranges,clipboard-files}.ts`, `lib/preferences/recent-values.ts`, `lib/qr/wedge.ts`, `lib/pdf/statement-pdf.ts` | `lib/actions/{autopilot,purchase-lifecycle,quotes-orders}.ts`, `lib/calculations/length-units.ts`, `lib/jobs/registry.ts`, `lib/validations/{common,schemas}.ts`, `lib/workflow/purchase-lifecycle.ts`, `lib/auth/route-permissions.ts` |
| Screens | `components/modules/autopilot-batch7/{quality,prices,delay,statements}.tsx`, `components/modules/vendors/purchase-price-check.tsx`, `components/ui/{recent-scope,wedge-scanner,attachment-drop-zone,pincode-input}.tsx`; pages `settings/automation-quality`, `vendors/purchasing/prices`, `orders/delay-notices`, `payments/statements`; route `api/pdf/statement/[id]`; asset `public/data/pin-prefixes.json` | Shared date filter, searchable select, length input, technical-document upload, POD upload, dispatch form, purchase lifecycle, quotation form, record form and module config (PIN fields), in-task customer, project sites, scan page, app shell, order record, module links, settings and automation pages, gate and Tally screens |
| Verification | `tests/autopilot-batch7{,-sql,-browser}.test.mjs`, `scripts/lib/autopilot-batch7{,-browser}-fixture.mjs`, `scripts/autopilot-batch7-preview.mjs`, `scripts/build-pin-prefixes.mjs`, screenshots `docs/evidence/AUTOPILOT_BATCH_7` | Earlier invariant tests and two browser fixtures (above); `.claude/launch.json` (preview entry) |

## Hosted migration state

Not applied. Apply `supabase/migrations/20261114200000_autopilot_batch_7.sql` to `AlExMS` only when authorised. After applying, pg_cron's existing morning window picks up `receivables.statements`; delay notices are drafted by the existing nightly `orders.predict_late` run.

## Remaining acceptance

Owner/admin set the purchase variance threshold (default 5%) and record rule changes when they adjust a rule. Accounts reviews the first monthly statement run and decides whether provider email (Resend or the email webhook) is configured. Sales sends or skips delay notices for a fortnight and checks the coverage line. Stores/dispatch try the actual USB scanner (keyboard mode, Enter suffix) on the dispatch form. Spot-check the PIN table against Omalco's existing customer PINs, and load the India Post directory if district fill is wanted.
