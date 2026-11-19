# FABLE_SUGGESTIONS — Making ExtrusionOS a 2026–27-grade ERP for Omalco

**Written:** 11 November 2026, against commit `a0ef08d` (`feat/autopilot-batch-3`).
**Basis:** the pass 2 forensic audit (`audit-output/EXTRUSIONOS_MASTER_AUDIT_2026-11-11_PASS2/`), a read of the module, API and dependency inventory, and the existing catalogues (`NOV_UPGRADES.md`, `AUTOPILOT_UPGRADES.md`).

This document is a set of recommendations, not a build record. Nothing here has been implemented.

It has four sets: FS-01 to FS-52 (sections 1–12); FS-53 to FS-88 (sections 13–24); FS-89 to FS-108 (sections 25–32), a deep dive into how the code and database are built; and FS-109 to FS-139 (sections 33–42), a map of how records and modules are connected. The later sets correct several statements in the earlier ones; where they differ, the later set is right.

---

## 1. The honest starting point

ExtrusionOS is already unusually broad: 46 dashboard modules, 339 pages, 296 migrations, 3,374 automated tests, a door-and-window configurator, a customer portal, foundry through to payments. Breadth is no longer the problem.

Three things separate it from an ERP a factory can run on:

1. **Some core numbers can be wrong.** The audit reproduced a cast that creates metal, chemistry that passes at 120 %, a job that cannot be closed after a partial billet issue, and packaging stock held in two places.
2. **Nobody has used it signed in, as a real role, on a real phone.** Every audit so far has tested the database and fixtures. There is no staging environment.
3. **It is not connected to the outside world.** No e-invoice or e-way bill generation, no accounting export to Tally, no weighbridge or spectrometer feed, no installable mobile app, no Hindi.

So the recommendation is not "add more modules". It is: **make the core provably right, make the floor experience effortless, then connect outward.** A smaller system that is always right will impress Omalco far more than a larger one that is sometimes wrong.

### How to read each recommendation

| Field | Meaning |
|---|---|
| **Importance** | **Critical** — do not run the factory on it without this. **High** — large, visible gain in the first year. **Medium** — worthwhile once the above is done. **Polish** — makes it feel finished. |
| **Why** | The reason it matters to Omalco. |
| **Problem it solves** | The specific pain or risk removed. |
| **What we do** | The actual work, in enough detail to scope it. |
| **Effort** | S = days, M = 1–2 weeks, L = 3–6 weeks, XL = a quarter. Rough. |

Where something needs a decision or data from Omalco, it says so. Where I am unsure a capability already partly exists, it says "verify first".

### Summary table

| # | Recommendation | Area | Importance | Effort |
|---|---|---|---|---|
| FS-01 | Close the six audit P1 defects | Foundation | Critical | L |
| FS-02 | Staging environment with one account per role | Foundation | Critical | M |
| FS-03 | Continuous integration that blocks bad merges | Foundation | Critical | S |
| FS-04 | One release record: commit ↔ deployment ↔ database | Foundation | Critical | S |
| FS-05 | Parallel run and signed opening balances | Foundation | Critical | L (mostly factory time) |
| FS-06 | User lifecycle and access administration | Foundation | Critical | M |
| FS-07 | Error monitoring and uptime alerts | Foundation | High | S |
| FS-08 | One stock ledger for every material | Integration | Critical | XL |
| FS-09 | Metal mass-balance engine across the plant | Integration | Critical | L |
| FS-10 | Genealogy graph: one-click forward and backward trace | Integration | High | L |
| FS-11 | Recall and containment workflow | Integration | High | M |
| FS-12 | Costing spine: actual cost per job, per kg, per order | Integration | High | XL |
| FS-13 | Event backbone so modules react to each other | Integration | Medium | L |
| FS-14 | Foundry: multi-lot charge sheet and spec-driven chemistry | Module upgrade | Critical | L |
| FS-15 | Production: press-side terminal and true OEE | Module upgrade | High | L |
| FS-16 | Die management: life prediction and correction loop | Module upgrade | High | M |
| FS-17 | Quality: specification master, sampling plans, certificates | Module upgrade | High | L |
| FS-18 | Finishing and job-work: vendor custody ledger | Module upgrade | High | M |
| FS-19 | Packaging and dispatch: scan-to-load and weighbridge | Module upgrade | High | L |
| FS-20 | Quotations: live metal price, win/loss, margin guardrails | Module upgrade | High | M |
| FS-21 | Receivables: collections cockpit and credit control | Module upgrade | High | M |
| FS-22 | Systems configurator: engineering sign-off and cut optimisation | Module upgrade | Medium | L |
| FS-23 | Dealer network: stock visibility and scheme management | Module upgrade | Medium | M |
| FS-24 | E-invoice and e-way bill generation | New module | Critical | L |
| FS-25 | Tally / accounting bridge | New module | Critical | M |
| FS-26 | Finite-capacity production scheduler | New module | High | XL |
| FS-27 | Material requirements planning | New module | High | L |
| FS-28 | Procure-to-pay with three-way match | New module | High | L |
| FS-29 | Scrap and remelt loop management | New module | High | M |
| FS-30 | Preventive maintenance and spares | New module (verify first) | Medium | M |
| FS-31 | Energy and gas per tonne | New module (verify first) | Medium | M |
| FS-32 | Compliance calendar and document vault | New module (verify first) | Medium | S |
| FS-33 | Shop-floor mode: big buttons, scan first, no typing | UI/UX | Critical | L |
| FS-34 | Installable app that works offline | UI/UX | High | L |
| FS-35 | Hindi and bilingual labels | UI/UX | High | M |
| FS-36 | Live screens without refresh | UI/UX | High | M |
| FS-37 | Role home pages that answer "what do I do now" | UI/UX | High | M |
| FS-38 | Owner cockpit and daily WhatsApp brief | UI/UX | High | M |
| FS-39 | Design-system pass: density, states, accessibility | UI/UX | Medium | M |
| FS-40 | Label and document printing that looks professional | UI/UX | Medium | M |
| FS-41 | Generated database types and typed RPC contracts | Database | High | M |
| FS-42 | Structural delete protection and immutable ledgers | Database | High | M |
| FS-43 | Policy and permission test matrix | Database | High | M |
| FS-44 | Performance at five years of data | Database | Medium | M |
| FS-45 | Backups, restore drill and disaster recovery | Database | Critical | S |
| FS-46 | Tame the migration chain | Database | Medium | M |
| FS-47 | Machine and instrument integration | Integrations | High | L |
| FS-48 | WhatsApp Business API, not just share links | Integrations | High | M |
| FS-49 | Bank feed and payment links | Integrations | Medium | M |
| FS-50 | AI that does real work, safely | AI | Medium | L |
| FS-51 | Security hardening for a real user base | Security | High | M |
| FS-52 | Training, SOPs and in-app help | Adoption | High | M |

---

## 2. Part A — Foundation: earn the right to go live

Nothing else in this document matters until these are done. They are deliberately unglamorous.

### FS-01 — Close the six audit P1 defects

- **Importance:** Critical · **Effort:** L
- **Why:** These are the findings that make the audit verdict "not safe to deploy". Each one would be discovered by the factory within weeks of real use and would cost trust that is hard to win back.
- **Problem it solves:** Metal appearing from nowhere (PA2-002), invalid chemistry passing (PA2-003), operators unable to close jobs honestly (PA2-004), dealers able to read and delete internal documents (PA2-005), no way to remove a departed employee (PA2-001), and a web framework version with critical advisories (PA2-006).
- **What we do:** Follow `12_REMEDIATION_ROADMAP.md` in the audit folder. In order: upgrade Next.js; add the hosted-only onboarding revoke to the repository; fix user lifecycle and storage policies; then completion-on-issued-billets, cast mass balance and chemistry validation. Turn each audit probe script into a permanent regression test as its defect is fixed, so it can never return silently.
- **Needs from Omalco:** weighing tolerance for casting, approved alloy limits, and a recall policy.

### FS-02 — A staging environment with one account per role

- **Importance:** Critical · **Effort:** M
- **Why:** Three audits have now said the same sentence: "no one has used the application signed in". That is the single largest unknown in the project.
- **Problem it solves:** Today there is one hosted database, and it is production. There is nowhere to try a migration, test a role's screens, or let a supervisor practise without touching real records.
- **What we do:** Create a second Supabase project ("staging") and a matching Vercel preview environment bound to it. Seed it with realistic synthetic data: 50 customers, 200 profiles, 100 dies, six months of orders, jobs, dispatches and invoices. Create one login per role (owner, admin, sales, accounts, production manager, press operator, quality, stores, dispatch, dealer admin, dealer staff, viewer, portal customer). Wire the existing `npm run test:e2e:staging` script to it. Every migration goes to staging first and to production only after a signed-in smoke test.

### FS-03 — Continuous integration that blocks bad merges

- **Importance:** Critical · **Effort:** S
- **Why:** The repository has no `.github/workflows`. Lint, typecheck, 3,374 tests and the build only run when someone remembers to run them. At the audited commit, lint was failing and two tests were red.
- **Problem it solves:** Regressions reach `main` unnoticed; "all checks green" depends on a person's memory.
- **What we do:** A GitHub Actions workflow on every pull request: install, lint, typecheck, test, build, migration replay, `npm audit` at high severity. Branch protection on `main` requiring it to pass. Add `audit-output/` to the ESLint ignore list and add `lib/systems-configurator/__tests__` to the test glob (both are audit findings). Add a nightly job that replays the migration chain on real PostgreSQL 17, the hosted version, not only PGlite.

### FS-04 — One release record tying commit, deployment and database together

- **Importance:** Critical · **Effort:** S
- **Why:** The audit could not say which commit the live Vercel site is built from, and found a database change on hosted that exists in no repository file. The hosted migration ledger cannot be matched to repository files by name.
- **Problem it solves:** "What is actually running?" currently has no reliable answer. That makes every incident harder and every audit slower.
- **What we do:** Apply migrations only through the Supabase CLI from the repository, never by pasting SQL in parts, so ledger versions equal file names. Add a `RELEASES.md` (or a `releases` table) recording for each release: git commit, Vercel deployment ID, last migration applied, who approved it, date. Show the commit hash and migration version in the app's Settings → About screen so anyone can read it off the screen.

### FS-05 — Parallel run and signed opening balances

- **Importance:** Critical · **Effort:** L (mostly factory time, not development)
- **Why:** Software can be internally perfect and still start from wrong numbers. No ERP go-live succeeds without a counted, signed opening position.
- **Problem it solves:** Opening stock typed in from memory; receivables that disagree with Tally from day one; no baseline to detect later errors against.
- **What we do:** Use the Autopilot cut-over flow (already built, with second-person approval) to load: a physical count of billets by alloy and diameter, finished stock by profile and length, dies by location and condition, packaging material, scrap by category, and customer-wise receivables agreed with the accountant. Then run ExtrusionOS alongside the existing registers and Tally for one full month. Reconcile weekly: metal in versus metal out, stock, cash. Go live only when two consecutive weeks reconcile within an agreed tolerance.

### FS-06 — User lifecycle and access administration

- **Importance:** Critical · **Effort:** M
- **Why:** The users screen is a read-only table. The audit showed that no role, not even the owner, can deactivate a user or change a role from the app.
- **Problem it solves:** A dismissed employee keeps access. Promotions and transfers need a developer.
- **What we do:** An owner/admin screen for: invite, resend invite, revoke invite, change role, deactivate, reactivate, force sign-out everywhere, reset two-factor. One server-side function performs each change and writes an audit record with who, when, old value, new value. Add a quarterly "access review" list the owner signs off. Decide whether custom roles are a real feature (then enforce them everywhere) or remove the settings that imply they are.

### FS-07 — Error monitoring and uptime alerts

- **Importance:** High · **Effort:** S
- **Why:** No error-tracking or monitoring library is present in the code. When a press operator hits an error at 2 a.m., nobody will know unless they phone.
- **Problem it solves:** Silent failures; bugs reported as "it didn't work" with no detail.
- **What we do:** Add an error tracker (Sentry or similar) to browser and server code with the user's role and route attached, never personal data or prices. Add an uptime check on login and one authenticated health endpoint. Alert the owner's and developer's phone on failure. Add a `system_job_runs` health card so a failed nightly job is visible the next morning. Review the top five errors every week.

---

## 3. Part B — Integrate the modules properly

The modules exist. What is missing is a few shared spines that every module hangs from. These are the highest-leverage engineering investments in the system.

### FS-08 — One stock ledger for every material

- **Importance:** Critical · **Effort:** XL
- **Why:** The audit found packaging stock in two tables that disagree. That is a symptom: different modules keep their own balances (billets, profile stock batches, inventory items, packaging materials, scrap lots, dealer stock).
- **Problem it solves:** "The system says 400 kg, stores says 380, packing says zero." Every disagreement costs a physical recount and erodes belief in the screen.
- **What we do:** Introduce a single append-only `stock_movements` ledger. Every physical event writes one row: material type, item or lot, location, owner (Omalco, customer-owned, dealer), quantity in the base unit, movement type (receipt, issue, transfer, adjustment, scrap, dispatch, return), source document, user, timestamp. Balances become views or maintained projections of that ledger, never independent numbers. Migrate module by module, starting with packaging (already broken), then billets, then finished stock. Each existing table keeps its columns during migration; a nightly reconciliation report shows any difference between the old balance and the ledger until they agree, then the old balance is frozen. Rows are never edited; corrections are reversing entries.

### FS-09 — A metal mass-balance engine across the plant

- **Importance:** Critical · **Effort:** L
- **Why:** Aluminium is the cost. A 1 % unexplained loss on a few hundred tonnes a month is real money, and owners judge an extrusion ERP by whether it can explain where the metal went.
- **Problem it solves:** Today a cast can exceed its charge; dross is left out of melt loss; production balances against allocated rather than issued metal. There is no plant-level statement.
- **What we do:** Define one balance equation per stage and enforce it at the point of entry, with a tolerance set by Omalco:
  - **Melting:** charge (by lot) = good billet + reject billet + dross + melt loss.
  - **Extrusion:** billet issued = good profile + butt ends + process scrap + rejected profile + returned billet.
  - **Finishing:** weight sent = weight returned ± documented coating gain + rejects.
  - **Dispatch:** packed weight = weighbridge net ± tolerance.

  Add a daily and monthly **metal reconciliation report**: opening metal in all forms + purchases − sales − documented loss = closing metal in all forms, with the unexplained difference shown in kg and rupees. Anything outside tolerance creates a task for the production manager with the specific heat or job.

### FS-10 — Genealogy graph: one-click forward and backward trace

- **Importance:** High · **Effort:** L
- **Why:** Architects, façade contractors and export customers increasingly ask "which heat was this from, and show me the test certificate". Being able to answer in ten seconds is a selling point.
- **Problem it solves:** The links exist in separate tables, but no audit has traced one real shipment from invoice back to scrap lot. Mixed lots, splits and rework are untested.
- **What we do:** Build a `lineage_edges` table (parent entity, child entity, quantity, event) populated by the same functions that move stock, so it cannot drift. Add a **Trace** screen: scan or type any identifier (invoice, bundle QR, job, heat, billet, lot) and see the full tree upward and downward with quantities, QC results, operators, die, press and timestamps. Include a "trace completeness" indicator that says honestly when a link is missing rather than inventing one. Export as a PDF genealogy report for the customer.

### FS-11 — Recall and containment workflow

- **Importance:** High · **Effort:** M
- **Why:** When a supplier lot or a heat turns out to be bad, the valuable question is "what else is affected, and where is it now?"
- **Problem it solves:** Rejecting a source lot today changes only that lot (audit PA2-011). Billets, profiles and bundles made from it stay available.
- **What we do:** On a rejection of a lot, heat or billet batch, use FS-10 to list every descendant with its current state: in stock, in process, at a vendor, dispatched, invoiced. Stock still on site is placed on quality hold automatically and cannot be packed or dispatched. Dispatched material generates a customer-notification task with the affected invoices. The recall has an owner, a status and a closure record. **Needs from Omalco:** the policy — which rejections trigger containment and who can release.

### FS-12 — A costing spine: actual cost per job, per kg, per order

- **Importance:** High · **Effort:** XL
- **Why:** Quotations use estimated costs. The owner needs to know whether the order actually made money, and which profiles, dies and customers lose money.
- **Problem it solves:** Wrong quotation costing is the first business problem in `CLAUDE.md`. Without actuals, estimates never improve.
- **What we do:** For each production job, accumulate actual cost: metal consumed at the weighted-average cost of the lots issued, conversion cost from press hours × a rate per press, die amortisation per kg, finishing cost from the vendor bill or internal rate, packing material consumed, freight. Compare with the quote's estimate line by line. Produce: profit per order, per customer, per profile, per die; a variance report (estimate versus actual recovery, scrap, cycle time); and an automatic suggestion to update the standard recovery for a profile after ten runs. Keep it management accounting, clearly labelled, not statutory books — those stay in Tally (FS-25).

