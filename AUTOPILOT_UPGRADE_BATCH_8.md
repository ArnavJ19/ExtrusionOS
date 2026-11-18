# Autopilot Upgrade Batch 8

Date: 15 November 2026 (Asia/Kolkata)
Catalogue: [AUTOPILOT_UPGRADES.md](AUTOPILOT_UPGRADES.md)
Prompt: [AUTOPILOT_BUILD_PROMPT.md](AUTOPILOT_BUILD_PROMPT.md), Features = NEXT (the Delivery plan's "5 onward" row: remaining entries by delivery rank)
Base: `feat/autopilot-batch-7` at 8bbfcb8; branch `feat/autopilot-batch-8`
Delivery state: ten slices implemented and verified locally against the full replayed migration chain. The migration is **not** applied to the hosted database. Employee acceptance is a separate gate.

## Selection

The next ten undelivered entries by delivery rank after batches 1–7. Ranks 70 (AP-017), 72 (AP-035), 73 (AP-036) and 78 (AP-060) were delivered in batch 4, so they were skipped and the selection continued to rank 80. No selected entry had been delivered before (checked against every `AUTOPILOT_UPGRADE_BATCH_*.md`).

| Rank | ID | Feature | Foundation found | Gap closed in this slice | Where the work happens |
| --- | --- | --- | --- | --- | --- |
| 67 | AP-091 | Print selected documents as one PDF | PDF engine (`lib/pdf/document-kit`), invoice and quotation PDFs; no delivery challan existed | A delivery challan PDF (bundles, pieces, lengths, net and gross kg, transport; no price). Invoice, quotation, challan and job-card generation moved into shared loaders used by the single routes and by `POST /api/pdf/batch`, which loads every record through the person's own session, refuses the batch (and lists why) if any record cannot be printed, and merges the rest in the selected order (up to 50). Database pages of dispatches, invoices, quotations and production jobs get a select column, "Select this page", "Print selected (n)"; a single-day date filter on dispatches offers "Print all challans for <day>" | Dispatch, invoice, quotation and production database pages; `/api/pdf/challan/[id]` |
| 68 | AP-092 | Saved filters and personal default views | Filters already in the URL (NOV-091 active filters); named views only in this browser | Views saved on the server per person and page (`saved_list_views`), up to 20 per page; one can be the person's default. Opening a database page without filters applies the default; "My views" lists, applies, sets or clears the default and removes. A saved view is also kept as a Workspace shortcut in this browser, as before | Every module database page (`ModuleDatabaseClient`) |
| 69 | AP-096 | Paper job card with a QR | Production jobs, QR labels (`qr_codes`, version 2 payloads), approved inspection plans, AP-029 billet length choice | One-page job card: profile, order and customer name, die and cavities, alloy and temper, billet length (chosen, recommended or press standard) and diameter, cut length, planned kg, pieces, finish, packing, the approved plan's checks with an empty reading column and sampling instruction, operator fill-in fields. The QR is the job's current label (a new one is issued if none is active) and opens the job from the scanner. Unknown values print "—" | Job record ("Print job card"); production database "Print selected" |
| 71 | AP-020 | Read billet mill test certificates | NOV-069 incoming acceptance, `alloy-composition.ts`, AI provider seam (text only) | Upload a PDF or photo on the received purchase line (or a billet batch). The text layer of a digital PDF is read (`lib/pdf/text-extract.ts`) and parsed (`lib/quality/mtc-extract.ts`) into a draft with each field's confidence and source line; a supplier template adds labels, column order and decimal commas. Quality confirms; the database checks Si/Fe/Cu/Mn/Mg/Zn/Ti against the alloy limits, records which fields were typed, supersedes an earlier certificate, fills a released batch's missing heat number, and tells quality when out of specification. An out-of-specification line cannot be accepted as is (concession or reject only). Coverage lists billet batches without traced chemistry | Incoming acceptance record (`/tasks/assurance/incoming/[id]`), `/quality/certificates` |
| 74 | AP-043 | One die module | `/dies`, `/die-intelligence` | The overview opens with an attention list (nitriding due in seven days, away from the plant, poor recovery, section-weight drift to review) and keeps the full die health table (former Die Intelligence, with die cost per kg for its former roles). Each die record shows its health, its availability (AP-065) and its quality charts (AP-052). `/die-intelligence` redirects to `/dies#die-health`; the navigation item is gone and Dies covers the old route | `/dies`, `/dies/[id]` |
| 75 | AP-044 | One Insights module | Reports, report builder, analytics, command centre, profitability; `docs/KPI_DICTIONARY.md` | `lib/insights/metrics.ts` defines each KPI once (label, definition, exclusions, source, screens, financial or not); recovery % is computed only by `recoveryPercentOf`, now used by the command centre, job performance and the press floor. `/insights` lists the reports a role may open and every KPI definition (financial ones only for owner, admin, accounts). The four reports carry an Insights tab strip; `/reports` redirects to `/insights`; navigation shows one Insights entry. The KPI dictionary is generated from the registry and a test keeps them equal | `/insights`, `/command-center`, `/analytics`, `/profitability`, `/report-builder` |
| 76 | AP-050 | Customer health | CRM, receivables, complaints (batch 6), quotations | Nightly score per active customer: order rhythm against the customer's own usual gap, volume against its usual 90 days, overdue invoices and slower payment, complaints, quotation wins. Each component explains itself; too little history costs no points. Sales sees the lowest scores first with reasons, records each follow-up, and is told on Monday how many are at risk | CRM (`/crm#at-risk`), customer record |
| 77 | AP-052 | Control charts and drift alarms | Inspection plans and results, AP-016 sample results | A chart per active characteristic of every approved plan, per die (coating thickness per finish), with plan limits, centre line, mean, sigma and Cpk. The hourly check raises an alarm (once) when a reading is outside the limits or seven in a row sit on one side of the centre; QC records what it found, which closes the notice | Quality overview (alarm queue), `/quality/spc`, die record |
| 79 | AP-065 | Die availability in the plan | NOV-077 returnable gate passes, AP-028 service bookings, die status | The die shop records when a die is away and its expected return; an open gate pass or a blocking status also counts. A die is unavailable until marked back; an overdue return stays unavailable and is highlighted. Every planned job on such a die is warned (die away on the planned day, or the due date depends on the return); planners get an alert that closes itself when the die is back | Die record, job record, production schedule, factory capacity |
| 80 | AP-069 | Sellable capacity while quoting | NOV-021 promise checks, factory shift capacity and maintenance blocks, AP-004 calendar | For the presses that can run the profile (named on the profile, else those that ran it in the last year, else all extrusion presses): available kg per week from shift capacity on working days less planned maintenance, booked kg from open planned jobs, unscheduled work claiming capacity first, and the earliest realistic week with a dispatch estimate after the finish lead time. "Use this week to promise" records the indication; a read compares indicated weeks with when orders actually finished | Quotation line entry, quotation record, factory capacity |

## Per-feature recheck, tests and audit

| ID | Recheck against System does / Build / Guardrails | Tests | Audit finding and fix |
| --- | --- | --- | --- |
| AP-091 | Met. Per-record authorisation through the person's session; a batch is all or nothing | 3 unit (rows, merge, route) + 2 browser | A failed record used to be possible to skip silently; the route now refuses the batch and lists each problem |
| AP-092 | Met. URL state was already there; the default view is per person and page, on the server | 1 SQL + 1 unit + 2 browser | The menu could overflow a phone screen; it is a fixed sheet below 640 px and closes on Escape or an outside click |
| AP-096 | Met for jobs still to run (completed and cancelled jobs are refused) | 1 unit + PDF build | The QR reuses the job's active label rather than issuing one per print; without permission to issue a label it prints the version 2 code, which still opens the job |
| AP-020 | Met for digital PDFs and pasted text; a photo or scan is attached and typed (see Scope) | 3 SQL + 6 unit + 4 browser | The value table hid the inputs off-screen on a phone; it now stacks per field below 640 px |
| AP-043 | Met. Same queries and RLS; no table changes | 2 unit (navigation, redirect) | The die cost per kg stays limited to the roles that could open Die Intelligence |
| AP-044 | Met for recovery %; the other KPIs are defined once and listed (see Scope) | 2 unit | The press floor's recovery rounded differently from the formula; it now rounds the registry value to two decimals without floating-point noise |
| AP-050 | Met. Internal to owner, admin, sales manager and sales | 2 SQL + 2 browser | Components were listed in database key order; they now show in a fixed order |
| AP-052 | Met. Limits only from approved plans | 1 SQL + 1 unit + 2 browser | An alarm on a reviewed reading would have been raised again by the next run; a reviewed alarm on the same or a later reading is not repeated |
| AP-065 | Met. Overdue returns are highlighted, never assumed back | 2 SQL + 2 browser | The planning alert is raised by a trigger on the job; a failure there is caught so it can never block a planning change (the hourly job retries) |
| AP-069 | Met. Indicative; the order promise check is unchanged | 1 SQL + 2 browser | Draft job lines already covered by a job counted twice in the fixture; real draft lines carry their job once released |

## "Done when" recheck

| ID | Done when | Met? | Exactly what is missing |
| --- | --- | --- | --- |
| AP-091 | A day's challans print in one action | Yes: a single-day filter on the dispatch database offers "Print all challans for <day>" (up to 50) | Bundle labels (AP-017) still print from the label station, one per bundle, as designed there |
| AP-092 | Returning to a page restores the user's default view | Yes on every module database page | Other list screens (autopilot queues, assurance databases) keep their own filters |
| AP-096 | Every released job can print a card | Yes for planned, ready, in-progress and on-hold jobs | Printed on A4 from the browser; a label-printer layout was not requested |
| AP-020 | Every billet batch has chemistry traceable to a certificate | Coverage built and tested | An operating result: certificates must be read for existing batches. Photos and scanned PDFs are not read automatically (no vision provider is configured); the person types the values on the draft, and the original file is kept |
| AP-043 | The die-intelligence route redirects and no information is lost | Yes | None |
| AP-044 | A KPI such as recovery % has one definition used everywhere | Yes for recovery % (one formula, one registry entry, test-enforced) | Analytics numbers computed in SQL follow the same definitions; they were not rewritten |
| AP-050 | Sales sees the top ten at-risk customers each Monday with reasons | Yes (nightly score, Monday notice, lowest ten first) | An operating result: sales must follow up and record it |
| AP-052 | Each active characteristic has a chart and alarms appear on QC's queue | Yes | Charts need readings; plans without readings show an empty chart |
| AP-065 | No job is scheduled on an unavailable die without a warning | Yes: the warning is computed for every planning path and planners are alerted | The die shop must record expected returns; without one, the die shows "return date not recorded" |
| AP-069 | Promised dates align better with actual completion | Measurement built (indicated week against the week the order's last job finished) | An operating result over the coming months; requires press shift capacity to be set up |

## Scope boundaries

- Nothing automatic posts stock, money or quality approval or sends a customer message. Certificate readings are drafts; scores and alarms are advisory; capacity is indicative.
- AP-020 reads the text layer of digital PDFs. Fonts that encode glyph numbers (Identity-H subsets) and scans give no text: the draft stays blank and the person types the values. A vision provider for photos is an open decision. Limits are the standard compositions already used on profiles; company-specific tighter limits are not configurable yet. An incomplete or unknown-alloy certificate does not block acceptance; NOV-069 still requires the certificate reference.
- AP-043 adds no table. AP-044 keeps each report's own route rule; Insights only lists what a role may open.
- AP-050 scores customers with an order in the last year. Missing history costs no points.
- AP-065 treats an approved but not yet departed gate pass as away from today; a die service booking without an expected return is shown as information, not as a block.
- AP-069 press groups come from the profile's compatible presses (machine name or code), else history, else all presses. Maintenance blocks reduce shift capacity by the overlapping hours.
- AP-091 batch printing covers invoices, quotations, challans and job cards; labels and statements keep their own screens.
- AP-092 views are per person and page; another person never sees them.

## Data and security audit

Migration `supabase/migrations/20261115100000_autopilot_batch_8.sql` (additive, one file). Eight new tables (`saved_list_views`, `die_availability_windows`, `quote_capacity_checks`, `customer_health_scores`, `customer_health_followups`, `spc_alarms`, `mtc_templates`, `billet_certificates`), each with `company_id`, RLS, a role-scoped read policy (saved views: the person's own rows) and a company-leading index; no client grants (reads and writes only through the gateways). Six gateways (`ap_views`, `ap_die_window`, `ap_capacity`, `ap_customer_health`, `ap_spc`, `ap_mtc`) take company and actor from `auth.uid()`, refuse dealers and inactive users, check roles per command and pin `search_path`. Two triggers: `zzz_ap8_job_die` on `production_jobs` (alert only; errors are caught) and `zzz_ap8_incoming_accept` on `incoming_dispositions` (refuses "accept" when the line's confirmed certificate is out of specification). AP-001 registry and executor are extended by rename-and-wrap with three jobs (`crm.customer_health` nightly, `quality.spc_check` and `dies.availability` hourly). No existing table or column is altered or dropped.

Certificates are stored in the company's `documents` folder; the action reads the file back through the person's own storage access, hashes it and refuses a path outside the company folder. Batch printing loads every record through the person's own Supabase session. Customer-facing output: the delivery challan carries no price, cost, margin or internal note; the job card is internal and carries no price or cost. Customer health, die cost per kg and financial KPIs are limited to their roles.

Server-side validation: Zod schemas in `lib/autopilot-batch8/commands.ts`, `lib/actions/autopilot-batch8.ts`, `lib/actions/saved-views.ts` and `app/api/pdf/batch/route.ts`; the database re-checks every command. No new dependency.

## Verification

| Check | Result |
| --- | --- |
| Migration chain replay (PGlite) | All files, 0 failures (the batch fixtures replay the chain) |
| tests/autopilot-batch8-sql.test.mjs | 11/11 (AP-092, 065 ×2, 069, 050 ×2, 052, 020 ×3, wiring/RLS/grants) |
| tests/autopilot-batch8.test.mjs | 15/15 units (certificate parser, PDF text, chemistry, draft schema, certificate action, SPC, recovery definition, KPI dictionary/registry/navigation, challan, merge, batch route, job card, saved-view queries and bundle boundary, registry) |
| tests/autopilot-batch8-browser.test.mjs | 14/14 at 375 and 1280 px; screenshots in `docs/evidence/AUTOPILOT_BATCH_8` |
| npm run typecheck | Passed |
| npm run lint | Passed, 0 errors, 0 warnings |
| npm run build | Passed; new routes compiled (`/insights`, `/quality/certificates` (list, new, record), `/quality/spc`, `/api/pdf/{batch,challan/[id],job-card/[id]}`, `/api/saved-views`) |
| Full npm test | See "Full suite" |
| In-app browser | Preview `autopilot-batch8-screens` (real screens and gateways on replayed local SQL, synthetic records): die availability, capacity, customer health, certificate review and saved views checked at desktop and 375 px; no console errors; no page-level horizontal scroll. Two phone problems found and fixed (certificate inputs off-screen, views menu width) |

### Full suite

| Run | Result |
| --- | --- |
| Full run (19 min) | 3,600 tests across 76 suites: 3,554 passed, **46 failed** |
| Cause | 45 were older browser fixtures that bundle the shared database page: it imported the saved-views server action, which pulled server-only code into their bundles. Saved views now go through `POST /api/saved-views` with `fetch`, so no server module reaches the page bundle (a unit test enforces this). 1 was `nov-batch9` migration-order allow-list, which earlier batches extend per date |
| Re-run of every affected file | `collaboration-workflows-browser`, `entry-acceptance-integration`, `nov-batch9`, `nov-upgrades-browser`, `operator-workflows-browser`, `module-database-state-browser`, `module-navigation`, `autopilot-batch8`: 80/80. `autopilot-batch8-sql`, `autopilot-batch8-browser`, `autopilot-batch1-sql`: 40/40 |
| After the fixes | `npm run lint` 0 problems, `npm run typecheck` passed, `npm run build` passed |

### Changes to earlier tests

Registry and grant invariants were updated for batch 8, as earlier batches did: `autopilot-batch1-sql` (client-callable gateway list gains the six gateways; nightly runs per company 11 → 12), `autopilot-batch5-sql` (27 registered jobs), `admin-command-center-practicality` (the die health loader moved from the Die Intelligence page to `lib/dies/intelligence.ts`), `nov-batch9` (the migration-order allow-list gains the batch 8 date). The shared navigation builder places a merged entry where a saved role layout named its old route. The shared server-action fixture (`scripts/lib/nov-batch7-actions-fixture.mjs`) gains a synthetic storage bucket.

## File inventory

| Area | Created | Modified |
| --- | --- | --- |
| Database | `supabase/migrations/20261115100000_autopilot_batch_8.sql` | None |
| Library | `lib/autopilot-batch8/commands.ts`, `lib/actions/{autopilot-batch8,saved-views}.ts`, `lib/preferences/saved-views-client.ts`, `lib/quality/mtc-extract.ts`, `lib/pdf/{text-extract,challan-pdf,job-card-pdf,merge,loaders}.ts`, `lib/calculations/spc.ts`, `lib/insights/{metrics,destinations}.ts`, `lib/dies/intelligence.ts` | `lib/actions/autopilot.ts`, `lib/calculations/{alloy-composition,press-output,production-performance}.ts`, `lib/command-center/metrics.ts`, `lib/jobs/registry.ts`, `lib/auth/route-permissions.ts`, `lib/navigation/{app-destinations,task-navigation}.ts` |
| Screens | `components/modules/autopilot-batch8/{certificates,spc,die-availability,die-attention,customer-health,capacity,saved-views,print-selected,insights-nav}.tsx`; pages `insights`, `quality/certificates` (list, new, record), `quality/spc`; layouts for `analytics`, `command-center`, `profitability`, `report-builder`; routes `api/pdf/{batch,challan/[id],job-card/[id]}`, `api/saved-views` | `ModuleDatabaseClient`, quotation form, quotation record, CRM, customer record, die overview and record, job record, schedule, factory capacity, quality overview, incoming acceptance record; `die-intelligence` and `reports` pages (redirects); invoice and quotation PDF routes (shared loaders); `docs/KPI_DICTIONARY.md` |
| Verification | `tests/autopilot-batch8{,-sql,-browser}.test.mjs`, `scripts/lib/autopilot-batch8{,-browser}-fixture.mjs`, `scripts/autopilot-batch8-preview.mjs`, screenshots `docs/evidence/AUTOPILOT_BATCH_8` | Earlier invariant tests and fixtures (above); `.claude/launch.json` (preview entry, untracked folder) |

## Hosted migration state

Not applied. Apply `supabase/migrations/20261115100000_autopilot_batch_8.sql` to `AlExMS` only when authorised. After applying, pg_cron's existing hourly and nightly windows pick up `quality.spc_check`, `dies.availability` and `crm.customer_health`.

## Remaining acceptance

Quality reads the next few supplier certificates and saves a template per supplier; decide whether photos should be read by a vision provider. Stores and quality attach certificates for existing billet batches until coverage is complete. The die shop records expected returns when a die leaves. Production sets press shift capacity (Factory capacity) so quotations can show a week, and lists compatible presses on profiles. Sales follows up the Monday at-risk list and records each call. QC reviews drift alarms for a fortnight and reports false alarms. Dispatch prints a day's challans from the dispatch database and confirms the challan layout.