### FS-13 — An event backbone so modules react to each other

- **Importance:** Medium · **Effort:** L
- **Why:** Cross-module behaviour is currently written into individual functions and triggers. Adding "when X happens, also do Y" means editing X.
- **Problem it solves:** Missed follow-ups (a failed inspection that does not create a task; a breakdown that does not move the schedule), and growing coupling.
- **What we do:** A `domain_events` outbox table written in the same transaction as the business change (`job.completed`, `inspection.failed`, `dispatch.gated_out`, `invoice.issued`, `payment.received`, `die.due_for_nitriding`). A worker (pg_cron is already running) delivers each event to subscribers: tasks, notifications, WhatsApp, schedule, analytics. Each subscriber is idempotent and its failures are visible. This is the mechanism behind FS-11, FS-38 and FS-48.

---

## 4. Part C — Upgrade the modules you already have

### FS-14 — Foundry: multi-lot charge sheet and specification-driven chemistry

- **Importance:** Critical · **Effort:** L
- **Why:** The foundry is where metal value and alloy quality are decided. It is also where the audit found the two most serious data defects.
- **Problem it solves:** A heat can record only one scrap source and one external source (AP-026). Chemistry pass/fail is typed by a person, not derived.
- **What we do:**
  - **Charge sheet:** any number of charge lines per heat, each a weighed quantity from a specific lot (primary ingot, purchased scrap by grade, in-house scrap by category, alloying additions like Mg and Si, master alloys). The system deducts each lot and shows the predicted chemistry from lot analyses before melting.
  - **Alloy specification master:** per alloy (6063, 6061, 6082 and so on), minimum and maximum for each element, versioned, approved by the quality head. **Omalco supplies the limits**; the system must not ship with invented ones.
  - **Chemistry result:** readings entered or imported from the spectrometer (FS-47); the system computes pass, fail or borderline per element and overall. A failed heat cannot be released; a concession needs a named approver and a reason.
  - **Treatment log:** degassing, fluxing, grain refiner, holding temperature, casting speed, homogenising cycle with actual temperature and time.
  - **Homogenising furnace tracking** as its own step with load, recipe, and release.

### FS-15 — Production: press-side terminal and true OEE

- **Importance:** High · **Effort:** L
- **Why:** The press is the bottleneck and the place where data is hardest to capture honestly. If entry is slow, operators batch it at shift end and it becomes fiction.
- **Problem it solves:** Poor production visibility; scrap and yield loss recorded after the fact; downtime not categorised.
- **What we do:**
  - **Press terminal view** (a tablet at each press): shows the current job, die, billet length, target and actual. Four large buttons: Billet pushed, Die change, Stoppage (with a reason picker), Finish job. Builds on Autopilot batch 2's press-floor capture.
  - **Per-billet log:** billet ID, length, breakthrough pressure and ram speed if the PLC provides them (FS-47), runout length, butt weight.
  - **Downtime with reasons:** die change, die trial, breakdown (mechanical, electrical, hydraulic), no billet, no order, power, waiting for stretcher. Each minute of a shift is classified.
  - **OEE done properly:** availability (run time ÷ planned time), performance (actual kg/hour ÷ standard kg/hour for that profile and press), quality (good kg ÷ total kg). Standards per profile-press pair, learned from history.
  - **Shift handover** auto-filled from the log, signed by both supervisors.
  - **Stretching, cutting and ageing** as tracked steps with their own quantities and losses, ageing with oven load, recipe, and a hardness check before release.

### FS-16 — Die management: life prediction and a closed correction loop

- **Importance:** High · **Effort:** M
- **Why:** Dies are expensive, slow to replace and the commonest reason an order is late. `die-intelligence` already exists; make it predictive.
- **Problem it solves:** Poor die tracking; dies failing mid-order; no evidence for whether a die maker's dies last.
- **What we do:** Track per die: cumulative kg and billets since new and since last nitriding, number of corrections, average recovery and speed, defect history. Predict remaining life from that die's own trend and from similar dies. Raise "order a replacement" when predicted remaining life is below open order demand plus the supplier's lead time. Close the loop on corrections: defect photo → corrector's action → trial result → approved or back again. Rank die makers by life achieved per rupee. Add die-rack locations with QR so a die can be found in a minute. Flag customer-owned dies and amortisation recovered versus owed.

### FS-17 — Quality: specification master, sampling plans and certificates

- **Importance:** High · **Effort:** L
- **Why:** Quality documentation is what wins architectural and export work. Customers ask for a test certificate with every lot.
- **Problem it solves:** Weak quality documentation; pass/fail by judgement rather than against a number (AP-043).
- **What we do:**
  - **Profile specification master:** per profile, critical dimensions with tolerances from the approved drawing, weight per metre tolerance, temper, hardness range, surface class. Versioned with the drawing.
  - **Inspection plans:** what to check, how many pieces, how often (first-off, every Nth billet, last-off), with which instrument.
  - **Tablet entry:** measured values typed or read from a Bluetooth calliper; the system decides pass or fail.
  - **Instrument calibration register** with due dates; an out-of-calibration instrument cannot be selected.
  - **Mill test certificate** PDF generated per dispatch: alloy, temper, heat numbers, chemistry, mechanical properties, dimensions, referencing the applicable standard the customer specifies.
  - **NCR → root cause → corrective action → effectiveness check**, with cost of poor quality in rupees.
  - **Customer complaint** linked back through FS-10 to the job, die, heat and operator.

### FS-18 — Finishing and job-work: a vendor custody ledger

- **Importance:** High · **Effort:** M
- **Why:** Anodising and powder coating are often outsourced. Material at a vendor is still Omalco's stock and, under GST job-work rules, must come back or be accounted for within set time limits.
- **Problem it solves:** "How much of our material is lying at the coater, and since when?" Stock that vanishes into vendors; job-work challans not tracked.
- **What we do:** A vendor-location stock view fed by FS-08: sent, received good, received rejected, still outstanding, by challan and age. Job-work delivery challan PDF. Alerts as material approaches the statutory return window (your CA should confirm the current limit). Colour and shade master with RAL codes, coating thickness or anodising micron class, approved shade panels with photo. Weight gain or loss per process recorded so FS-09 balances. Vendor scorecard: turnaround, rejection rate, shade consistency.

### FS-19 — Packaging and dispatch: scan-to-load and weighbridge

- **Importance:** High · **Effort:** L
- **Why:** Dispatch is where mistakes become the customer's problem: wrong bundle, short quantity, wrong length.
- **Problem it solves:** Delayed dispatches; wrong or short loads; weight disputes; the scanner camera currently blocked by a configuration setting.
- **What we do:** Fix the camera policy first. Then: every bundle gets a QR label at packing; loading is done by scanning each bundle onto the vehicle, and the system refuses a bundle that is on hold, belongs to another order, or is already loaded. Tare and gross weights captured from the weighbridge (FS-47) and compared with the packed weight within tolerance. Photos of the loaded vehicle attached. Dispatch documents generated together: invoice, e-way bill (FS-24), packing list, test certificate, LR copy. A tracking link and the documents sent to the customer by WhatsApp (FS-48). Proof of delivery captured by the driver or customer on a phone. Transporter scorecard and freight reconciliation against the transporter's bill.

### FS-20 — Quotations: live metal price, win/loss tracking and margin guardrails

- **Importance:** High · **Effort:** M
- **Why:** Aluminium price moves daily. A quote priced on last week's rate can lose the margin before the order is confirmed.
- **Problem it solves:** Wrong quotation costing; no learning from lost quotes; discounts given without visibility.
- **What we do:**
  - **Metal price master** updated daily (LME plus premium, or the NALCO/Hindalco/Vedanta list price Omalco actually buys against, plus the INR rate). Entered by hand at first; fed automatically later.
  - **Price-variation clause** on quotes: the quote states the base metal rate and how the price adjusts if the rate at order differs.
  - **Validity that means something:** an expired quote is re-priced at today's rate before it can convert.
  - **Decide the invoice basis** (audit PA2-010): rate × actual kg, or the quoted amount. Print the rule on the quotation.
  - **Win/loss reasons** captured when a quote closes, with a monthly report by reason, salesperson and product.
  - **Margin guardrails:** below a floor margin the quote needs approval, and the approver sees the cost breakdown.
  - **Quick re-quote** from a previous order, and a customer-facing quote PDF that looks premium.

### FS-21 — Receivables: a collections cockpit and credit control

- **Importance:** High · **Effort:** M
- **Why:** Overdue receivables are a named business problem. Cash is tighter than profit in a metal business.
- **Problem it solves:** Follow-ups that live in someone's head; dispatching to customers already over their limit; the credit gate treating an unpriced dispatch as zero (audit MFA-013).
- **What we do:** An ageing dashboard by customer and salesperson with expected-payment dates. A daily collections list: who to call, what they promised last time, what is disputed. One-tap WhatsApp reminder with the statement attached. Promise-to-pay tracking and broken-promise flags. Credit limit and credit days per customer; orders and dispatches beyond the limit need a named approver, and "unknown value" blocks rather than passes. Interest calculation on overdue where terms allow. If Omalco is a registered MSME, a view of buyers who have exceeded the statutory payment period — useful leverage in a reminder (confirm applicability with the CA). Advance receipts, credit notes and on-account money handled end to end and tested.

### FS-22 — Systems configurator: engineering sign-off and cut optimisation

- **Importance:** Medium · **Effort:** L
- **Why:** The door-and-window configurator is the most differentiated feature in the product; fabricators and dealers will judge the whole system by it. Its formulas have never been checked against real system drawings.
- **Problem it solves:** A wrong deduction formula produces wrong cut lengths and wrong glass sizes at scale.
- **What we do:** For each system (sliding 2- and 3-track, casement, fixed, door), have Omalco's technical person verify the deductions, glass clearances, hardware and gasket quantities against the section drawings, and record sign-off against a formula version. Add a golden-sample test per system that fails if output changes. Improve cut optimisation to use stock lengths and existing offcuts, and report waste percentage. Add a visual shop drawing PDF with dimensions for the fabricator. Add wind-load or span guidance only if an engineer supplies the rules; do not invent them. Let a dealer save a project, revise it, and convert to an order without re-entry.

### FS-23 — Dealer network: stock visibility and scheme management

- **Importance:** Medium · **Effort:** M
- **Why:** Dealers are a channel that sells while Omalco sleeps, if they can see stock and order easily.
- **Problem it solves:** Dealer orders by phone and WhatsApp; no view of dealer-held stock; discount schemes tracked in spreadsheets.
- **What we do:** A dealer portal home showing available standard-section stock, price list for their slab, open orders and dispatch status, account statement and downloadable invoices. Order placement in a few taps from a favourites list. Scheme management: quantity slabs, quarterly targets, turnover discounts, computed automatically and shown to the dealer as progress. Dealer stock reconciled through FS-08. Fix the staff-directory exposure first (audit PA2-016).

---

## 5. Part D — New modules worth adding

`CLAUDE.md` says not to add generic ERP modules. Everything below is specific to running an Indian aluminium extrusion plant. A short list of things **not** to build is at the end of this part.

### FS-24 — E-invoice and e-way bill generation

- **Importance:** Critical · **Effort:** L
- **Why:** Today the e-way bill number is a text box someone fills in after generating it on the government portal by hand. E-invoicing is mandatory above a turnover threshold, and an e-way bill is needed for most consignments. Doing both by hand for every truck is slow and error-prone. Confirm with the CA which obligations apply to Omalco today.
- **Problem it solves:** Double entry at dispatch; trucks waiting at the gate; mismatches between the invoice and the portal; penalties for errors.
- **What we do:** Integrate through a GST Suvidha Provider or an API aggregator (ClearTax, Masters India, IRIS and similar) rather than directly. On invoice approval: generate the IRN and signed QR code, print them on the invoice PDF, store the acknowledgement. On gate-out: generate the e-way bill with vehicle and transporter details, and support Part-B update, extension and cancellation within the allowed window. Validate GSTIN, HSN, place of supply and the CGST/SGST/IGST split before submission and show clear errors. Keep a sandbox mode pointed at the provider's test environment for staging. Add GSTR-1 and HSN summary exports for the accountant.

### FS-25 — Tally / accounting bridge

- **Importance:** Critical · **Effort:** M
- **Why:** The accountant and the auditor work in Tally and will keep doing so. ExtrusionOS should be the operational source and feed the books, not compete with them. The code mentions Tally only in an integrations settings screen — verify whether anything real exists.
- **Problem it solves:** Every invoice, receipt and purchase typed twice; ExtrusionOS receivables that disagree with the ledger.
- **What we do:** A ledger-mapping screen (customer → Tally ledger, sales and tax heads, bank accounts). A daily export of sales invoices, credit notes, receipts, purchase bills and payments in Tally's XML import format, with a hash so the same voucher is never imported twice. A reconciliation screen comparing customer balances in ExtrusionOS with a Tally trial-balance import, showing differences. Start one-way (ExtrusionOS → Tally). Do not attempt a full general ledger inside ExtrusionOS.

### FS-26 — A finite-capacity production scheduler

- **Importance:** High · **Effort:** XL
- **Why:** "When will my order be ready?" is the question sales asks production ten times a day. A credible answer is the most visible sign of a serious system.
- **Problem it solves:** Delayed dispatches; promises made without knowing press load; too many die changes.
- **What we do:** A drag-and-drop board per press showing jobs as blocks sized by estimated duration (kg ÷ standard kg/hour for that profile on that press, plus die-change time). Constraints enforced: die available and healthy, die fits the press, billet of the right alloy and diameter in stock, the press's working shifts, planned maintenance. An "auto-arrange" button that sequences to minimise die changes and alloy changes while meeting due dates, which the planner can then adjust. A promise-date calculator on the order screen: given this profile and quantity, the earliest realistic dispatch date. Automatic re-flow when a breakdown or die failure is logged, with a list of orders now at risk. Extend downstream to ageing ovens and finishing later. This builds on the Autopilot planning proposals and NOV execution/capacity work — reuse, do not duplicate.

### FS-27 — Material requirements planning

- **Importance:** High · **Effort:** L
- **Why:** Running out of billet of one alloy or diameter stops a press. Over-buying ties up cash in metal.
- **Problem it solves:** Stock confusion; emergency purchases; idle presses.
- **What we do:** From open orders and the schedule, compute billet demand by alloy, diameter and week; subtract stock and incoming; show the shortfall and suggest a melt plan (for in-house casting) or a purchase requisition (for bought billet). The same for packaging material, dies due for replacement, and consumables with reorder levels. A weekly "what to buy and what to cast" screen for the owner to approve. Keep it explainable: every suggested quantity shows the orders that drive it.

### FS-28 — Procure-to-pay with three-way match

- **Importance:** High · **Effort:** L
- **Why:** Metal and scrap purchases are the largest outflow. Vendors and purchase orders exist; the chain from requisition to payment is only partly connected (AP-027).
- **Problem it solves:** Paying for more than was received; scrap bought on weight with no agreed deduction; no price history per vendor.
- **What we do:** Requisition → vendor comparison (exists) → purchase order → gate entry with weighbridge → quality check (for scrap: grade, moisture, attachment deduction, with photos) → goods receipt → vendor bill matched to PO and receipt → payment. Differences beyond tolerance need approval. Scrap purchases priced on a formula linked to the metal rate less a grade discount. Vendor ledger, debit notes for rejections and short weight, TDS/TCS flags for the accountant, and an MSME-vendor payment-due view so Omalco pays registered small suppliers within the statutory period.

### FS-29 — Scrap and remelt loop management

- **Importance:** High · **Effort:** M
- **Why:** In an extrusion plant with a foundry, in-house scrap is a raw material. Its segregation by alloy decides whether it can be remelted into the same alloy or must be downgraded or sold.
- **Problem it solves:** Scrap and yield loss; mixed-alloy scrap contaminating heats; scrap sold without weight or price records.
- **What we do:** Scrap generated at each stage is recorded by category (butt ends, process scrap, rejected profile, saw chips, dross) and alloy, weighed into labelled bins. Bins are lots in the stock ledger. The charge sheet (FS-14) draws from them. Scrap sales have a weighbridge ticket, a rate linked to the metal price, an invoice and any applicable tax collected at source. A monthly scrap bridge: generated − remelted − sold = change in scrap stock, in kg and rupees. Dross tracked separately to sale or processing.

### FS-30 — Preventive maintenance and spares *(verify first: `maintenance` and `machines` modules exist)*

- **Importance:** Medium · **Effort:** M
- **Why:** An unplanned press breakdown costs more than any planned stop.
- **Problem it solves:** Breakdowns that a schedule would have prevented; spares not in stock when needed.
- **What we do:** Check what the current module covers, then fill gaps: maintenance schedules by calendar and by usage (press hours, billets pushed), checklists on a tablet, breakdown tickets raised from the press terminal that feed the scheduler (FS-26) and OEE (FS-15), a critical-spares list with minimum stock, MTBF and MTTR per machine, and maintenance cost per machine per tonne.

### FS-31 — Energy and gas per tonne *(verify first: `energy` module exists)*

- **Importance:** Medium · **Effort:** M
- **Why:** Power and fuel are the largest conversion costs after labour. Large customers are also starting to ask suppliers for carbon data, and exporters to the EU face reporting on embedded emissions for aluminium products.
- **Problem it solves:** No view of kWh or gas per tonne; no basis to answer a customer's sustainability questionnaire.
- **What we do:** Daily meter readings (manual first, automatic later) for each press, the melting and homogenising furnaces, ageing ovens and compressors. Report kWh and fuel per tonne by stage and by shift. Record recycled-content percentage per heat from the charge sheet. Produce a simple per-tonne emissions estimate using published factors, clearly labelled as an estimate. Only invest further here if a customer or export market actually asks.

### FS-32 — Compliance calendar and document vault *(verify first: `compliance` module exists)*

- **Importance:** Medium · **Effort:** S
- **Why:** A factory has dozens of renewals: factory licence, pollution-board consents, fire NOC, weighbridge stamping, pressure-vessel tests, instrument calibration, insurance, any product certification.
- **Problem it solves:** Lapsed licences found during an inspection.
- **What we do:** A register of each obligation with its document, expiry, owner and reminder lead time; reminders at 60, 30 and 7 days; the certificate stored and version-kept. Small to build, high peace of mind.

### What not to build

| Don't build | Why |
|---|---|
| Full payroll and HR | Commodity software does it better; statutory rules change often. Keep only shift rosters and operator skill records that production needs. |
| A general ledger | The books belong in Tally (FS-25). |
| Multi-company SaaS features | The product is for Omalco only, by decision. |
| A generic CRM with marketing automation | Keep enquiry → quote → follow-up; nothing more. |
| A blockchain traceability layer | The genealogy graph (FS-10) does the job without it. |

---

## 6. Part E — UI and UX

The current interface follows a sound structure (overview, database, new, detail). What it lacks is a shop-floor personality and the modern conveniences people now expect.

### FS-33 — Shop-floor mode: big buttons, scan first, no typing

- **Importance:** Critical · **Effort:** L
- **Why:** The people who create the most important data — press operators, stores, packers, loaders — have gloves on, a noisy environment and little patience for forms. If entry takes more than a few seconds they will not do it in real time.
- **Problem it solves:** Data entered at shift end from memory; operators avoiding the system.
- **What we do:** A dedicated `/floor` experience per station (press, saw, ageing, QC bench, packing, gate). One task per screen. Buttons at least 64 px tall. Scan a QR to select instead of searching. Number pad instead of keyboard. Sensible defaults pre-filled from the job so the operator confirms rather than types. Colour and sound feedback for success and failure. Works in bright light (high-contrast theme). Auto-logout replaced by a quick operator PIN or badge scan so a shared tablet knows who did what. Every existing mobile screen is reviewed against a simple rule: can it be done in three taps and one scan?

### FS-34 — An installable app that works offline

- **Importance:** High · **Effort:** L
- **Why:** There is no service worker or web-app manifest in the code. Factory Wi-Fi drops near furnaces and in the yard. A screen that spins loses the operator.
- **Problem it solves:** Lost entries when the signal drops; the app feeling like "a website" on a phone.
- **What we do:** Make ExtrusionOS a Progressive Web App: installable icon, full-screen, fast start. Cache the floor screens and the current shift's jobs. Queue scans and entries locally when offline, show a clear "3 entries waiting to sync" badge, and send them when the connection returns with idempotency keys so nothing duplicates. Conflicts (the job was closed by someone else meanwhile) are shown to a supervisor, never silently dropped. Offline is limited to capture actions; approvals and money always need a connection.

### FS-35 — Hindi and bilingual labels

- **Importance:** High · **Effort:** M
- **Why:** No translation layer exists. Many operators and supervisors are more comfortable in Hindi (or the local language at the plant) than English.
- **Problem it solves:** Operators guessing at English labels; dependence on one English-reading supervisor.
- **What we do:** Add an internationalisation library and move interface text into message files. Translate the floor, mobile, scan, task and notification screens first; office screens later. Let each user choose a language; offer a bilingual mode that shows both on key buttons. Keep industry terms as the shop floor says them (billet, die, butt, temper), not dictionary translations. Have a supervisor review the wording, not a translation tool alone. Numbers, dates and currency in Indian formats throughout (lakh and crore grouping, DD-MM-YYYY).

### FS-36 — Live screens without refresh

- **Importance:** High · **Effort:** M
- **Why:** No real-time subscriptions are used today. A production board that needs a manual refresh is a report, not a control room.
- **Problem it solves:** Stale boards; two people acting on the same item; supervisors walking to the press to find out status.
- **What we do:** Use Supabase Realtime on a small set of high-value screens: press status board, order stage board, dispatch queue, approval inbox, notifications. Show "updated just now" and who is currently editing a record. Put a wall-mounted TV view in the production office: each press, current job, kg/hour against target, next die, any stoppage in red. Keep it to these screens; real-time everywhere is cost without benefit.

### FS-37 — Role home pages that answer "what do I do now"

- **Importance:** High · **Effort:** M
- **Why:** With 46 modules, navigation is the product's biggest usability risk. Most people need five screens.
- **Problem it solves:** New users lost in the menu; important actions buried.
- **What we do:** One home page per role built from a prioritised action list: approvals waiting for me, things overdue, things due today, exceptions in my area. The sidebar shows only that role's modules, with the rest behind "More". A global command palette (Ctrl+K) to jump to any order, customer, die or profile by number or name, and to start common actions. Recently viewed and pinned items (fix the two failing pin tests). Consistent "next step" button on every record so the workflow is obvious.

### FS-38 — Owner cockpit and a daily WhatsApp brief

- **Importance:** High · **Effort:** M
- **Why:** The owner will judge the system by whether it tells them, without asking, what they need to know. Most owners will look at a phone message before they open a dashboard.
- **Problem it solves:** Lack of owner-level visibility; finding out about a problem days late.
- **What we do:** One mobile-first screen: yesterday's production in tonnes and recovery %, dispatches and invoicing, cash received and overdue, order book in tonnes and days of load per press, stock of billet in days, top five exceptions (late orders, held stock, breakdowns, failed heats, customers over limit). Each number taps through to the list behind it. Every morning at a set time, the same summary arrives on WhatsApp as a short message with a link. Weekly and monthly versions with trends. Every figure must reconcile with the detailed reports — one wrong number on this screen costs more trust than anywhere else.

### FS-39 — Design-system pass: density, states and accessibility

- **Importance:** Medium · **Effort:** M
- **Why:** Only 11 loading and 8 error boundaries exist for 339 pages. Consistency is what makes software feel expensive.
- **Problem it solves:** Blank screens while loading; different-looking tables and forms across modules; small tap targets.
- **What we do:** Audit and unify: one table component (sticky header, column chooser, saved filters, CSV export, 10 rows by default with server paging — verify each of the 36 database pages really pages on the server), one form pattern (inline validation, unsaved-changes warning, draft autosave on long forms), one empty state with a helpful next action, skeleton loaders everywhere, and a friendly error state with a retry and a reference code. Status colours used the same way in every module. Keyboard navigation and focus order on office screens. Contrast checked. Dark theme for the control room. Replace any overview that counts from a capped list with real totals (audit MFA-012).

### FS-40 — Label and document printing that looks professional

- **Importance:** Medium · **Effort:** M
- **Why:** The customer never sees the software; they see the bundle label, the invoice, the test certificate and the packing list.
- **Problem it solves:** Hand-written bundle tags; documents that look home-made next to a competitor's.
- **What we do:** Bundle and rack labels designed for thermal label printers with QR, profile, length, pieces, weight, heat and order, printed straight from the packing screen. A consistent document family (quotation, order acknowledgement, invoice with e-invoice QR, packing list, delivery challan, test certificate, statement of account) sharing one letterhead, typography and footer. Bilingual where useful. Every PDF carries a verification QR that opens a read-only page confirming the document is genuine.

---

## 7. Part F — Database and architecture

### FS-41 — Generated database types and typed RPC contracts

- **Importance:** High · **Effort:** M
- **Why:** `types/database.ts` is a hand-maintained subset, and some RPC calls are cast to `any`. So a passing typecheck does not prove the app's queries match the schema.
- **Problem it solves:** Runtime failures after a migration renames or changes something; false confidence from a green typecheck.
- **What we do:** Generate types from the database in CI and fail the build if the committed file is out of date. Wrap every RPC in a typed function with a Zod schema for input and output, in `/lib`, so components never call `.rpc()` directly. Remove the `any` casts. This also fixes the "malformed response shows as zero" class of bug (audit PA2-012), because an invalid response becomes an explicit error.

### FS-42 — Structural delete protection and immutable ledgers

- **Importance:** High · **Effort:** M
- **Why:** Many history tables hang off their parents with `ON DELETE CASCADE`. What prevents data loss today is the absence of delete policies and some triggers — indirect protection that one future migration could undo.
- **Problem it solves:** A single mistaken policy silently enabling deletion of invoices with their payments, or orders with their production history.
- **What we do:** Change cascades to `RESTRICT` on invoices, payments, orders, production jobs, foundry batches, dispatches and quotes. Replace hard delete with cancel/void states carrying reason and user. Make ledgers append-only at the database level (stock movements, payments, audit logs, stage history): no UPDATE or DELETE privilege for any application role, corrections by reversing entry. Optionally hash-chain the audit log so tampering is detectable.

### FS-43 — A policy and permission test matrix

- **Importance:** High · **Effort:** M
- **Why:** There are 806 row-level policies and 176 privileged functions. 34 test files that sound like security tests only check that strings exist in source files.
- **Problem it solves:** A role quietly gaining or losing access after a change, discovered by a user rather than a test.
- **What we do:** One declarative file: for each role × table × operation, the expected outcome (allowed, own rows only, denied). A test harness that signs in as each role against real PostgreSQL and checks every cell. The same for each RPC and each storage bucket. The audit's probe scripts are the starting point. Replace the text-only tests with these. Run in CI.

### FS-44 — Performance at five years of data

- **Importance:** Medium · **Effort:** M
- **Why:** Nobody has loaded realistic volume. The audit found 22 pages that fetch 250 to 2,000 rows in one query.
- **Problem it solves:** A system that is fast in a demo and slow in year two.
- **What we do:** A seeding script that generates five years of plausible activity (tens of thousands of orders, hundreds of thousands of stock movements and audit rows). Measure the twenty most-used screens and every report; set a budget (for example, under one second for lists, under three for reports). Fix with indexes, keyset pagination, and summary tables refreshed on a schedule for dashboards. Partition the largest append-only tables by month. Review the hosted performance advisor monthly. Watch connection usage under concurrent users.

### FS-45 — Backups, a restore drill and disaster recovery

- **Importance:** Critical · **Effort:** S
- **Why:** The memory notes say the hosted project auto-pauses, which suggests a free or low tier. A factory's operational record needs point-in-time recovery, and a backup nobody has restored is a hope, not a backup.
- **Problem it solves:** Losing a day's (or all) data to a mistake, a bad migration or an account problem.
- **What we do:** Move to a paid Supabase plan with daily backups and point-in-time recovery, and no auto-pause. Add a weekly logical dump to storage Omalco controls, outside Supabase. Once a quarter, restore the latest backup into staging and check that the app runs and the totals match. Write a one-page runbook: who does what if the site is down, how to reach the developer, and how the factory keeps working on paper for a day and catches up.

### FS-46 — Tame the migration chain

- **Importance:** Medium · **Effort:** M
- **Why:** 296 migrations, some thousands of lines long, applied to hosted in parts with different names. It replays in 13 seconds, which is good, but it is hard to read and reason about.
- **Problem it solves:** Slow onboarding for any new developer; risk in every large migration.
- **What we do:** After go-live stabilises, create a single squashed baseline that equals the current schema, proven by diffing a replay of the full chain against the baseline. Keep the old chain archived. From then on: small migrations, one concern each, applied by the CLI, each with a rollback note. Split giant command functions into smaller private helpers per command. Document the top-level schema by domain in `docs/DATABASE_AND_RLS.md`, generated where possible.

---

## 8. Part G — Integrations with the physical and outside world

### FS-47 — Machine and instrument integration

- **Importance:** High · **Effort:** L (varies by equipment)
- **Why:** The most trustworthy number is one no human typed.
- **Problem it solves:** Typing errors and "adjusted" figures for weight, chemistry and press output.
- **What we do:** In order of value and ease:
  1. **Weighbridge and platform scales** — most indicators output weight over serial or network; a small on-site bridge program posts readings to ExtrusionOS. Tare, gross and net captured with a timestamp and cannot be edited, only re-weighed.
  2. **Spectrometer** — import the result file per sample directly into the chemistry record (FS-14).
  3. **Press PLC** — if the presses have a PLC with network access, read billet count, cycle time, pressure and ram speed. This depends entirely on the make and age of each press; survey first.
  4. **Ageing oven controllers and energy meters** — temperature profile and kWh.

  Build one small, well-secured "edge agent" pattern for all of them. Each feed has a manual fallback that is visibly marked as manual.

### FS-48 — WhatsApp Business API, not just share links

- **Importance:** High · **Effort:** M
- **Why:** WhatsApp is how Indian business actually communicates. The code references WhatsApp widely, but there is no API credential in the environment template, which suggests messages are composed for a person to send. Verify.
- **Problem it solves:** Manual WhatsApp dependency — a person copying and sending every update.
- **What we do:** Connect through an official WhatsApp Business provider with approved templates: order confirmation, dispatch notice with documents, payment reminder, payment receipt, quote sent, die ready, owner's daily brief. Customers opt in. Replies land in the customer's record. Internally: approval requests the approver can act on with a button. Every automatic message is logged, and each message type can be switched off.

### FS-49 — Bank feed and payment links

- **Importance:** Medium · **Effort:** M
- **Why:** The bank-statement import now works correctly (two audit defects fixed). The next step is removing the upload.
- **Problem it solves:** Time spent matching receipts; customers asking "where do I pay?".
- **What we do:** Virtual account numbers or UPI collect references per customer so incoming payments identify themselves. A UPI QR and payment link on each invoice PDF and WhatsApp reminder. Bank statement fetched automatically where the bank offers an API, otherwise the existing import. Auto-match with a confidence score; anything uncertain goes to the accounts review queue as now.

### FS-50 — AI that does real work, safely

- **Importance:** Medium · **Effort:** L
- **Why:** In 2026–27, buyers expect AI in business software. Today there is one quotation assistant on an NVIDIA-hosted model. The opportunity is narrow, high-value assistants, not a chatbot bolted on the side.
- **Problem it solves:** Typing documents into the system; searching for answers across modules; spotting anomalies a person would miss.
- **What we do**, in order of value:
  1. **Document intake:** photograph or forward a customer's purchase order or a supplier's bill; the model extracts lines into a draft that a person reviews and confirms. Never auto-posted.
  2. **Ask the factory:** a natural-language question box for the owner ("which orders are late and why?", "recovery on die 214 this quarter?") that runs read-only, permission-checked queries and shows the data behind every answer.
  3. **Anomaly flags:** recovery far from that profile's norm, a cast balance near tolerance, a customer's payment pattern slipping, a die wearing faster than its peers.
  4. **Drafting:** follow-up messages, NCR summaries, shift handover notes, from the facts already recorded.
  5. **Drawing assist:** read a customer's profile drawing to suggest weight per metre and circumscribing circle diameter for a quote, for a person to confirm.

  Rules for all of them: the model never writes to the database directly; every output is a proposal a human accepts; cost and margin data are never sent unless the user's role may see them; prompts and outputs are logged; a provider abstraction (already begun in `lib/ai/providers`) lets the model be swapped. It is worth evaluating a current frontier model such as Claude for the document-reading and question-answering tasks, where accuracy matters most.

### FS-51 — Security hardening for a real user base

- **Importance:** High · **Effort:** M
- **Why:** The system is about to go from one user to many, including external dealers and customers.
- **Problem it solves:** Account takeover, over-broad access, and unlimited uploads.
- **What we do:** Two-factor authentication required for owner, admin and accounts (none exists in the code today). Leaked-password protection switched on. Session timeout and device list. Storage bucket size and file-type limits, plus the role policies from FS-01. Rate limiting on login, invitations and PDF generation. Origin checks on every mutating API route. Content-Security-Policy reviewed. Dependency updates automated weekly with CI. A login-history and sensitive-action view for the owner. An annual external penetration test once dealers and customers are live. A short written incident-response plan.

### FS-52 — Training, SOPs and in-app help

- **Importance:** High · **Effort:** M
- **Why:** ERP projects fail on adoption far more often than on software. The NOV work already built guided SOPs and competencies; use them.
- **Problem it solves:** People reverting to registers and WhatsApp within a month.
- **What we do:** A two-minute screen-recorded video per role in Hindi, linked from that role's home page. A one-page laminated quick guide at each station. A "practice mode" on staging where operators can try without consequence. A named champion per department. A feedback button on every screen that files a task with the page and a screenshot. A weekly 15-minute review with supervisors for the first two months. Track adoption honestly: entries made within an hour of the event, by station.

---

## 9. A realistic sequence for 2026–27

| Phase | When | Goal | Recommendations |
|---|---|---|---|
| **0. Make it safe** | Now → 6 weeks | Audit verdict changes to "controlled pilot" | FS-01, 02, 03, 04, 06, 07, 45, 51 (2FA and bucket limits) |
| **1. Make it true** | Next 2–3 months | Numbers reconcile; factory runs in parallel | FS-05, 08 (packaging and billets first), 09, 14, 41, 42, 43 |
| **2. Make it effortless** | Following 2–3 months | Floor uses it in real time, in Hindi, on tablets | FS-33, 34, 35, 15, 19, 37, 40, 52 |
| **3. Make it connected** | Following quarter | No double entry with government, books or scales | FS-24, 25, 47 (weighbridge, spectrometer), 48, 21 |
| **4. Make it intelligent** | Following quarter | It plans and predicts | FS-26, 27, 12, 16, 10, 11, 38, 36 |
| **5. Make it complete** | After that | Depth and polish | FS-17, 18, 20, 22, 23, 28, 29, 30, 31, 32, 39, 44, 46, 49, 50, 13 |

Two rules for the sequence:

- **Do not start a later phase to avoid finishing an earlier one.** Phase 0 and 1 are not exciting, and they are the whole difference between a demo and a system of record.
- **Each phase ends with a signed-in walk-through on staging and a short written acceptance** by the person at Omalco who owns that area.

## 10. What will make people say "this is too good"

If only seven things could be chosen for the impression they make on the owner, on customers and on anyone evaluating the system:

1. **The owner's morning WhatsApp brief** with numbers that are always right (FS-38).
2. **Scan a bundle, see its whole history** back to the heat and the scrap lot (FS-10).
3. **A press terminal** an operator uses without training, in Hindi, that works when the Wi-Fi drops (FS-33, 34, 35).
4. **A promise date** the system calculates and then keeps (FS-26).
5. **Truck leaves with invoice, e-way bill, packing list and test certificate generated in one click**, and the customer gets them on WhatsApp before the truck is out of the gate (FS-19, 24, 48).
6. **A monthly metal reconciliation** that explains every kilogram (FS-09).
7. **"This order made ₹X; this die is losing money"** — actual profit, not estimates (FS-12).

All seven depend on Parts A and B being done first.

## 11. Decisions and inputs needed from Omalco

| # | Needed | Blocks |
|---|---|---|
| 1 | Casting and dispatch weighing tolerances | FS-01, 09 |
| 2 | Approved chemistry limits per alloy | FS-01, 14 |
| 3 | Recall policy: what is held when a lot or heat is rejected | FS-01, 11 |
| 4 | Invoice basis: rate × actual kg, or quoted amount | FS-20 |
| 5 | Which metal price reference Omalco buys and sells against | FS-20, 28 |
| 6 | Confirmation from the CA of e-invoice, e-way bill, job-work and MSME obligations that apply | FS-24, 18, 21, 28 |
| 7 | Make, model and connectivity of each press, weighbridge, scale and the spectrometer | FS-47 |
| 8 | Profile drawings with tolerances, and system section drawings for the configurator | FS-17, 22 |
| 9 | Language preference per department | FS-35 |
| 10 | Budget approval for paid hosting, a staging project, WhatsApp and GST API providers | FS-02, 45, 24, 48 |
| 11 | A named owner for each area to accept each phase | All |

## 12. Caveats on this document

- Recommendations marked "verify first" are in areas where a module exists and I did not read it in depth; the gap may be smaller than described.
- Statutory points (e-invoicing, e-way bill, job-work return periods, MSME payment rules, tax collected at source on scrap, EU carbon reporting) are stated in general terms. Thresholds and dates change; Omalco's chartered accountant should confirm what applies before anything is built.
- Effort estimates are rough and assume the current stack and one developer working with AI assistance.
- Several items overlap with the `AUTOPILOT_UPGRADES.md` and `NOV_UPGRADES.md` catalogues. Where they do, extend what exists rather than building in parallel.

---

# Second set of recommendations (FS-53 to FS-88)

Added 11 November 2026. These go beyond the first 52. They follow the same format and the same rule: nothing here outranks Phase 0 and Phase 1 above. Before writing them I searched the code for each idea; where something related already exists, the item says **verify first** and the work is to deepen it, not rebuild it.

### Summary table

| # | Recommendation | Area | Importance | Effort |
|---|---|---|---|---|
| FS-53 | Process recipe card per profile and press | Process | High | M |
| FS-54 | New-profile and new-die development pipeline | Process | High | M |
| FS-55 | Press tooling beyond dies: containers, stems, dummy blocks | Process | Medium | S |
| FS-56 | Die oven and preheat control | Process | Medium | S |
| FS-57 | Rework, re-ageing and re-finishing as first-class flows | Process | Medium | M |
| FS-58 | Customer-owned metal and conversion (tolling) account | Process (verify first) | High | M |
| FS-59 | Help call from the floor with response-time tracking | Process | Medium | S |
| FS-60 | Safety, incidents and permits to work | New module | High | M |
| FS-61 | Gate management for vehicles and material | New module (verify first) | Medium | M |
| FS-62 | Warehouse map, length-wise stock and ageing stock | Stock (verify first) | High | M |
| FS-63 | Cycle counting programme | Stock (verify first) | High | S |
| FS-64 | Offcuts, short lengths and non-standard stock | Stock | Medium | M |
| FS-65 | One unit-of-measure and weight-basis policy | Stock | High | M |
| FS-66 | Standard-section price list and counter sales | Commercial | Medium | M |
| FS-67 | Order 360, Customer 360, Die 360, Profile 360 | Commercial / UX | High | M |
| FS-68 | On-time-in-full measurement and delivery promise tracking | Commercial | High | S |
| FS-69 | Customer portal: approvals, live tracking, reorder | Commercial (verify first) | Medium | M |
| FS-70 | Customer acceptance with OTP and digital signature | Commercial (verify first) | Medium | S |
| FS-71 | Sales forecast and order-book analytics | Commercial | Medium | M |
| FS-72 | Metal price exposure and back-to-back booking | Finance | High | M |
| FS-73 | Thirteen-week cash-flow forecast | Finance | High | M |
| FS-74 | Budgets and an automatic monthly MIS pack | Finance | Medium | M |
| FS-75 | Delegation-of-authority matrix | Finance / control | High | M |
| FS-76 | Period close checklist | Finance | Medium | S |
| FS-77 | KPI dictionary: one definition per number | Data | High | S |
| FS-78 | Scheduled reports and Excel everywhere | Data (verify first) | Medium | M |
| FS-79 | History tab on every record | Data | High | M |
| FS-80 | Drawing and document revision control | Data (verify first) | High | M |
| FS-81 | Master data governance | Data (verify first) | Medium | M |
| FS-82 | One business-date service (India time, fiscal year) | Platform | High | S |
| FS-83 | Second location readiness | Platform | Medium | L |
| FS-84 | Privacy and data-retention policy | Platform | Medium | S |
| FS-85 | Outbound API and webhooks for large customers | Platform | Polish | M |
| FS-86 | Notification preferences, digests and escalation ladders | UX (verify first) | Medium | M |
| FS-87 | Voice and photo-first capture on the floor | UX | Polish | M |
| FS-88 | Go-live readiness score and setup wizard | Adoption | High | S |

---

## 13. Process depth: what an extrusion person will look for

### FS-53 — Process recipe card per profile and press

- **Importance:** High · **Effort:** M
- **Why:** The best run of a profile is tribal knowledge held by one or two senior operators. When they are on leave, speed and recovery drop.
- **Problem it solves:** Each shift rediscovering settings; scrap during start-up; no record of what "good" looked like.
- **What we do:** For each profile-and-press pair, a recipe card: billet temperature, container temperature, die temperature, billet length, ram speed, exit temperature target, quench type, puller force, stretch percentage, cut length plan, ageing recipe. The card shows the standard, the last run, and the best run by recovery and speed. At job start the operator sees the card; at job end actuals are saved against it. After several runs, propose an updated standard for the production manager to approve. A few recipe fields may already exist in the code — verify and consolidate rather than duplicate. Values come from Omalco's own runs; the system must not ship with invented settings.

### FS-54 — New-profile and new-die development pipeline

- **Importance:** High · **Effort:** M
- **Why:** New sections are how an extruder wins customers. The path from a customer drawing to first approved production involves sales, the die maker, production and quality, and usually lives in email.
- **Problem it solves:** New-development enquiries that stall with nobody owning them; dies ordered before feasibility is agreed; no record of why a trial failed.
- **What we do:** A stage board: enquiry with drawing → feasibility (circumscribing circle, weight per metre, wall thickness, tongue ratio, suitable press) → die quotation and customer approval of die cost → die ordered with expected date → die received and inspected → trial 1..n with photos, measurements and corrections → sample submitted → customer approval → released for production. Each stage has an owner and an age. Die cost, who pays, and amortisation terms are recorded once and flow to quoting and invoicing. Some trial and sample-approval pieces exist already — verify and join them into one pipeline.

### FS-55 — Press tooling beyond dies

- **Importance:** Medium · **Effort:** S
- **Why:** Containers, liners, stems, dummy blocks, bolsters, backers and die rings wear out too, cost real money, and cause quality problems when overdue.
- **Problem it solves:** A worn container liner showing up as surface defects that get blamed on dies.
- **What we do:** Register these as tooling items per press with install date, billets pushed since install, inspection interval and replacement history. Count usage automatically from the press log. Raise a task when an inspection or replacement is due. Verify what exists; a search found a few references.

### FS-56 — Die oven and preheat control

- **Importance:** Medium · **Effort:** S
- **Why:** A die left too long in the oven loses hardness and life; a die loaded too late delays the press.
- **Problem it solves:** Dies soaked for a whole shift; die changes waiting on a cold die.
- **What we do:** From the schedule (FS-26), generate a die-oven loading list with load-by times. Scan the die into and out of the oven; show time-in-oven with a warning past the limit Omalco sets. Record oven dwell against the die's life history (FS-16).

### FS-57 — Rework, re-ageing and re-finishing as first-class flows

- **Importance:** Medium · **Effort:** M
- **Why:** Rework is common: soft material re-aged, coating stripped and redone, bent lengths re-stretched or re-cut. If it is handled as an informal note, cost and traceability are lost.
- **Problem it solves:** Reworked material that looks like fresh production in the records; rework cost hidden; hardness failures with no closure.
- **What we do:** A rework order linked to the original job and the non-conformance that caused it, with its own quantities in and out, loss, cost and a mandatory re-inspection before release. Lineage (FS-10) shows the loop. A monthly rework report by cause. The word appears widely in the code — verify how much is already modelled.

### FS-58 — Customer-owned metal and conversion (tolling) account *(verify first)*

- **Importance:** High · **Effort:** M
- **Why:** Some customers supply their own billet or scrap and pay only a conversion charge. That metal is not Omalco's stock and must never be mixed into it on paper.
- **Problem it solves:** Disputes over "how much of my metal do you still hold"; customer metal consumed for another order; conversion invoices raised on the wrong basis.
- **What we do:** A metal account per customer: received, consumed into their orders, returned as profile, returned as scrap, agreed process loss, balance held. Ownership carried on every stock movement (FS-08) so customer-owned lots cannot be allocated to someone else's order without an explicit, approved borrow. A statement PDF the customer can be sent monthly. Conversion-only invoicing with job-work documentation. NOV work on customer-owned metal exists — check how far it goes.

### FS-59 — Help call from the floor with response-time tracking

- **Importance:** Medium · **Effort:** S
- **Why:** Much downtime is waiting: for maintenance, for the die shop, for a QC decision, for a forklift.
- **Problem it solves:** Operators walking to find someone; no data on how long help takes.
- **What we do:** Four buttons on the press terminal: call maintenance, call die shop, call quality, call material. The right person's phone gets a notification; the wall screen shows the press in amber. Acknowledge and resolve are timestamped. Report response time and resolution time by department.

## 14. New modules, second set

### FS-60 — Safety, incidents and permits to work

- **Importance:** High · **Effort:** M
- **Why:** A foundry and press shop has molten metal, hot dies, hydraulic pressure and cranes. Nothing in the code covers safety. One serious incident costs more than any feature saves.
- **Problem it solves:** Near-misses that are never recorded, so the same accident happens later; no evidence for an inspector or insurer.
- **What we do:** Incident and near-miss reporting from any phone in under a minute, with photo. Investigation, root cause and corrective action using the existing task engine. Permit to work for hot work, confined space, working at height and electrical isolation, with sign-on and sign-off. Daily safety checklist for the furnace (charge dryness, tools preheated) and each press. PPE issue register. Days-since-last-incident on the wall screen. Keep it simple and fast; a safety system nobody fills in is worse than none.

### FS-61 — Gate management for vehicles and material *(verify first)*

- **Importance:** Medium · **Effort:** M
- **Why:** Everything physical enters and leaves through the gate. It is the natural control point and often the weakest record.
- **Problem it solves:** Material leaving without a document; vehicles waiting with no one aware; no inward register matching purchases.
- **What we do:** A security-guard screen on a tablet: vehicle in (number, driver, purpose, linked purchase order or dispatch), weighbridge link, vehicle out. Nothing leaves without a scanned invoice, challan or approved gate pass. Returnable gate pass for dies, tools and samples with due-back dates and reminders. Visitor log. Turnaround time per vehicle. Some gate-pass handling exists for dies — extend rather than start again.

## 15. Stock, second set

### FS-62 — Warehouse map, length-wise stock and ageing stock *(verify first)*

- **Importance:** High · **Effort:** M
- **Why:** Finding material is a daily time-waster, and old stock is cash asleep.
- **Problem it solves:** "We have it somewhere"; producing again what is already in a rack; stock nobody will ever buy sitting for years.
- **What we do:** Rack and bin locations exist in the code — verify coverage, then add: a visual map of racks with what is in each; putaway and pick by scanning the rack label; stock shown by profile, finish, temper and length; an ageing report (0–30, 31–90, 91–180, over 180 days) in kg and rupees; a slow-moving list pushed to sales with a suggested clearance price; a "check stock before producing" prompt when an order matches existing free stock.

### FS-63 — Cycle counting programme *(verify first)*

- **Importance:** High · **Effort:** S
- **Why:** An annual stock-take finds a year of errors at once. Counting a little every day finds them while the cause can still be traced.
- **Problem it solves:** Stock drift; large write-offs at year end.
- **What we do:** A discrepancies and recount flow exists. Build a schedule on top: every day the system picks a few racks or items (high-value items more often), a storekeeper counts blind on a phone, differences beyond tolerance go to a supervisor for a recount and a reasoned adjustment with second-person approval. Track count accuracy as a monthly percentage.

### FS-64 — Offcuts, short lengths and non-standard stock

- **Importance:** Medium · **Effort:** M
- **Why:** Cutting to customer length leaves usable short lengths. Most plants scrap them or lose track of them.
- **Problem it solves:** Sellable material going to the scrap bin; yield understated.
- **What we do:** At the saw, an offcut above a minimum length is recorded as short-length stock against the same lineage, not scrapped. Short lengths get their own price list and are offered to dealers and fabricators, and to the configurator's cut optimiser (FS-22). Below the minimum, it is scrap by weight.

### FS-65 — One unit-of-measure and weight-basis policy

- **Importance:** High · **Effort:** M
- **Why:** Aluminium sections are counted in pieces, measured in metres and sold in kilograms. Theoretical weight (length × kg per metre) and actual weighed weight always differ slightly. If modules disagree on which to use, nothing reconciles.
- **Problem it solves:** Invoices on one basis and stock on another; disputes over a few kilograms on every truck; the audit's finding that rate × kg does not reproduce the quoted amount.
- **What we do:** Decide and document, once: stock is held in kg actual with pieces and length as attributes; orders are placed in pieces and length; invoicing is on actual weighed kg or on theoretical weight (Omalco's choice, per customer if needed); the allowed difference between theoretical and actual per profile. Put all conversions in one library in `/lib` and one SQL function, used everywhere, with the rounding rules stated. Show both weights wherever one is shown.

## 16. Commercial, second set

### FS-66 — Standard-section price list and counter sales

- **Importance:** Medium · **Effort:** M
- **Why:** Standard sections sold from stock do not need a costed quotation each time. Nothing in the code handles a price list or quick sale.
- **Problem it solves:** Slow response to small stock orders; inconsistent prices between salespeople.
- **What we do:** A price list per customer class (dealer slab, fabricator, retail) for stocked sections and finishes, tied to the metal price master (FS-20) so it moves with the market. A quick-sale screen: pick from free stock, price fills in, invoice and gate pass in one flow. Discount limits per role.

### FS-67 — Order 360, Customer 360, Die 360, Profile 360

- **Importance:** High · **Effort:** M
- **Why:** The commonest question in any office is "what is the status of X?" Today the answer is spread across modules.
- **Problem it solves:** Clicking through five screens to answer a customer on the phone.
- **What we do:** One page per key record that assembles everything, read-only, from the existing data. **Order 360:** a timeline from quote to payment with every job, inspection, dispatch, invoice and receipt, plus what is blocking it now. **Customer 360:** open orders, outstanding and overdue, last contact, complaints, margin, price history. **Die 360:** life, corrections, runs, recovery trend, where it is. **Profile 360:** drawing, dies, recipe, stock, customers, price and margin history. Each fact links to its source screen. This is assembly work, not new data.

### FS-68 — On-time-in-full measurement and promise tracking

- **Importance:** High · **Effort:** S
- **Why:** Delayed dispatch is a named business problem, but it cannot be managed without a number.
- **Problem it solves:** Arguments about whether delivery is getting better or worse; promise dates silently moved.
- **What we do:** Record the first promised date on every order line and never overwrite it; later changes are logged with reason and who agreed. Measure OTIF = lines delivered complete on or before the first promise ÷ lines due. Report by customer, salesperson, profile and cause of delay (die, material, press breakdown, finishing vendor, credit hold, transport). Show it on the owner cockpit.

### FS-69 — Customer portal: approvals, live tracking, reorder *(verify first)*

- **Importance:** Medium · **Effort:** M
- **Why:** A portal exists with orders, quotes, self-service and support. Making it genuinely useful reduces phone calls and looks impressive to customers.
- **Problem it solves:** Customers calling for status and documents; approvals of drawings and shades by WhatsApp photo.
- **What we do:** Check what the portal already does, then add what is missing from: stage-by-stage order tracking with expected dates; one-click download of invoice, packing list, test certificate and statement; approve a profile drawing or shade sample with a recorded decision; reorder a previous order; raise a complaint with photos that becomes an NCR; see outstanding and pay by link (FS-49). Every portal field must be checked against the "never expose cost, margin or other customers" rule with a real test.

### FS-70 — Customer acceptance with OTP and digital signature *(verify first)*

- **Importance:** Medium · **Effort:** S
- **Why:** A quotation accepted by a recorded action is far stronger than "he said yes on the phone" when price or quantity is disputed later.
- **Problem it solves:** Disputes over what was agreed; orders started without clear acceptance.
- **What we do:** A link on the quotation that the customer opens, reviews and accepts with a one-time code to their registered phone or email; the accepted version is frozen with time and identity. For invoices and certificates, add a digital signature certificate where Omalco's CA advises. Acceptance gating exists in some form — verify and extend.

### FS-71 — Sales forecast and order-book analytics

- **Importance:** Medium · **Effort:** M
- **Why:** Buying metal and planning presses needs a view beyond confirmed orders.
- **Problem it solves:** Surprised by a busy or a dead month; metal bought late at a worse price.
- **What we do:** A weighted pipeline from the CRM (open quotes × win probability by stage), plus a simple seasonal projection per customer from past orders. Show order book in tonnes and weeks of load by press, by alloy and by finish. Customer concentration (share of the top five) and customers whose ordering has dropped. Keep the method simple and visible; no black-box forecasting.

## 17. Finance and control, second set

### FS-72 — Metal price exposure and back-to-back booking

- **Importance:** High · **Effort:** M
- **Why:** A fixed-price order taken today and metal bought next week is a bet on the aluminium price. Nothing in the code tracks this. For a metal business this can matter more than conversion margin.
- **Problem it solves:** Margin lost to price movement between order and purchase, discovered only at month end.
- **What we do:** A daily exposure report: tonnes sold at a fixed metal price and not yet covered, against metal in stock and on order at a known price. Show the net open position in tonnes and what a ₹5 per kg move would cost. Record back-to-back bookings (a purchase fixed against a specific sales order). Alert when the open position passes a limit the owner sets. This is visibility only; it does not trade or give hedging advice.

### FS-73 — Thirteen-week cash-flow forecast

- **Importance:** High · **Effort:** M
- **Why:** Profitable metal businesses still run short of cash because metal is paid for quickly and customers pay slowly.
- **Problem it solves:** Discovering a cash gap the week it happens.
- **What we do:** A rolling weekly view: opening bank balance + expected receipts (from invoice due dates adjusted by each customer's real payment behaviour and promises from FS-21) − committed payments (supplier bills, metal purchases, salaries and power as entered amounts, loan instalments, tax dates). Highlight weeks below a minimum balance. Compare last week's forecast with what happened so the forecast earns trust.

### FS-74 — Budgets and an automatic monthly MIS pack

- **Importance:** Medium · **Effort:** M
- **Why:** The owner, the bank and any future investor ask for the same monthly numbers. Assembling them by hand takes days.
- **Problem it solves:** MIS produced late and inconsistently; no comparison with a plan.
- **What we do:** Enter annual targets by month for tonnes, recovery, conversion cost per tonne, sales value, collections. On the first working day, generate a PDF pack: production, yield and scrap, OEE, sales and order book, OTIF, quality, receivables ageing, stock, metal reconciliation, top exceptions, each against budget and last year. Every figure uses the KPI dictionary (FS-77).

### FS-75 — Delegation-of-authority matrix

- **Importance:** High · **Effort:** M
- **Why:** Approval rules are currently spread across individual functions. Owners want to change "who can approve a discount above 5 %" without a developer.
- **Problem it solves:** Hard-coded limits; inconsistent approval rules between modules; nobody sure who may approve what.
- **What we do:** One table and one screen: transaction type (discount, low-margin quote, credit-limit override, stock adjustment, write-off, purchase order, payment, concession, price override) × amount band × approving role, with a second approver above a threshold and a rule that nobody approves their own entry. Every approval function reads from it. Temporary delegation during leave with start and end dates. A report of all overrides in the month for the owner.

### FS-76 — Period close checklist

- **Importance:** Medium · **Effort:** S
- **Why:** An accounting-period lock exists. Closing a month well means a sequence of checks, not just a lock.
- **Problem it solves:** Months locked with unposted dispatches, unreconciled bank lines or open stock differences.
- **What we do:** A month-end checklist the accounts head ticks through, each item backed by a live count: dispatches not invoiced, invoices without e-invoice, unmatched bank lines, open cycle-count differences, jobs open past their end date, goods received not billed, Tally export done and reconciled. The lock is offered only when the list is clean or each exception is acknowledged with a reason.

## 18. Data, second set

### FS-77 — KPI dictionary: one definition per number

- **Importance:** High · **Effort:** S
- **Why:** "Recovery" can mean good kg over billet kg, or over charged kg, with or without butt ends. If two screens compute it differently, both lose credibility.
- **Problem it solves:** The same KPI showing different values on the dashboard, the report and the WhatsApp brief.
- **What we do:** A short document and a matching set of SQL views defining each KPI exactly: recovery, yield, scrap %, OEE and its three parts, OTIF, DSO, quote win rate, die life, conversion cost per tonne, kWh per tonne. Every screen and report reads from those views only. A small "i" beside each number shows the definition.

### FS-78 — Scheduled reports and Excel everywhere *(verify first)*

- **Importance:** Medium · **Effort:** M
- **Why:** Office users live in Excel. A report builder exists; nothing schedules reports.
- **Problem it solves:** People logging in only to export the same report every Monday.
- **What we do:** Save any report or filtered list as a view; schedule it by email or WhatsApp daily, weekly or monthly; export any table to Excel with proper number and date formats. Respect permissions at send time, not at save time, so a role change takes effect.

### FS-79 — History tab on every record

- **Importance:** High · **Effort:** M
- **Why:** Audit logs exist, but a user cannot see "who changed this, and from what" on the record in front of them.
- **Problem it solves:** "Who changed the rate?" becoming an investigation.
- **What we do:** A standard History tab on every detail page: each change with user, time, field, old value and new value, plus status transitions and approvals, in plain language. Read from the existing audit tables through one shared component. Sensitive fields (cost, margin) shown only to roles allowed to see them.

### FS-80 — Drawing and document revision control *(verify first)*

- **Importance:** High · **Effort:** M
- **Why:** Producing to a superseded drawing is one of the costliest mistakes in manufacturing.
- **Problem it solves:** Old drawings in circulation; no record of which revision a job was made to.
- **What we do:** Each profile drawing and specification has numbered revisions with status (draft, approved, superseded), approver and effective date. Only the current approved revision can be used on a new job; the job stores the revision it used. Superseded PDFs are watermarked. A change to a drawing lists open orders and dies affected. Builds on the documents module and the procedure-version work.

### FS-81 — Master data governance *(verify first)*

- **Importance:** Medium · **Effort:** M
- **Why:** Duplicate customers, profiles with missing weight, and dies mapped to the wrong profile quietly corrupt every report.
- **Problem it solves:** Two ledgers for the same customer; quotes on a wrong section weight.
- **What we do:** Duplicate detection on create (GSTIN, phone, similar name; profile code and weight). Mandatory-field completeness score per master with a worklist of incomplete records. Changes to critical fields (section weight, GSTIN, credit limit, alloy limits) need approval and are logged. Deactivate rather than delete. Master-cleanup and import tools exist — connect them into one governance screen.

## 19. Platform, second set

### FS-82 — One business-date service

- **Importance:** High · **Effort:** S
- **Why:** The audit found a writer still using the database server's date (UTC) instead of the India business date. Between midnight and 5:30 a.m. IST those differ, which is exactly when the night shift is working.
- **Problem it solves:** Night-shift entries dated the previous day; document numbers in the wrong financial year on 1 April.
- **What we do:** One SQL function and one TypeScript helper for "today in India", "current shift" and "current financial year". Replace every `current_date` and `now()::date` in business logic with it, and add a test that fails if a new raw use appears. Define the shift day (for example, the night shift belongs to the date it started on) once.

### FS-83 — Second location readiness

- **Importance:** Medium · **Effort:** L
- **Why:** This is not multi-company. It is Omalco opening a second godown, a depot in another city, or a second unit. Most growing extruders do.
- **Problem it solves:** A rebuild later when a second site appears; stock in a depot invisible to the plant.
- **What we do:** Make location a proper dimension on stock, documents and users: plant, warehouse, depot, vendor site, dealer site. Stock transfers between locations with in-transit state and the right GST document (delivery challan within a state, tax invoice across states — confirm with the CA). Reports filterable by location. Only do this when a second location is actually planned; do not pay the complexity cost early.

### FS-84 — Privacy and data-retention policy

- **Importance:** Medium · **Effort:** S
- **Why:** The system holds personal data of staff, customer contacts and drivers. India's data-protection law places duties on whoever holds such data; Omalco's advisers should confirm what applies and when.
- **Problem it solves:** Keeping personal data forever with no stated purpose; no answer if someone asks what is held about them.
- **What we do:** List which tables hold personal data and why. Set retention periods (business records as tax law requires; visitor and driver details much shorter). A scheduled job that anonymises expired personal fields while keeping the transaction. An export of one person's data on request. A short privacy notice on the portal and invitation emails.

### FS-85 — Outbound API and webhooks for large customers

- **Importance:** Polish · **Effort:** M
- **Why:** A large OEM or project customer may want order status in their own system. Offering it marks Omalco as a serious supplier.
- **Problem it solves:** Sending the same status spreadsheet to a big customer every week.
- **What we do:** Read-only API keys scoped to one customer's own orders, dispatches and documents, with rate limits and an access log. Optional webhooks on dispatch and invoice. Build only when a customer asks.

## 20. UX and adoption, second set

### FS-86 — Notification preferences, digests and escalation ladders *(verify first)*

- **Importance:** Medium · **Effort:** M
- **Why:** A system that notifies about everything is muted within a week.
- **Problem it solves:** Alert fatigue; urgent items lost among routine ones.
- **What we do:** Three levels: act now (push and WhatsApp), today (in-app), FYI (daily digest). Each user chooses channels within what their role requires. Quiet hours outside the shift. Escalation: an unacknowledged "act now" goes to the supervisor after a set time, then the manager. A monthly review of which notifications are never opened, and removal of those.

### FS-87 — Voice and photo-first capture on the floor

- **Importance:** Polish · **Effort:** M
- **Why:** Typing a stoppage reason or a defect description with gloves on is slow. Speaking or photographing is natural.
- **Problem it solves:** Empty or one-word remarks; defects described badly.
- **What we do:** A microphone button on remarks fields that records a short voice note in Hindi or English and attaches it; transcription can be added later (FS-50). A camera button on every defect, breakdown and discrepancy entry. Photos compressed on the device and stored under the storage limits from FS-51.

### FS-88 — Go-live readiness score and setup wizard

- **Importance:** High · **Effort:** S
- **Why:** "Are we ready to go live?" should be a screen, not an opinion.
- **Problem it solves:** Going live with masters half-filled and no one trained.
- **What we do:** One page with a checklist that computes itself: users invited per role, masters complete (profiles with weight and drawing, dies mapped, alloys with limits, customers with GSTIN and credit terms, presses with capacities), opening balances loaded and approved, integrations tested (e-invoice sandbox, Tally export, weighbridge), each role's walk-through signed off, backups verified. A percentage and a list of what is left, per department.

---

## 21. Where the second set fits in the sequence

| Phase (from section 9) | Add from this set |
|---|---|
| 0. Make it safe | FS-82 (business date), FS-88 (readiness score) |
| 1. Make it true | FS-65 (weight basis), FS-63 (cycle counts), FS-77 (KPI dictionary), FS-58 (customer-owned metal), FS-75 (authority matrix) |
| 2. Make it effortless | FS-53 (recipe card), FS-59 (help call), FS-62 (warehouse map), FS-67 (360 pages), FS-79 (history tab), FS-60 (safety) |
| 3. Make it connected | FS-61 (gate), FS-70 (acceptance), FS-76 (period close), FS-78 (scheduled reports) |
| 4. Make it intelligent | FS-68 (OTIF), FS-72 (metal exposure), FS-73 (cash flow), FS-71 (forecast), FS-54 (development pipeline) |
| 5. Make it complete | FS-55, 56, 57, 64, 66, 69, 74, 80, 81, 83, 84, 85, 86, 87 |

## 22. If I had to pick ten from the whole document

Counting both sets, the ten that change most for Omalco, after the audit fixes:

1. Staging environment and signed-in acceptance (FS-02).
2. One stock ledger (FS-08).
3. Metal mass balance and monthly reconciliation (FS-09).
4. Shop-floor mode in Hindi, working offline (FS-33, 34, 35).
5. E-invoice, e-way bill and Tally bridge (FS-24, 25).
6. Scheduler with a promise date, measured by OTIF (FS-26, 68).
7. Actual job costing (FS-12).
8. Metal price exposure and cash-flow forecast (FS-72, 73).
9. Order 360 and the owner's daily brief (FS-67, 38).
10. Recipe card per profile and press (FS-53).

## 23. Additional inputs needed from Omalco for the second set

| # | Needed | Blocks |
|---|---|---|
| 12 | Invoicing weight basis: actual or theoretical, and the allowed difference | FS-65 |
| 13 | Whether any customers supply their own metal, and the agreed process loss | FS-58 |
| 14 | Approval limits by role and amount | FS-75 |
| 15 | Shift timings and which date a night shift belongs to | FS-82 |
| 16 | Maximum die-oven dwell time and current recipe settings for the main profiles | FS-53, 56 |
| 17 | Whether a second location is planned in the next two years | FS-83 |
| 18 | The metal position limit the owner is comfortable with | FS-72 |
| 19 | Monthly targets for the year | FS-74 |

## 24. Caveats on the second set

- "Verify first" items rest on keyword searches showing related code exists; I did not read those modules in depth, so the remaining gap may be smaller or larger than described.
- "Nothing in the code" claims (safety, price lists, budgets, cash-flow forecast, metal exposure, scheduled reports, voice input, KPI definitions, a record-history component) are from the same keyword searches and could miss something named differently.
- Tax, job-work and data-protection points are general and need confirmation from Omalco's advisers.
- FS-72 is a visibility report. It is not financial or hedging advice.

---

# Third set: deep-dive findings (FS-89 to FS-108)

Added 11 November 2026 after reading the code and the hosted database in more depth. The first two sets say what to build. This set is different: it is about **how the system is built**, and every item starts from something measured. These are the things a senior engineer or a technical buyer would notice in the first hour, and they decide whether the system stays fast, safe and changeable for the next five years.

### What was measured

| Measure | Value | Source |
|---|---|---|
| Client components that write to tables directly from the browser | 39 files import the browser database client; 87 direct insert/update/delete/upsert calls in app code | Code search |
| Largest component | `record-form-client.tsx`, 1,344 lines, 17 `as any` | Line count |
| `as any` casts | 102 | Code search |
| `select("*")` queries | 155 | Code search |
| Calls to `getSessionContext()` | 462 call sites; not memoised per request | `lib/auth.ts` |
| Suspense boundaries / lazy imports / cached reads | 0 / 0 / 0 | Code search |
| Forms using React Hook Form | 0 (the stack names it; about 58 hand-built forms; 1,763 `useState` calls) | Code search |
| `htmlFor` on labels | 16, against 862 labels and 1,112 inputs | Code search |
| Browser `confirm()` dialogs on real actions | about 8 (job completion, finishing reject, dispatch) | Code search |
| Dark-mode classes | 0 | Code search |
| Public tables | 516, of which 8 hold any rows on hosted | Hosted catalog |
| Indexes | 2,326 | Hosted catalog |
| Triggers | 495; `production_jobs` 28, `orders` 22, `invoices` 21, `quotes` 20, `dispatches` 18 | Hosted catalog |
| Functions over 10,000 characters | 74; the largest is 66,804 | Hosted catalog |
| JSON columns | 233 | Hosted catalog |
| Text status columns with no check constraint | 43 | Hosted catalog |
| Performance advisor | 433 unindexed foreign keys, 270 overlapping permissive policies, 16 slow-pattern RLS policies, 15 duplicate indexes, 819 unused indexes | Hosted advisor |
| Markdown files at repository root / in `docs/` | 38 / 59 | File listing |
| Full test suite | 14 minutes | Audit log |

One caution on the hosted numbers: the database was wiped on 9 November and has one user, so "unused index" and row counts say nothing about real usage yet.

### Corrections to the earlier sets

- **FS-77 (KPI dictionary):** `docs/KPI_DICTIONARY.md` already exists and defines about a dozen metrics tied to one SQL function. My earlier "nothing in the code" was wrong about the document. The recommendation stands in a narrower form: extend it to OEE, OTIF by first promise, DSO, die life and conversion cost, and make every screen read from it.
- **FS-39 (design system):** confirmed stronger than stated — there is no dark theme at all, and no lazy loading.

### Summary table

| # | Recommendation | Area | Importance | Effort |
|---|---|---|---|---|
| FS-89 | Move every browser-side write to the server | Architecture | Critical | L |
| FS-90 | Audit entries written only by the server | Architecture | Critical | S |
| FS-91 | Retire or rebuild the first-generation modules | Architecture | High | L |
| FS-92 | Break up the generic record form and adopt one form library | Architecture | High | L |
| FS-93 | Load the session once per request | Performance | High | S |
| FS-94 | Ask only for the columns a screen needs | Performance / security | High | M |
| FS-95 | Streaming, lazy loading and cached reads | Performance | High | M |
| FS-96 | Make the automation rule builder real or remove it | Honesty (verify first) | High | M |
| FS-97 | Re-home the eight task hubs under business modules | UX | High | M |
| FS-98 | Replace browser confirm boxes with a consequence review | UX | Medium | S |
| FS-99 | Programmatic labels and automated accessibility checks | UX | Medium | M |
| FS-100 | Tighten the content security policy | Security | Medium | M |
| FS-101 | Trigger map and consolidation on the five core tables | Database | High | L |
| FS-102 | Split the giant database functions | Database | Medium | L |
| FS-103 | Index and policy hygiene from the advisor | Database | High | M |
| FS-104 | Constrain status values and share one state machine | Database | High | M |
| FS-105 | Contracts for JSON payloads | Database | Medium | M |
| FS-106 | Schema diet: review 516 tables after ninety days | Database | Medium | M |
| FS-107 | One documentation home; archive the rest | Maintainability | Medium | S |
| FS-108 | Faster, layered test suite | Maintainability | Medium | M |

---

## 25. Architecture

### FS-89 — Move every browser-side write to the server

- **Importance:** Critical · **Effort:** L
- **What I found:** 39 client components use the browser database client, and there are 87 direct write calls in application code. The generic form writes straight to whatever table its configuration names (`record-form-client.tsx:1052-1053`) with a payload that includes `company_id` and `created_by` taken from the page's context (`:956`). Dies (`die-form-client.tsx:176`), maintenance schedules and breakdown logs, automation rules, energy readings, vendors, tenders, feature flags, roles and role permissions are all written this way.
- **Why:** `CLAUDE.md` rules 5.6 and 5.7 say company identity must come from the server and business logic belongs in `/lib`. Row-level security does stop a write to another company, so this is not an open door. But everything else — validation, required fields, state rules, who-did-it — exists only in the browser, where a user with the developer tools open can skip it.
- **Problem it solves:** A die created with an impossible status; a role's permissions edited by posting directly; `created_by` set to someone else; validation that differs between the screen and the database. It also explains why the newer modules (command functions) are robust while older ones are not.
- **What we do:** For each of the 39 files, replace the browser write with a server action or an existing command function that derives company and user on the server, validates with the shared Zod schema, and writes an audit record. Then remove INSERT, UPDATE and DELETE privileges on those tables from signed-in users, so the database itself refuses a direct write. Add a lint rule that fails the build if a file marked `"use client"` calls `.insert`, `.update`, `.delete` or `.upsert`. Start with roles, role permissions, feature flags and dies; finish with the generic form.

### FS-90 — Audit entries written only by the server

- **Importance:** Critical · **Effort:** S
- **What I found:** `data-center-client.tsx:83` inserts rows into `audit_logs` from the browser, with the action text, entity type and metadata all supplied by the page.
- **Why:** An audit log that users can write to is not evidence. Whether the current policy lets every role do this was not tested (the audit's forge attempt failed on a column name, not on a refusal), so treat it as unverified exposure.
- **Problem it solves:** Fabricated or misleading history entries.
- **What we do:** Remove the insert privilege on every audit table from signed-in users. Audit rows come only from triggers and server-side functions. Add a test that each role's direct insert is refused.

### FS-91 — Retire or rebuild the first-generation modules

- **Importance:** High · **Effort:** L
- **What I found:** The codebase has two generations. Newer work (November and Autopilot) goes through server-side command functions with preview, fingerprint and approval. Older modules — maintenance (772-line client that writes directly), energy (a 762-line page file), automation, tenders, exports, CRM, compliance, data centre — are built in the earlier style and have few or no tests by name.
- **Why:** Users cannot tell which generation a screen belongs to. One weak module lowers trust in all of them.
- **Problem it solves:** Uneven quality; modules that look complete but lack the controls the rest of the system has.
- **What we do:** For each first-generation module, decide with Omalco: **keep and rebuild** to the current standard (server writes, tests, overview/database/detail structure), **hide** behind a feature flag until needed, or **remove**. Maintenance and energy probably matter; tenders and export documentation may not for Omalco today. Fewer modules, all at one standard, is the stronger product.

### FS-92 — Break up the generic record form and adopt one form library

- **Importance:** High · **Effort:** L
- **What I found:** One component, `record-form-client.tsx`, is 1,344 lines and serves orders, production, dispatch, packaging, foundry, expenses and more through a chain of `if (moduleKey === ...)` branches, with 17 `as any` casts. Its configuration file is another 1,156 lines. The project's stack lists React Hook Form, but no file uses it; forms are hand-built with `useState`.
- **Why:** This file is where a change to one module can break another. It is the hardest part of the application to modify safely.
- **Problem it solves:** Regressions across unrelated modules; slow feature work; validation that drifts from the server's.
- **What we do:** Give each module its own form built from shared field components (text, number with unit, searchable select, date, profile picker). Use React Hook Form with the same Zod schema the server action uses, so screen and server cannot disagree. Keep draft autosave and duplicate warnings as shared hooks. Migrate one module at a time, starting with the simplest, and delete each branch from the generic form as it goes.

## 26. Performance

### FS-93 — Load the session once per request

- **Importance:** High · **Effort:** S
- **What I found:** `getSessionContext()` is called from 462 places and is not memoised. Each call makes a round trip to the Auth service and then runs `select("*")` on the staff table. A page that calls it in the page, in two panels and in a helper pays four times.
- **Why:** This is fixed cost on every page load, for every user.
- **Problem it solves:** Slow first paint; unnecessary load on Auth and the database.
- **What we do:** Wrap the function in React's per-request `cache()`, and select only the nine columns it returns. A small change with an effect on every screen. Measure before and after on the five busiest pages.

### FS-94 — Ask only for the columns a screen needs

- **Importance:** High · **Effort:** M
- **What I found:** 155 queries use `select("*")`.
- **Why:** Two reasons. Size: wide rows with JSON columns are sent to the browser and discarded. Safety: the project forbids exposing cost, margin and internal notes to the wrong audience, and `select("*")` in a client-visible query returns whatever columns the table has, including ones added later.
- **Problem it solves:** Slow lists on a phone; accidental exposure of a sensitive column added in a future migration.
- **What we do:** Replace each with an explicit column list, or with the existing `*_authorized` views for commercial tables. Prioritise queries whose results reach a client component or the portal. Add a lint rule against new `select("*")`.

### FS-95 — Streaming, lazy loading and cached reads

- **Importance:** High · **Effort:** M
- **What I found:** No Suspense boundary, no lazy import and no cached read anywhere; 236 client-side files; 284 `revalidatePath` calls and no tag-based invalidation.
- **Why:** Every page waits for its slowest query before showing anything, and every user downloads code for features they did not open (PDF builder, QR scanner, configurator preview).
- **Problem it solves:** Blank screens on slow connections; heavy first load on shop-floor tablets.
- **What we do:** Show the page frame immediately and stream slow panels in with Suspense and a skeleton. Lazy-load the heavy pieces: scanner, PDF preview, configurator drawing, charts, report builder. Cache slow-changing master data (profiles, alloys, customers list for pickers) with tags and invalidate by tag when a master changes. Set a size budget for the first load and check it in CI.

## 27. Honesty and UX

### FS-96 — Make the automation rule builder real or remove it *(verify first)*

- **Importance:** High · **Effort:** M
- **What I found:** `automation-client.tsx` saves rules, and also inserts a row into `automation_runs` from the browser. A "run" recorded by the page itself suggests rules may be logged rather than executed. I did not trace whether any server process evaluates them.
- **Why:** `CLAUDE.md` rule 5.8 forbids features that look as if they work but do not.
- **Problem it solves:** An owner creating a rule ("alert me when a die passes 80 % of life") and trusting that it is running.
- **What we do:** Trace it. If rules are not executed by a server process, either hide the module or rebuild it on the event backbone (FS-13) with the scheduled jobs that already run: a rule is a condition on an event plus an action (task, notification, WhatsApp), evaluated on the server, with a real run log.

### FS-97 — Re-home the eight task hubs under business modules

- **Importance:** High · **Effort:** M
- **What I found:** `/tasks` holds 68 pages across hubs named assurance, commercial, control, coordination, execution, improvement, lifecycle and specialist. Those are the names of development batches. Laboratory tests, weighbridge transactions, warehouse transfers, heat treatment, tooling accounts and blanket agreements live under "Tasks → Specialist".
- **Why:** A quality inspector looks for lab tests under Quality, not under Tasks. A hundred good features are invisible if they are filed by build order.
- **Problem it solves:** Features nobody finds; training that has to explain the menu.
- **What we do:** Map each of the hundred November features to the business module a user would expect (lab tests → Quality; weighbridge → Dispatch; heat treatment → Production; transfers → Inventory; agreements → Sales). Keep the URLs working with redirects. Leave "Tasks" as only what it says: my work, approvals and follow-ups. Test the new menu with three real users by asking them to find five things.

### FS-98 — Replace browser confirm boxes with a consequence review

- **Importance:** Medium · **Effort:** S
- **What I found:** Completing a production job, rejecting or completing a finishing job, and dispatch steps use the browser's plain `confirm()` box. A `ReviewDialog` component already exists.
- **Why:** These are the irreversible, high-value actions. A grey system box that people click through by habit is the weakest possible guard.
- **Problem it solves:** Accidental completion or rejection.
- **What we do:** Use the existing review dialog everywhere: show what will change in plain numbers ("Stock +412 kg, scrap +18 kg, job closes, billets released: 2"), require a typed reason for rejections, and disable the confirm button for a moment so it cannot be double-clicked.

### FS-99 — Programmatic labels and automated accessibility checks

- **Importance:** Medium · **Effort:** M
- **What I found:** 1,112 inputs, 862 labels, 16 `htmlFor` attributes. Many labels probably wrap their input, which works; I did not check each. No automated accessibility test exists.
- **Why:** Correct labelling is what makes tapping a label focus the field on a phone, and what makes browser autofill and assistive tools work.
- **Problem it solves:** Small tap targets; fields a screen reader cannot name.
- **What we do:** Put the label association inside the shared field components from FS-92, so it is right by construction. Add an automated accessibility scan to the mounted-browser tests for the ten most-used screens and fail on serious issues.

### FS-100 — Tighten the content security policy

- **Importance:** Medium · **Effort:** M
- **What I found:** The policy is good in most respects but allows inline scripts (`script-src 'self' 'unsafe-inline'`, `next.config.ts`).
- **Why:** Allowing inline scripts removes most of the policy's protection against injected script.
- **Problem it solves:** A stored value that manages to carry script running in another user's session.
- **What we do:** Move to a per-request nonce for scripts, generated in `proxy.ts`. Test thoroughly, because this is easy to get wrong with a framework's own inline scripts. Fix the camera permission (audit PA2-008) in the same change.

## 28. Database

### FS-101 — Trigger map and consolidation on the five core tables

- **Importance:** High · **Effort:** L
- **What I found:** `production_jobs` has 28 triggers, `orders` 22, `invoices` 21, `quotes` 20, `dispatches` 18; 495 in total.
- **Why:** With 28 triggers on one table, nobody can say with confidence what a single update does or in which order. Triggers fire alphabetically by name, so behaviour can depend on naming. This is where the next hard-to-find bug will come from.
- **Problem it solves:** Side effects that surprise; slow writes; a fix in one trigger undone by another.
- **What we do:** Generate a trigger map per table from the catalog (name, timing, event, function, one-line purpose) and keep it in `docs/`, regenerated in CI. Then consolidate: one "validate" trigger, one "derive values" trigger, one "record history" trigger per table, each calling clearly named helpers. Number-prefix trigger names so the order is explicit. Do it one table at a time with the full suite as the safety net, starting with `production_jobs`.

### FS-102 — Split the giant database functions

- **Importance:** Medium · **Effort:** L
- **What I found:** 74 functions are longer than 10,000 characters. `assurance_context` is 66,804; `lifecycle_context` 53,231; `purchase_lifecycle_command` 44,008.
- **Why:** A single function of that size handles many commands. It cannot be reviewed, and a change to one command risks all of them.
- **Problem it solves:** Review fatigue; merge conflicts; one bad edit breaking a whole hub.
- **What we do:** Keep the public command entry point thin: authenticate, look up the command in a small registry, call one private function per command. Each private function gets its own tests. No behaviour change, so the existing SQL tests verify the refactor.

### FS-103 — Index and policy hygiene from the advisor

- **Importance:** High · **Effort:** M
- **What I found:** The hosted performance advisor reports 15 duplicate indexes, 433 foreign keys without an index, 270 cases of several permissive policies on one table and action, and 16 policies that re-evaluate the user's identity for every row. There are 2,326 indexes for 516 tables.
- **Why:** Duplicate indexes slow every write for nothing. A missing index on a foreign key makes deletes and joins on the parent slow. Overlapping policies are both slower and harder to reason about — the audit's offboarding defect (PA2-001) came from exactly that on the staff table.
- **Problem it solves:** Slow writes on busy tables; slow lists as data grows; policy interactions nobody intended.
- **What we do:** Now: drop the 15 duplicates; fix the 16 per-row identity checks (a mechanical change); add indexes for foreign keys on the high-volume children (stock movements, job events, packing items, payments, audit rows). After three months of real use: review the unused-index list and drop what is still unused. Merge overlapping policies into one per role and action, table by table, protected by the permission matrix (FS-43). `pg_stat_statements` is already installed; review the slowest twenty queries monthly.

### FS-104 — Constrain status values and share one state machine

- **Importance:** High · **Effort:** M
- **What I found:** 43 text status columns have no check constraint, and there are only 14 enum types. Status lists are also written out in TypeScript.
- **Why:** A status the application does not recognise makes a record vanish from every board that groups by status.
- **Problem it solves:** Records stuck in a misspelt or retired status; boards and database disagreeing about which statuses exist.
- **What we do:** Add a check constraint or lookup table for each of the 43 columns. Define allowed transitions once, in the database, as a small table (from, to, role allowed) that the transition functions consult. Generate the TypeScript status lists and labels from it at build time so the two can never drift.

### FS-105 — Contracts for JSON payloads

- **Importance:** Medium · **Effort:** M
- **What I found:** 233 JSON columns, and the command functions take a JSON payload.
- **Why:** JSON is flexible and unchecked. A missing or misnamed key is found at run time, sometimes much later when a report reads the row.
- **Problem it solves:** Stored snapshots that later code cannot read; the "malformed payload shows as zero" class of defect.
- **What we do:** For each JSON column that stores a business snapshot (quote line snapshot, technical specification, invoice source), write a schema with a version number, validate on write in the function that stores it, and validate on read in TypeScript with the same Zod schema. Promote keys that are filtered or reported on into real columns.

### FS-106 — Schema diet: review 516 tables after ninety days

- **Importance:** Medium · **Effort:** M
- **What I found:** 516 tables; on hosted today only 8 contain rows. A visit beacon for navigation already exists in the code.
- **Why:** Every table is something to secure, migrate, back up and explain. Many belong to features that Omalco may never use.
- **Problem it solves:** Carrying the cost of unused features forever.
- **What we do:** After ninety days of real use, list tables with no rows and modules with no visits. For each, decide with Omalco: keep, hide, or remove (archiving the migration and data first). Do not remove anything on the strength of today's empty database.

## 29. Maintainability

### FS-107 — One documentation home; archive the rest

- **Importance:** Medium · **Effort:** S
- **What I found:** 38 markdown files at the repository root and 59 in `docs/`, most of them dated batch reports, audits and handovers. Stray files at the root include `test-costing.ts`, `pdf fix.MD`, and committed `playwright-report` and `test-results` folders. About forty one-off audit and QA scripts sit in `scripts/`.
- **Why:** A new developer, or an AI agent, cannot tell which document describes the system as it is now.
- **Problem it solves:** Decisions made from stale documents; long onboarding.
- **What we do:** Keep a small set of living documents: project context, architecture, database and security, business logic, KPI dictionary, deployment, UI guidelines, and `CLAUDE.md`. Move every dated report to `docs/archive/` by year. Add short decision records for the big choices (single company, command functions, one stock ledger). Move one-off scripts to an archive or turn the useful ones into tests. Ignore generated report folders in git.

### FS-108 — Faster, layered test suite

- **Importance:** Medium · **Effort:** M
- **What I found:** 3,374 tests take 14 minutes at a concurrency of two. 34 files only check that text exists in source files.
- **Why:** A slow suite gets run less, and then it protects less.
- **Problem it solves:** Skipped test runs; long waits in CI.
- **What we do:** Split into layers that run separately: unit (seconds), SQL behaviour, browser. Have SQL tests clone one pre-migrated database instead of replaying the chain per file (verify how the helper works today). Run only affected tests locally and everything in CI, in parallel. Replace the 34 text-only files with behavioural tests or delete them. Add two-session concurrency tests for allocation, completion and dispatch, which the audit found missing.

---

## 30. Where the third set fits

| Phase (from section 9) | Add from this set |
|---|---|
| 0. Make it safe | FS-90 (audit writes), FS-93 (session cache), the quick part of FS-103 (duplicates and per-row checks), FS-107 (documentation) |
| 1. Make it true | FS-89 (server-side writes), FS-104 (status constraints), FS-96 (automation honesty), FS-108 (test layers) |
| 2. Make it effortless | FS-97 (menu), FS-98 (review dialogs), FS-95 (streaming and lazy loading), FS-92 (forms), FS-99 (labels) |
| 3 onward | FS-91, FS-94, FS-100, FS-101, FS-102, FS-105, FS-106 |

## 31. The three findings from this dive that matter most

1. **Writes from the browser (FS-89, FS-90).** It is the largest gap between the project's own rules and its code, and it is concentrated in older modules.
2. **The menu is organised by build batch, not by job (FS-97).** A hundred November features are effectively hidden.
3. **Trigger and policy density on the core tables (FS-101, FS-103).** It works today; it is where future defects will be hardest to find.

## 32. Caveats on the third set

- Counts are from text searches and catalog queries. They show scale, not an exact list; some of the 87 write calls are in server files and are fine.
- Row-level security still applies to browser writes. FS-89 is about validation, integrity and authorship, not about cross-company access.
- "Verify first" on FS-96 means I saw the browser recording a run and did not trace a server-side executor. It may exist.
- I did not measure page load times or query plans. Performance items rest on code structure, not timings.
- Hosted usage figures are meaningless until the system has real activity.

---

# Fourth set: the connection map (FS-109 to FS-139)

Added 11 November 2026. This pass ignored features and looked only at **how things are joined**: which records point to which, by a real database key or only by a typed number; which modules link to each other on screen; which tables and functions nothing uses. Sources: the hosted catalog (1,738 foreign keys, 1,099 functions, read-only), and a script over every page, component and library file.

The headline: **the main order-to-cash spine is well joined. Around it there are several places where the same thing is modelled twice, and a ring of modules that are joined to nothing.**

## 33. What the map shows

### The physical chain, link by link

| Link | How it is joined today | Verdict |
|---|---|---|
| Quote line → order line | `order_items.quote_item_id` (key) | Sound |
| Order → production job | `production_jobs.order_id` (key) | Sound |
| Order **line** → production job | `source_record_id`, `source_line_id` on the job, no database key | Weak (FS-113) |
| Job → die, press, profile | Keys | Sound |
| Foundry heat → billet | `foundry_billets.foundry_batch_id` (key) | Sound |
| Billet → job | `production_billet_issues` (keys both ways) | Sound |
| A second billet table, `billet_batches` | Joined only to vendors; `heat_number` is text; lab requests and incoming releases hang off it | Duplicate model (FS-109) |
| Job → finished stock batch | `profile_stock_batches.production_job_id` (key) | Sound |
| Inspection → job | `quality_inspections.production_job_id` (key) | Sound |
| Inspection → stock batch, die, press, heat | None. `batch_number` and `inspector_name` are text | Missing (FS-111) |
| Stock batch → packed line → dispatch | Keys | Sound |
| Weighbridge reading → dispatch or purchase | No table carries a weighing-session key | Missing (FS-115) |
| Dispatch → invoice | `invoices.dispatch_id` (one dispatch per invoice) | Sound, single only |
| Invoice line → packed line | None; invoice lines point to order and quote lines | Missing (FS-114) |
| Invoice → payment | Key | Sound |
| Scrap from a job → scrap lot | `production_scrap_lines` (keys) | Sound |
| Die → corrections, trials, health metrics | `die_id` with no database key | Weak (FS-116) |

### Things modelled more than once

| Subject | Parallel structures found |
|---|---|
| Billets | `foundry_billets` (14 writer functions) and `billet_batches` (2 writers, both cut-over or assurance) |
| Quality records | `quality_inspections` (fixed columns), inspection plans and `inspection_results`, `qc_sample_requirements/results`, `lab_requests/results` |
| Stock on hand | `inventory_items.current_stock`, `packaging_materials.current_stock`, `maintenance_spare_parts.current_stock`, `profile_stock_batches`, three `available_weight_kg` columns, plus a legacy `inventory_transactions` table only two legacy functions touch |
| Scrap | `scrap_records`, `foundry_aluminium_scrap`, `production_scrap_lines`, `scrap_yard_weighings`, `remnant_lots` |
| User identity | 284 foreign keys point to `app_users`, 208 to the Auth users table |
| KPIs | Dashboard reads two snapshot functions; Command Center reads 13 tables directly in the page; Analytics reads a third function |

### Counts

| Measure | Value |
|---|---|
| Tables with no link to any business table (only company or user) | 61 |
| Tables no database function mentions | 62 |
| Identifier columns with no database key ("soft" references) | 167 |
| Tables that point to "some record" by type-and-id | 40 |
| Functions callable by signed-in users / of those never named in app code | 179 / 0 |
| Record types covered by global search | 7 |
| Modules with no on-screen link to any other module | Maintenance, Energy, CRM, Exports, Compliance, Profitability, Die Intelligence |
| Module families that query the staff table directly | 41 |

### Corrections to earlier sets, from this pass

| Earlier item | Correction |
|---|---|
| FS-96 automation | **Confirmed, no longer "verify".** `automation_rules` and `automation_runs` are mentioned by no database function and by no server code other than the page that saves them. Rules are stored and never executed. |
| FS-97 menu | Partly done already: Autopilot's home-work navigation sends users to `/production/work`, `/quality/work`, `/dispatches/work` and similar with the hub action. What remains is the menu labels and the `/tasks/...` URLs. |
| FS-17 quality | I assumed an NCR and complaint flow existed. No complaint, NCR or corrective-action table exists (FS-122). |
| FS-48 WhatsApp | Confirmed: messages are `wa.me` links a person taps. Template and outbound-message tables are touched by no function. |
| FS-58 tolling | More exists than I said: toll agreements, movements, receipts and statements, with a position function. Remaining work is the missing customer key and the monthly statement. |
| FS-61 gate | Returnable gate passes and gate-pass returns exist. Remaining: vehicle and visitor register. |
| FS-83 second location | A `branches` table is already referenced by 38 tables, and some carry `plant_id`. The dimension exists; it is not consistently used. |
| FS-14 chemistry | Alloy limits already exist in code — see FS-112. |

### Summary table

| # | Recommendation | Importance | Effort |
|---|---|---|---|
| FS-109 | Merge the two billet models | Critical | L |
| FS-110 | One quality record model instead of four | High | L |
| FS-111 | Join inspections to stock batch, die, press and heat by key | Critical | M |
| FS-112 | Enforce chemistry on the server with approved limits (not Wikipedia) | Critical | M |
| FS-113 | A real key from production job to order line | High | M |
| FS-114 | Join invoice lines to packed lines | High | M |
| FS-115 | Join weighbridge sessions to dispatches and purchases | High | M |
| FS-116 | Turn the important soft references into real keys | High | M |
| FS-117 | A registry for type-and-id links | High | M |
| FS-118 | One user identity target; names as keys not text | Medium | M |
| FS-119 | Retire legacy stock structures (exact scope for FS-08) | Critical | part of FS-08 |
| FS-120 | One scrap lot ledger | High | M |
| FS-121 | Connect CRM to quotations, or remove it | Medium | S–M |
| FS-122 | Customer complaints, NCR and corrective action | High | L |
| FS-123 | Connect energy to job costing | Medium | M |
| FS-124 | Connect breakdowns to the running job and downtime | High | M |
| FS-125 | Feed Die Intelligence or remove it | High | S–M |
| FS-126 | Make a scan do something | High (verify first) | M |
| FS-127 | Deliver notifications through real channels | High | M |
| FS-128 | Connect or hide tenders and export orders | Medium | S |
| FS-129 | Detail pages: show the whole neighbourhood | High | M |
| FS-130 | Give dead-end modules links in and out | Medium | S |
| FS-131 | Search every record type through one index | High | M |
| FS-132 | One KPI path for dashboard, command centre and analytics | High | M |
| FS-133 | Pull stray arithmetic back into the calculation library | High | M |
| FS-134 | Shared data-access functions for the hot tables | Medium | M |
| FS-135 | Decide now on the tables nothing uses | Medium | S |
| FS-136 | Remove function overloads and legacy functions | Medium | S |
| FS-137 | Decide what `branches` and `plant_id` are for | Medium | S |
| FS-138 | Carry the same link forward into documents and messages | Medium | M |
| FS-139 | A nightly connection-health check and a trace score | High | M |

---

## 34. One model per subject

### FS-109 — Merge the two billet models

- **Importance:** Critical · **Effort:** L
- **What I found:** `foundry_billets` is the working model: joined to heats, orders, jobs and issues, written by 14 functions. `billet_batches` is a second billet table joined only to vendors, with `heat_number` as text and its own `available_weight_kg`. Only the cut-over and assurance functions write to it, yet newer features — laboratory requests and incoming stock releases — are keyed to it.
- **Why:** Billet is the most valuable stock in the plant. Two tables each claiming to hold it guarantees that a lab result or a release recorded against one is invisible to production working from the other.
- **Problem it solves:** A billet lot released by the lab but still blocked on the floor, or the reverse; opening stock loaded at cut-over that production cannot allocate.
- **What we do:** Choose `foundry_billets` (with a lot header) as the single model. Map `billet_batches` rows into it, repoint `lab_requests` and `incoming_stock_releases`, keep `billet_batches` as a read-only view during transition, then retire it. Purchased billet becomes a lot with a supplier and a heat certificate, same as cast billet.

### FS-110 — One quality record model instead of four

- **Importance:** High · **Effort:** L
- **What I found:** Four separate structures hold quality results: the original `quality_inspections` with fixed columns (`hardness_webster`, `dimensional_variance`, `surface_finish_ok`); November's inspection plans and `inspection_results`; Autopilot's `qc_sample_requirements` and `qc_sample_results`; and the specialist `lab_requests` and `lab_results`.
- **Why:** "Did this lot pass?" should have one answer in one place. With four, a release function can consult one and miss a failure recorded in another.
- **Problem it solves:** A failed lab test that does not hold stock because release looks at inspections; certificates assembled from whichever table the developer remembered.
- **What we do:** Define one inspection record: what was inspected (lot, stock batch, job, heat), against which plan and specification revision, by whom, with result lines of characteristic, measured value, limit and pass or fail. Sampling, in-process, final and laboratory become types of that record. Migrate the four in stages behind a view so screens keep working. One function answers "is this lot releasable".

### FS-111 — Join inspections to stock batch, die, press and heat by key

- **Importance:** Critical · **Effort:** M
- **What I found:** `quality_inspections` has keys to the job, the finishing job and the profile. It has no key to the stock batch, die, press or heat; `batch_number` and `inspector_name` are typed text.
- **Why:** A hold must stick to the physical material. If the inspection is tied only to the job, and the job produced three stock batches, the system cannot say which batch failed.
- **Problem it solves:** The audit's concern that failed quality could become dispatchable stock; inability to answer "which inspections cover this bundle".
- **What we do:** Add `profile_stock_batch_id`, and derive die, press and heat from the job at the time of inspection and store them. Replace `inspector_name` with a user key. Make stock availability a function of the latest inspection on that batch, so no separate flag can disagree.

### FS-112 — Enforce chemistry on the server with approved limits

- **Importance:** Critical · **Effort:** M
- **What I found:** Alloy composition limits already exist in `lib/calculations/alloy-composition.ts`. Their stated source is Wikipedia pages, and the only file that uses them is the generic form in the browser. The server function that approves a chemistry result never consults them — which is why the audit could approve a 120 % composition.
- **Why:** The check exists but sits where it can be skipped, and its numbers come from an encyclopedia rather than from a standard Omalco has approved.
- **Problem it solves:** PA2-003 directly, and the risk of releasing metal against limits nobody at Omalco signed.
- **What we do:** Move the limits into a database master per alloy with a revision and an approver. Load them from the standard Omalco works to, entered and signed by the quality head. Have `record_foundry_chemistry_test` compute pass or fail from that master and refuse impossible totals. The browser reads the same master for its hints. Delete the Wikipedia-sourced constants.

### FS-119 — Retire legacy stock structures (exact scope for FS-08)

- **Importance:** Critical · **Effort:** part of FS-08
- **What I found:** Seven independent on-hand numbers (listed in section 33). `inventory_items` is written by 7 functions, `packaging_materials` by 4, `profile_stock_batches` by 12. `inventory_transactions`, which looks like a movement ledger, is touched only by two functions, one of them named `_legacy`.
- **Why:** This is the precise list FS-08 has to absorb, and it shows the audit's packaging defect is one instance of a general shape.
- **What we do:** Use this as the migration checklist for the single stock ledger: 23 writer functions to route through one posting function, seven balance columns to turn into projections, and `inventory_transactions` to either become the ledger or be dropped.

### FS-120 — One scrap lot ledger

- **Importance:** High · **Effort:** M
- **What I found:** Five scrap structures (section 33), joined to each other in places.
- **Why:** Scrap is the input to the next melt. Its weight must reconcile from the saw to the furnace.
- **Problem it solves:** Scrap counted twice or lost between "recorded at the press" and "available to the foundry".
- **What we do:** One scrap lot per bin with category and alloy; movements in the stock ledger; yard weighings attach to the lot by key. The other tables become views or are folded in. This is the data side of FS-29.

### FS-118 — One user identity target; names as keys, not text

- **Importance:** Medium · **Effort:** M
- **What I found:** Foreign keys to users are split, 284 to the staff table and 208 to the Auth table. Some people are stored as text (`inspector_name`, `vendor_name` on breakdowns and spares).
- **Why:** Reports by person need one join. Text names break when someone is renamed and cannot be filtered reliably.
- **What we do:** Standardise on the staff table for every "who" column in new work and migrate the rest over time. Replace typed names with keys, keeping the text as a display snapshot where history needs it.

## 35. Missing joins on the main chain

### FS-113 — A real key from production job to order line

- **Importance:** High · **Effort:** M
- **What I found:** A job has a key to the order. Its link to the specific order line is `source_record_id` and `source_line_id` with no database constraint.
- **Why:** Order-line balance (ordered, produced, dispatched, invoiced) is the core control of the business. It should not depend on an unconstrained column.
- **Problem it solves:** A job pointing at a deleted or wrong line; line balances that drift.
- **What we do:** A `production_job_lines` link table (job, order line, planned quantity) with real keys, which also models one job serving several lines and one line split across jobs. Backfill from the existing columns and report any that do not resolve.

### FS-114 — Join invoice lines to packed lines

- **Importance:** High · **Effort:** M
- **What I found:** Invoice lines carry keys to the order line and quote line but not to the packing-list line. An invoice carries one dispatch.
- **Why:** "Invoiced equals dispatched" should be provable line by line, bundle by bundle.
- **Problem it solves:** Billing a quantity that differs from what left; inability to trace an invoice line to bundles and so to heats.
- **What we do:** Add the packed-line key to invoice lines (or a link table where one invoice line covers several bundles). Add a constraint or check that invoiced weight per packed line cannot exceed packed weight. If Omalco bills several dispatches on one invoice, model that with a link table rather than a single column.

### FS-115 — Join weighbridge sessions to dispatches and purchases

- **Importance:** High · **Effort:** M
- **What I found:** `weighing_sessions` and `weighing_readings` exist and are used by the specialist and scrap functions. No dispatch, receipt or purchase table carries a weighing-session key; dispatch weight is a typed total.
- **Why:** The weighbridge figure is the most trusted number on site. It should be the dispatch weight, not sit beside it.
- **What we do:** Add the session key to dispatches, goods receipts and scrap sales. The document's weight becomes the session's net weight; a manual weight requires a reason and approval. This is the data half of FS-47.

### FS-116 — Turn the important soft references into real keys

- **Importance:** High · **Effort:** M
- **What I found:** 167 identifier columns have no database key. Many are deliberate type-and-id links (FS-117). The ones that should simply be keys include: `die_corrections.die_id`, `die_trials.die_id`, `die_health_metrics.die_id`, `sample_events.die_id`, `order_cost_breakdown.order_id`, `job_profit_snapshots.order_id`, `export_orders.order_id`, `tenders.converted_order_id`, `production_exceptions.order_id` and `.machine_id`, `remnant_lots.source_job_id`, `toll_movements.customer_id`, `toll_statements.customer_id`, `technical_queries.customer_id`, `expense_ledger.maintenance_record_id`, `stock_transfer_lines.profile_id`.
- **Why:** Without a key the database cannot stop a correction being recorded against a die that does not exist, or a profit snapshot outliving its order.
- **What we do:** Add the constraints, as `NOT VALID` first, run a report of rows that fail, fix or null them, then validate. Use `RESTRICT` for history.

### FS-117 — A registry for type-and-id links

- **Importance:** High · **Effort:** M
- **What I found:** 40 tables point at "some record" using a type column and an id column — tasks, notifications, audit rows, documents, events. The database cannot check these.
- **Why:** This pattern is reasonable for tasks and notifications, but unmanaged it produces links to records that no longer exist and type names spelt several ways.
- **Problem it solves:** A task that opens a 404; notifications grouped under two spellings of the same type.
- **What we do:** One `entity_types` table listing every allowed type with its table and its page URL pattern. A shared trigger validates type and existence on insert. One helper in code turns any type-and-id into a link and a display label. Section FS-139's nightly check reports any that have gone stale.

## 36. Modules joined to nothing

### FS-122 — Customer complaints, NCR and corrective action

- **Importance:** High · **Effort:** L
- **What I found:** There is no table for complaints, non-conformance reports or corrective actions. Related pieces exist (rework resolutions, quality-pack issues, return authorisations, alloy deviations). `CLAUDE.md` lists NCRs and customer complaints as product scope.
- **Why:** This is the loop that turns a customer problem into a permanent fix, and the first thing a quality auditor asks to see.
- **What we do:** A complaint record keyed to customer, invoice, dispatch and bundle, which opens an NCR keyed to job, die, press and heat through the trace. Root cause, containment (FS-11), corrective action as tasks, cost, and a dated effectiveness check. Returns and credit notes link to it rather than standing alone.

### FS-121 — Connect CRM to quotations, or remove it

- **Importance:** Medium · **Effort:** S–M
- **What I found:** Leads, opportunities, activities and targets exist. No database function mentions leads; quotations carry no lead or opportunity key.
- **Why:** A pipeline that cannot see which leads became quotes and orders cannot report conversion or forecast.
- **What we do:** Add an opportunity key to quotations and set stage automatically from quote events (sent, revised, won, lost). Or, if sales will not maintain a pipeline, hide the module.

### FS-123 — Connect energy to job costing

- **Importance:** Medium · **Effort:** M
- **What I found:** An energy reading posts to the expense ledger and nothing else. `production_kg` and `cost_per_kg` on the reading are entered values.
- **Why:** Energy per tonne is only meaningful if tonnes come from production records, and it only helps pricing if it reaches job cost.
- **What we do:** Compute production kg for the reading's press and period from completed jobs. Allocate the period's energy to jobs by press hours, feeding FS-12.

### FS-124 — Connect breakdowns to the running job and downtime

- **Importance:** High · **Effort:** M
- **What I found:** Breakdown logs are well connected to scheduling capacity, tasks and expenses. They are not keyed to the job that was running, and the Maintenance screens link to no other module.
- **Why:** A breakdown's real cost is the job it interrupted.
- **What we do:** On raising a breakdown, capture the running job automatically, put it on hold with the reason, and record the downtime against OEE (FS-15). From the machine page, show its breakdowns, energy and recent jobs.

### FS-125 — Feed Die Intelligence or remove it

- **Importance:** High · **Effort:** S–M
- **What I found:** The Die Intelligence page reads `die_health_metrics`. That table has no key to dies and no database function writes to it. Die usage itself is maintained by `refresh_die_usage`.
- **Why:** A page headed "intelligence" over a table nothing fills breaks the no-fake-features rule.
- **What we do:** Populate the metrics from `refresh_die_usage` and press events (kg and billets since nitriding, corrections, recovery trend), with a key to the die. Or remove the page until FS-16 is built.

### FS-126 — Make a scan do something *(verify first)*

- **Importance:** High · **Effort:** M
- **What I found:** `qr_codes` and `scan_events` are mentioned by no database function. The scan page resolves a code and records a scan session through server actions I did not read in full.
- **Why:** Scanning is only worth an operator's time if it moves stock, loads a truck or starts a job.
- **What we do:** Check what the session action does today. Then make each scan mode a transaction: putaway, pick, load, issue, count — each posting to the stock ledger with the scan as its evidence.

### FS-127 — Deliver notifications through real channels

- **Importance:** High · **Effort:** M
- **What I found:** 30 database functions create notifications, so the system knows when something matters. Delivery is the in-app list only. Email exists as a separate library. WhatsApp templates and outbound-message tables are touched by no function.
- **Why:** The hard part — deciding what to tell whom — is done. The last step is missing.
- **What we do:** A delivery worker on the scheduled jobs already running: for each new notification, look up the recipient's preferences (a preferences table exists) and send by push, email or WhatsApp API, recording the result in the outbound table.

### FS-128 — Connect or hide tenders and export orders

- **Importance:** Medium · **Effort:** S
- **What I found:** Tenders and export orders are mentioned by no database function. Their links to orders have no key.
- **What we do:** Ask Omalco whether they bid for tenders or export. If yes, key them to quotations and orders and bring them to the current standard. If no, hide both.

### FS-130 — Give dead-end modules links in and out

- **Importance:** Medium · **Effort:** S
- **What I found:** Maintenance, Energy, CRM, Exports, Compliance, Profitability and Die Intelligence link to no other module from their pages, and the only link into each is the menu.
- **Why:** People reach information through the record they are looking at, not through the menu.
- **What we do:** From an order, link to its profitability. From a machine, to its maintenance and energy. From a die, to its intelligence. From an instrument, to its calibration. And back again.

## 37. Reading across the joins

### FS-129 — Detail pages: show the whole neighbourhood

- **Importance:** High · **Effort:** M
- **What I found**, by reading which tables each detail page queries:

| Page | Shows | Does not show |
|---|---|---|
| Customer | Orders, quotes | Invoices, payments, outstanding, dispatches, complaints |
| Order | Lines, jobs, billets, dispatches, stage history | Invoices, payments, inspections, packaging, finishing |
| Production job | Billets, scrap, input exceptions | Inspections, finishing, packaging, stock produced, die history |
| Dispatch | Packed lines, invoices, credit notes, status history | Weighbridge, the jobs and heats behind the bundles |
| Invoice | Payments, credit notes | Dispatch, packed lines, order |
| Profile | Dies, jobs, quote lines | Stock, inspections, customers |
| Die | Corrections, nitriding, trials, jobs, documents | Recovery trend, defects, location |

- **Why:** This is the concrete specification for FS-67. Every missing item is data the system already holds one join away.
- **What we do:** Add the missing related panels to each page, each a small server-side query with a "view all" link, loaded lazily (FS-95). Start with Customer (outstanding and payments) and Order (invoices and payments), since those answer the most phone calls.

### FS-131 — Search every record type through one index

- **Importance:** High · **Effort:** M
- **What I found:** Global search queries seven tables: profiles, customers, dealer orders, dies, dispatches, orders, quotes. It cannot find an invoice, a job, a heat, a billet, a bundle, a vendor, a payment or a task.
- **Why:** People search by whatever number is on the paper in their hand.
- **What we do:** One `search_index` table (type, id, number, title, keywords, who may see it) maintained by triggers, with trigram matching so a partial or mistyped number still finds it. Search reads only that table and respects role visibility. Results open through the registry in FS-117.

### FS-132 — One KPI path for dashboard, command centre and analytics

- **Importance:** High · **Effort:** M
- **What I found:** Three screens compute management numbers three ways: two snapshot functions, a third analytics function, and 13 tables read directly inside the Command Center page.
- **Why:** The KPI dictionary says every screen must use one definition. Three code paths will disagree eventually.
- **What we do:** Move Command Center's arithmetic into the same KPI functions the dictionary names. Add a test that fetches the same figure through each screen's path on a fixture and requires equality.

### FS-133 — Pull stray arithmetic back into the calculation library

- **Importance:** High · **Effort:** M
- **What I found:** `lib/calculations` is well organised (quote, GST, recovery, weight, rounding, billet estimate). Outside `lib/`, 23 files round numbers themselves, 11 format to two decimals inline, 11 handle the GST percentage and 31 mention recovery.
- **Why:** Rule 5.7 again. The audit's paise-level mismatch between screen and database is what this produces.
- **What we do:** Review those files; anything that computes rather than displays moves into the library. One rounding helper and one money formatter used everywhere. A lint rule against `toFixed` and `Math.round` in components.

### FS-134 — Shared data-access functions for the hot tables

- **Importance:** Medium · **Effort:** M
- **What I found:** The staff table is queried directly by 41 module families, customers by 21, profiles by 19, jobs and dies by 18 each.
- **Why:** Each of those is a place to forget a filter, select too much, or miss a new rule.
- **What we do:** A small `lib/data` layer: `listCustomersForPicker`, `getProfileSummary`, `listActiveStaff`, each with a fixed column list and the right view. Pages call those. This is where FS-94's column narrowing and FS-95's caching get applied once.

### FS-138 — Carry the same link forward into documents and messages

- **Importance:** Medium · **Effort:** M
- **Why:** A connection that exists in the database but not on paper is lost the moment a document is printed.
- **What we do:** Every PDF prints its upstream references (quotation and order on the invoice; job and heat on the test certificate; invoice on the packing list) and a QR that opens the record. Every notification and WhatsApp message carries a deep link built by the FS-117 helper.

## 38. Clearing what nothing uses

### FS-135 — Decide now on the tables nothing uses

- **Importance:** Medium · **Effort:** S
- **What I found:** 62 tables are mentioned by no database function and 61 have no link to a business table. The overlap includes automation rules and runs, QR codes and scan events, tenders, export orders and documents, sales activities and targets, compliance audit records, calibration records, checklist templates and responses, document packs and versions, technical queries, WhatsApp templates and campaigns, and die health metrics.
- **Why:** FS-106 said to wait ninety days for usage. This list does not need usage data: these are structurally unconnected today.
- **What we do:** Go through the list once with Omalco. For each: connect it (several items above), hide it, or remove it.

### FS-136 — Remove function overloads and legacy functions

- **Importance:** Medium · **Effort:** S
- **What I found:** `create_order_from_quote_with_dealer_workflow_atomic` exists in three versions callable by signed-in users. A `submit_dealer_receipt_atomic_legacy` remains. All 179 callable functions are named somewhere in the app, so there is no dead callable surface beyond these.
- **Why:** With overloads, which version runs depends on the arguments sent; an old version can be reached by accident or on purpose.
- **What we do:** Keep one version of each, revoke and drop the others, and add a check to CI that fails on any overloaded callable function.

### FS-137 — Decide what `branches` and `plant_id` are for

- **Importance:** Medium · **Effort:** S
- **What I found:** 38 tables reference `branches`; some have `plant_id`. The product is declared single-factory.
- **What we do:** Either adopt branch as the official location dimension (which makes FS-83 mostly a matter of using it everywhere) or stop adding it to new tables. Write the decision down.

## 39. Keeping the connections healthy

### FS-139 — A nightly connection-health check and a trace score

- **Importance:** High · **Effort:** M
- **Why:** Everything in this set is a state that can decay again. A check that runs every night turns "we fixed the links" into "the links are intact".
- **What we do:** A scheduled job (the scheduler is already running) that counts and lists: soft references pointing at nothing; type-and-id links to missing records; jobs without an order line; stock batches without a job or an opening record; dispatched bundles without an inspection; invoices whose lines do not resolve to packed lines; differences between each cached balance and its ledger. Results go to an owner-visible "Data health" page with a trend. Add a **trace score** per dispatch: the share of its bundles that can be followed, by keys only, back to a heat with chemistry. Put the monthly average on the owner cockpit.

---

## 40. Where the fourth set fits

| Phase (from section 9) | Add from this set |
|---|---|
| 0. Make it safe | FS-112 (chemistry on the server), FS-136 (overloads), FS-125 and the FS-96 decision (no fake features) |
| 1. Make it true | FS-109 (billets), FS-111 (inspection to batch), FS-113, 114, 116 (keys), FS-119 and 120 (stock and scrap), FS-132, 133 (one KPI and calculation path), FS-139 (health check) |
| 2. Make it effortless | FS-129 (detail pages), FS-131 (search), FS-130 (links), FS-126 (scan), FS-127 (delivery) |
| 3. Make it connected | FS-115 (weighbridge), FS-138 (documents) |
| 4 onward | FS-110, 117, 118, 121, 122, 123, 124, 128, 134, 135, 137 |

## 41. The five connection findings that matter most

1. **Chemistry limits exist but are checked only in the browser, and are sourced from Wikipedia (FS-112).** This is the root of an audit P1 and is quick to fix properly.
2. **Billets live in two tables, and newer features are attached to the one production does not use (FS-109).**
3. **Quality results live in four structures, and inspections are not keyed to the stock they judge (FS-110, FS-111).**
4. **Three features present a screen over nothing: automation rules never run, Die Intelligence reads a table nothing fills, and WhatsApp templates are never sent (FS-96, FS-125, FS-127).**
5. **The spine is good.** Quote line → order line → job → billet issue → stock batch → packed line → dispatch → invoice → payment is joined by real keys nearly end to end. The work is at the edges, not the centre.

## 42. Caveats on the fourth set

- "No function mentions this table" was tested by text match on function bodies in the hosted database. A table used only through direct queries from the app, a view or a policy would still appear; I cross-checked the items I call out, not all 62.
- The module link matrix follows each page and the files it imports directly. Links built deeper, or assembled from configuration, can be missed; the earlier "orphan routes" result was mostly that, and I dropped it.
- "Not shown on the detail page" means the page file does not query that table. A panel loaded by a child component from its own query would not be counted.
- Soft references include deliberate type-and-id designs. Only the list in FS-116 is recommended for conversion.
- I did not read the scan session action or every specialist function. FS-126 is marked accordingly.
- Hosted has almost no data, so none of this measures actual orphans — only that the structure permits them.
