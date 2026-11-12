# Autopilot Upgrades: 100 Features So the System Does the Work

Created: 9 November 2026 (Asia/Kolkata)
Document type: Internal planning reference and implementation specification
Audience: Omalco Extrusion owner, department heads, developers, QA, rollout leads
Deployment: Omalco Extrusion only (single company; see CLAUDE.md section 0)
Scope: 100 new numbered targets, AP-001 to AP-100
Status: Proposed. Nothing in this document is implemented, migrated, or deployed.
Batch records: [Batch 1](AUTOPILOT_UPGRADE_BATCH_1.md) (AP-001, 002, 004, 005, 006, 007, 038, 041, 042, 059; built and verified locally, hosted migration not applied).
[Batch 2](AUTOPILOT_UPGRADE_BATCH_2.md) (AP-011, 012, 013, 014, 015, 016, 028, 054, 066, 087, press floor capture; built and verified locally, hosted migration applied 11 November 2026).
[Batch 3](AUTOPILOT_UPGRADE_BATCH_3.md) (AP-045, 046, 032, 058, 024, 084, 031, 037, 097, 098, order-to-cash; built and verified locally, hosted migration applied 11 November 2026).
[Batch 4](AUTOPILOT_UPGRADE_BATCH_4.md) (AP-018, 019, 051, 081, 083, 017, 035, 036, 089, 060, dispatch and compliance; built and verified locally, hosted migration not applied).
[Batch 5](AUTOPILOT_UPGRADE_BATCH_5.md) (in progress, 4 of 10: AP-026, 056, 071, 072; built and verified locally, hosted migration not applied).

## Why this catalogue exists

The first two catalogues ([UPGRADE_EOS.md](UPGRADE_EOS.md), 100 entries, and [NOV_UPGRADES.md](NOV_UPGRADES.md), 100 entries) built the structure: records, workflows, handoffs, approvals, SOPs, and 100 bounded pilots. Most of those pilots still depend on an employee **typing or creating a record** before the system knows anything. The November pilots also landed as separate hubs under `/tasks/*` (assurance, coordination, lifecycle, improvement, execution, commercial, specialist, control), which adds places to visit rather than removing work.

This catalogue changes the direction. Its three goals, from the owner's brief:

1. **The system does most of the work.** Employees confirm, correct, and handle exceptions. They do not re-type facts the system already has or can measure.
2. **Existing modules get re-engineered, not just extended.** Merge overlapping modules, fold pilot hubs back into the records they belong to, and replace manually maintained numbers with derived ones.
3. **Many small efficiency features.** Low-cost changes that remove seconds from actions people repeat hundreds of times a day.

The IDs here are independent of `UPGRADE_EOS` feature numbers and `NOV-###` IDs. Where an AP entry extends earlier work it says so under **Builds on**. No AP entry repeats an earlier target; where an earlier pilot exists, the AP entry is the step that removes the manual input from it.

Navigation: [Autopilot principle](#the-autopilot-principle) | [Ratings](#ratings) | [Foundations](#source-foundations) | [Register](#register) | [A Foundations](#a-autopilot-foundations) | [B Capture](#b-capture-without-typing) | [C Derived values](#c-derived-values-and-smart-defaults) | [D Re-engineering](#d-module-re-engineering) | [E Planning](#e-planning-autopilot) | [F Commercial and finance](#f-commercial-and-finance-autopilot) | [G Small efficiencies](#g-small-efficiency-features) | [Delivery plan](#delivery-plan) | [Integrity](#catalogue-integrity-record)

## The autopilot principle

Every feature in this catalogue follows the same loop. Reviewers should reject a design that skips a step.

| Step | Meaning | Rule |
| --- | --- | --- |
| **Detect** | The system notices a fact from an existing event: a scan, a weight, a completed job, a time passing, a rate change, an uploaded document | Use events and ledgers that already exist; do not ask an employee to report what a transaction already proves |
| **Propose** | The system prepares the value, record, message, or plan and shows where every number came from | Proposals are drafts. They never post stock, money, quality approval, or a customer message by themselves |
| **Confirm** | One person accepts, edits, or rejects, usually in one tap or one batch | The server rechecks authority, source versions, and quantities at commit; the proposal is advisory |
| **Learn** | Acceptance and override rates are recorded per proposal type | A proposal type that is overridden more than it is accepted is reviewed, not silently kept |

Two measurements apply to every entry: **fields typed per completed transaction** (should fall) and **proposal acceptance rate** (should be high, but a 100% rate on a consequential decision suggests rubber-stamping and should be sampled).

## Ratings

Same scales as [NOV_UPGRADES.md](NOV_UPGRADES.md#ratings-and-sorting), restated briefly.

| Complexity | Meaning |
| --- | --- |
| C1 | Focused display or input change using data already available; normally no schema change |
| C2 | Reusable interaction, small derived value, or small preference/config table |
| C3 | Bounded module workflow, read model, parser, or generator with server actions and tests |
| C4 | Cross-module control, transactional lifecycle, device/file integration, or several schema changes |
| C5 | Optimisation or planning engine with interacting constraints |

| Urgency | Meaning | Need | Meaning |
| --- | --- | --- | --- |
| U1 | First priority: daily friction, go-live blocker, or money/quantity correctness | N1 | Essential for correct daily execution |
| U2 | Planned next: material saving with a workaround today | N2 | High value; reduces repeated effort |
| U3 | Later optimisation | N3 | Depends on Omalco's actual process or equipment |
| U4 | Conditional | | |

Context for urgency: the hosted database, auth, and storage were wiped on 9 November 2026 and the app is being prepared for Omalco's go-live. Entries that make go-live data entry possible without weeks of typing (AP-006, AP-007) are therefore U1.

**Section sort:** by theme, then stable ID. **Delivery rank:** urgency, then need, then complexity, then ID (see [Register](#register)).

## Source foundations

Inspected on 9 November 2026 on branch `chore/refresh-evidence-screenshots` (head 2b314d7, with uncommitted single-tenant changes). Existence of a file is a starting point, not proof that the behaviour below exists.

| Key | Existing location | Relevance |
| --- | --- | --- |
| SRC-AUTO | [automation-client.tsx](components/modules/automation-client.tsx), `app/(dashboard)/automation` | "Run now" records a simulated result; there is no scheduler (`vercel.json` absent, no cron route). AP-001 is the missing foundation |
| SRC-AI | [quotation-assistant.ts](lib/ai/quotation-assistant.ts), `lib/ai/providers` | Existing provider seam for text/vision extraction (AP-008, AP-009, AP-020) |
| SRC-INTEG | [integrations-client.tsx](components/modules/integrations-client.tsx), [providers.ts](lib/integrations/providers.ts) | Integration settings surface; Tally is referenced but no export file is produced |
| SRC-CALC | `lib/calculations/` (quote, gst, billet-estimate, length-units, planning-quantity, production-performance, alloy-composition, foundry) | Central calculation home; every derived value below belongs here, not in components |
| SRC-WF | `lib/workflow/` (factory-planning, production-readiness, production-scrap, cutting-workspace, physical-bundles, stock-production, turnaround, shift-handover, task-triggers, subscriptions, costing-rates, data-freshness) | Rules engines the autopilot proposals should call rather than duplicate |
| SRC-STOCK | [stock-balance.ts](lib/inventory/stock-balance.ts), [reservation-ledger.ts](lib/inventory/reservation-ledger.ts), [stock-snapshot.ts](lib/dashboard/stock-snapshot.ts) | Ledger-based stock; AP-034/047 extend it |
| SRC-FIN | [receivables.ts](lib/financials/receivables.ts), [invoice-sources.ts](lib/financials/invoice-sources.ts) | Receivable and billing-eligibility logic for AP-024/046/058/084 |
| SRC-WORK | [my-work.ts](lib/dashboard/my-work.ts), `app/(dashboard)/mobile`, `production/workstation` | Where proposals should appear for confirmation |
| SRC-HUBS | `app/(dashboard)/tasks/{assurance,coordination,lifecycle,improvement,execution,commercial,specialist,control}` | NOV batch pilots; AP-041 folds them into home modules |

## Shared implementation contract

1. Keep the current stack (Next.js App Router, TypeScript, Tailwind, Zod, Supabase Auth/Postgres/Storage/RLS, existing PDF library, Vercel). No second backend. Scheduled work runs through Vercel Cron calling authenticated route handlers (AP-001).
2. Derive `company_id` and the actor from the server session. Keep RLS on every new table even though only Omalco exists. Background jobs act as a named system actor with the narrowest key they need; the service-role key never reaches the browser.
3. Additive migrations only. New derived values are computed from events or ledgers; do not add a second editable total that can drift from its source.
4. A proposal stores: the proposed value, its inputs and their versions, the rule or model used, a confidence or reason, and the eventual decision (accepted / edited / rejected, by whom, when).
5. Nothing automatic sends a customer message, posts stock, posts money, or approves quality. "Prepared", "copied", "sent by provider", and "delivered" are different states.
6. Every parser or extractor (WhatsApp text, photos, PDFs, DXF, bank CSV) produces a reviewable draft with field-level confidence and the original file attached. Unreadable input stays blank, never zero.
7. Device inputs (scales, scanners) always have a manual fallback and record which path was used.
8. List pages keep 10 server-paginated rows, search, filters, sort, and loading/empty/error states. Customer-facing outputs never include cost, margin, supplier rates, or internal notes.
9. Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` per slice; record hosted migration state separately from local results.

## Register

Counts: 7 C1, 31 C2, 46 C3, 15 C4, 1 C5; 44 U1, 48 U2, 8 U3; 54 N1, 45 N2, 1 N3.

| ID | Feature | Theme | Complexity | Urgency | Need | Delivery rank |
| --- | --- | --- | --- | --- | --- | --- |
| [AP-001](#ap-001) | Run scheduled work with a job ledger | A | C4 | U1 | N1 | 40 |
| [AP-002](#ap-002) | Show system proposals as accept/edit cards | A | C3 | U1 | N1 | 18 |
| [AP-003](#ap-003) | Track how often each proposal is accepted | A | C2 | U2 | N2 | 58 |
| [AP-004](#ap-004) | Use one factory calendar for all date calculations | A | C2 | U1 | N1 | 4 |
| [AP-005](#ap-005) | Number documents by financial year automatically | A | C2 | U1 | N1 | 5 |
| [AP-006](#ap-006) | Import masters at go-live from Excel | B | C4 | U1 | N1 | 41 |
| [AP-007](#ap-007) | Record opening balances and lock the cut-over date | B | C3 | U1 | N1 | 19 |
| [AP-008](#ap-008) | Paste a WhatsApp enquiry to get a draft quotation | B | C4 | U2 | N2 | 86 |
| [AP-009](#ap-009) | Turn a photo of a handwritten register into a draft | B | C4 | U2 | N2 | 87 |
| [AP-010](#ap-010) | Read bundle weight directly from the packing scale | B | C4 | U2 | N2 | 88 |
| [AP-011](#ap-011) | Count billets with one tap at the press | B | C3 | U1 | N1 | 20 |
| [AP-012](#ap-012) | Pre-fill production output from the cut plan | B | C3 | U1 | N1 | 21 |
| [AP-013](#ap-013) | Calculate engineering scrap automatically | B | C3 | U1 | N1 | 22 |
| [AP-014](#ap-014) | Detect an idle press and ask why | B | C3 | U1 | N1 | 23 |
| [AP-015](#ap-015) | Record die changes from the job sequence | B | C2 | U2 | N2 | 59 |
| [AP-016](#ap-016) | Trigger quality sampling from output quantity | B | C3 | U1 | N1 | 24 |
| [AP-017](#ap-017) | Print bundle labels when a bundle is confirmed | B | C3 | U2 | N2 | 70 |
| [AP-018](#ap-018) | Verify truck loading by scanning bundles | B | C3 | U1 | N1 | 25 |
| [AP-019](#ap-019) | Derive gate-out from the dispatch | B | C2 | U2 | N2 | 60 |
| [AP-020](#ap-020) | Read billet mill test certificates on receipt | B | C3 | U2 | N2 | 71 |
| [AP-021](#ap-021) | Allocate energy from shift meter readings | B | C3 | U3 | N2 | 97 |
| [AP-022](#ap-022) | Derive crew from workstation sign-ins | B | C2 | U3 | N2 | 94 |
| [AP-023](#ap-023) | Dictate exception reasons on the phone | B | C2 | U3 | N2 | 95 |
| [AP-024](#ap-024) | Import bank statements and match receipts | B | C4 | U1 | N1 | 42 |
| [AP-025](#ap-025) | Use a USB barcode scanner in any field | B | C2 | U2 | N2 | 61 |
| [AP-026](#ap-026) | Learn each customer's usual choices | C | C2 | U1 | N1 | 6 |
| [AP-027](#ap-027) | Detect section-weight drift from bundle weights | C | C3 | U1 | N1 | 26 |
| [AP-028](#ap-028) | Predict die nitriding and correction due | C | C3 | U1 | N1 | 27 |
| [AP-029](#ap-029) | Recommend billet length per job for best recovery | C | C4 | U2 | N1 | 52 |
| [AP-030](#ap-030) | Reprice open drafts from one daily metal-rate update | C | C3 | U1 | N1 | 28 |
| [AP-031](#ap-031) | Expire stale quotations and offer a requote | C | C2 | U1 | N1 | 7 |
| [AP-032](#ap-032) | Hold orders automatically on credit limits | C | C3 | U1 | N1 | 29 |
| [AP-033](#ap-033) | Compute reorder points from actual consumption | C | C3 | U2 | N1 | 47 |
| [AP-034](#ap-034) | Propose reservations when stock arrives | C | C4 | U2 | N2 | 89 |
| [AP-035](#ap-035) | Calculate bundle packing from profile and customer spec | C | C3 | U2 | N2 | 72 |
| [AP-036](#ap-036) | Estimate freight from a transporter rate card | C | C3 | U2 | N2 | 73 |
| [AP-037](#ap-037) | Derive place of supply and GST type from GSTIN | C | C2 | U1 | N1 | 8 |
| [AP-038](#ap-038) | Validate GSTIN and fill state automatically | C | C1 | U1 | N1 | 1 |
| [AP-039](#ap-039) | Fill city and state from PIN code | C | C2 | U2 | N2 | 62 |
| [AP-040](#ap-040) | Accept lengths in any unit | C | C2 | U2 | N2 | 63 |
| [AP-041](#ap-041) | Fold the /tasks pilot hubs into their home modules | D | C4 | U1 | N1 | 43 |
| [AP-042](#ap-042) | Slim the navigation using real usage | D | C2 | U1 | N1 | 9 |
| [AP-043](#ap-043) | Merge Dies and Die Intelligence | D | C3 | U2 | N2 | 74 |
| [AP-044](#ap-044) | Combine reporting into one Insights module | D | C3 | U2 | N2 | 75 |
| [AP-045](#ap-045) | Create draft production jobs when an order is confirmed | D | C3 | U1 | N1 | 30 |
| [AP-046](#ap-046) | Draft invoices automatically at gate-out | D | C3 | U1 | N1 | 31 |
| [AP-047](#ap-047) | Change stock only through movements | D | C3 | U1 | N1 | 32 |
| [AP-048](#ap-048) | Calculate kg/m and perimeter from a die drawing | D | C4 | U2 | N2 | 90 |
| [AP-049](#ap-049) | Suggest equivalent profiles available in stock | D | C3 | U3 | N2 | 98 |
| [AP-050](#ap-050) | Score customer health | D | C3 | U2 | N2 | 76 |
| [AP-051](#ap-051) | Generate the ready-to-ship list | D | C3 | U1 | N1 | 33 |
| [AP-052](#ap-052) | Chart quality readings and alarm on drift | D | C3 | U2 | N2 | 77 |
| [AP-053](#ap-053) | Raise NCRs automatically from rejections | D | C3 | U2 | N1 | 48 |
| [AP-054](#ap-054) | Schedule preventive maintenance from running hours | D | C3 | U2 | N1 | 49 |
| [AP-055](#ap-055) | Batch powder coating by shade | D | C4 | U2 | N2 | 91 |
| [AP-056](#ap-056) | Generate a chase list for finishing vendors | D | C2 | U1 | N1 | 10 |
| [AP-057](#ap-057) | Show last price and variance on purchase entry | D | C2 | U2 | N2 | 64 |
| [AP-058](#ap-058) | Allocate receipts to the oldest invoices | D | C2 | U1 | N1 | 11 |
| [AP-059](#ap-059) | Lock periods and control back-dated entries | D | C3 | U1 | N1 | 34 |
| [AP-060](#ap-060) | Share a safe order-status link | D | C3 | U2 | N2 | 78 |
| [AP-061](#ap-061) | Draft tomorrow's press plan overnight | E | C5 | U2 | N1 | 54 |
| [AP-062](#ap-062) | Calculate seven-day billet requirement from the plan | E | C3 | U1 | N1 | 35 |
| [AP-063](#ap-063) | Predict late order lines every morning | E | C4 | U1 | N1 | 44 |
| [AP-064](#ap-064) | Draft customer delay notices | E | C2 | U2 | N2 | 65 |
| [AP-065](#ap-065) | Project die availability into the plan | E | C3 | U2 | N2 | 79 |
| [AP-066](#ap-066) | Set shift targets from the plan and show achievement | E | C2 | U1 | N1 | 12 |
| [AP-067](#ap-067) | Combine cut lengths across orders of one profile | E | C4 | U2 | N2 | 92 |
| [AP-068](#ap-068) | Suggest make-to-stock runs for idle capacity | E | C3 | U3 | N2 | 99 |
| [AP-069](#ap-069) | Show sellable capacity while quoting | E | C3 | U2 | N2 | 80 |
| [AP-070](#ap-070) | Convert configurator projects to orders with a stock check | E | C4 | U3 | N3 | 100 |
| [AP-071](#ap-071) | Follow up quotations on a schedule | F | C2 | U1 | N1 | 13 |
| [AP-072](#ap-072) | Guard floor prices by alloy and finish | F | C2 | U1 | N1 | 14 |
| [AP-073](#ap-073) | Generate customer rate cards from today's metal rate | F | C3 | U2 | N2 | 81 |
| [AP-074](#ap-074) | Manage scrap sales by grade | F | C3 | U2 | N2 | 82 |
| [AP-075](#ap-075) | Raise weight-difference notes from customer receipt weight | F | C3 | U2 | N2 | 83 |
| [AP-076](#ap-076) | Forecast cash for four weeks | F | C3 | U2 | N2 | 84 |
| [AP-077](#ap-077) | Reconcile customer TDS deductions | F | C3 | U2 | N1 | 50 |
| [AP-078](#ap-078) | Track MSME supplier payment deadlines | F | C2 | U2 | N1 | 45 |
| [AP-079](#ap-079) | Send monthly customer statements from a queue | F | C2 | U2 | N2 | 66 |
| [AP-080](#ap-080) | Prepare a daily owner digest at 8 am | F | C2 | U1 | N1 | 15 |
| [AP-081](#ap-081) | Create the e-way bill upload file from dispatches | F | C3 | U1 | N1 | 36 |
| [AP-082](#ap-082) | Create e-invoice JSON from invoices | F | C3 | U2 | N1 | 51 |
| [AP-083](#ap-083) | Export vouchers to Tally | F | C3 | U1 | N1 | 37 |
| [AP-084](#ap-084) | Prepare a daily payment reminder queue | F | C3 | U1 | N1 | 38 |
| [AP-085](#ap-085) | Generate the month-end close checklist | F | C3 | U1 | N1 | 39 |
| [AP-086](#ap-086) | Add date chips to every date filter | G | C1 | U2 | N2 | 55 |
| [AP-087](#ap-087) | Use a large numeric keypad on workstations | G | C1 | U1 | N1 | 2 |
| [AP-088](#ap-088) | Allow arithmetic inside numeric fields | G | C1 | U3 | N2 | 93 |
| [AP-089](#ap-089) | Copy a WhatsApp-ready summary from every record | G | C1 | U1 | N1 | 3 |
| [AP-090](#ap-090) | Show recently used values first in selectors | G | C1 | U2 | N2 | 56 |
| [AP-091](#ap-091) | Print selected documents as one PDF | G | C2 | U2 | N2 | 67 |
| [AP-092](#ap-092) | Save filters as links and personal default views | G | C2 | U2 | N2 | 68 |
| [AP-093](#ap-093) | Undo reversible actions for a few seconds | G | C2 | U3 | N2 | 96 |
| [AP-094](#ap-094) | Queue factory phone entries while offline | G | C4 | U2 | N1 | 53 |
| [AP-095](#ap-095) | Offer Hindi labels on shop-floor screens | G | C3 | U2 | N2 | 85 |
| [AP-096](#ap-096) | Print a paper job card with a QR fallback | G | C2 | U2 | N2 | 69 |
| [AP-097](#ap-097) | Warn about duplicate entries | G | C2 | U1 | N1 | 16 |
| [AP-098](#ap-098) | Close alerts automatically when their condition clears | G | C2 | U1 | N1 | 17 |
| [AP-099](#ap-099) | Paste screenshots and photos into attachments | G | C1 | U2 | N2 | 57 |
| [AP-100](#ap-100) | Give the owner a system health page | G | C2 | U2 | N1 | 46 |

### Delivery reading order

**U1:** [AP-038](#ap-038), [AP-087](#ap-087), [AP-089](#ap-089), [AP-004](#ap-004), [AP-005](#ap-005), [AP-026](#ap-026), [AP-031](#ap-031), [AP-037](#ap-037), [AP-042](#ap-042), [AP-056](#ap-056), [AP-058](#ap-058), [AP-066](#ap-066), [AP-071](#ap-071), [AP-072](#ap-072), [AP-080](#ap-080), [AP-097](#ap-097), [AP-098](#ap-098), [AP-002](#ap-002), [AP-007](#ap-007), [AP-011](#ap-011), [AP-012](#ap-012), [AP-013](#ap-013), [AP-014](#ap-014), [AP-016](#ap-016), [AP-018](#ap-018), [AP-027](#ap-027), [AP-028](#ap-028), [AP-030](#ap-030), [AP-032](#ap-032), [AP-045](#ap-045), [AP-046](#ap-046), [AP-047](#ap-047), [AP-051](#ap-051), [AP-059](#ap-059), [AP-062](#ap-062), [AP-081](#ap-081), [AP-083](#ap-083), [AP-084](#ap-084), [AP-085](#ap-085), [AP-001](#ap-001), [AP-006](#ap-006), [AP-024](#ap-024), [AP-041](#ap-041), [AP-063](#ap-063)

**U2:** [AP-078](#ap-078), [AP-100](#ap-100), [AP-033](#ap-033), [AP-053](#ap-053), [AP-054](#ap-054), [AP-077](#ap-077), [AP-082](#ap-082), [AP-029](#ap-029), [AP-094](#ap-094), [AP-061](#ap-061), [AP-086](#ap-086), [AP-090](#ap-090), [AP-099](#ap-099), [AP-003](#ap-003), [AP-015](#ap-015), [AP-019](#ap-019), [AP-025](#ap-025), [AP-039](#ap-039), [AP-040](#ap-040), [AP-057](#ap-057), [AP-064](#ap-064), [AP-079](#ap-079), [AP-091](#ap-091), [AP-092](#ap-092), [AP-096](#ap-096), [AP-017](#ap-017), [AP-020](#ap-020), [AP-035](#ap-035), [AP-036](#ap-036), [AP-043](#ap-043), [AP-044](#ap-044), [AP-050](#ap-050), [AP-052](#ap-052), [AP-060](#ap-060), [AP-065](#ap-065), [AP-069](#ap-069), [AP-073](#ap-073), [AP-074](#ap-074), [AP-075](#ap-075), [AP-076](#ap-076), [AP-095](#ap-095), [AP-008](#ap-008), [AP-009](#ap-009), [AP-010](#ap-010), [AP-034](#ap-034), [AP-048](#ap-048), [AP-055](#ap-055), [AP-067](#ap-067)

**U3:** [AP-088](#ap-088), [AP-022](#ap-022), [AP-023](#ap-023), [AP-093](#ap-093), [AP-021](#ap-021), [AP-049](#ap-049), [AP-068](#ap-068), [AP-070](#ap-070)

## A: Autopilot foundations

These five entries are prerequisites for most of the catalogue. Build them first.

<a id="ap-001"></a>

### AP-001 - Run scheduled work with a job ledger

**Rating:** C4 | U1 | N1. **Builds on:** SRC-AUTO, NOV-080 (automation workbench, still simulated).

**Today.** Nothing in the app runs unless a person opens a page. Reminders, expiries, reorder checks, and digests cannot happen on time.

**System does.** A Vercel Cron schedule calls one authenticated route per job type (nightly, hourly, 8 am). Each run writes a `system_job_runs` row: job key, window, started/finished, records examined, proposals created, errors. Jobs are idempotent per window, so a retried run does not double-create.

**User does.** Nothing day to day. The owner sees job health on AP-100.

**Build.** Job registry in `lib/jobs/`; cron secret verification; per-job advisory lock; run ledger table with RLS; replace the simulated "Run now" with a real run of the same registered job, clearly labelled.

**Guardrails.** Jobs only create proposals, alerts, and drafts unless a later entry explicitly approves a posting rule. A job that fails three windows in a row raises an owner alert.

**Done when.** Two overlapping invocations produce one run; a failing job is visible within one window; no job uses a browser-reachable key.

<a id="ap-002"></a>

### AP-002 - Show system proposals as accept/edit cards

**Rating:** C3 | U1 | N1. **Builds on:** NOV-094 (field source explanations), NOV-097 (consequence preview).

**Today.** Prefill exists in places, but it is silent: the employee cannot tell a learned default from a calculated value from a stale copy.

**System does.** One shared `Proposal` component and `proposals` table. A card shows the proposed value or record, "why" (inputs, rule, date), and Accept / Edit / Reject. Batches of similar proposals can be accepted together with a per-row exclusion.

**User does.** Taps Accept for the normal case; edits only exceptions.

**Build.** Proposal schema (type, target, payload, inputs snapshot, rule key, status, decided_by); server action that re-validates on accept; My Work section "Waiting for your confirmation".

**Guardrails.** Accepting re-runs the domain action with server checks; a proposal whose inputs changed is marked stale and must be regenerated.

**Done when.** Every proposal-producing entry in this catalogue uses this component; stale proposals cannot be accepted.

<a id="ap-003"></a>

### AP-003 - Track how often each proposal is accepted

**Rating:** C2 | U2 | N2. **Builds on:** AP-002.

**Today.** No feedback tells the team whether defaults help or get overridden.

**System does.** A weekly read model per proposal type: accepted, edited (with which field), rejected, ignored, median time to decide. Types with high edit rates are listed for review with the most common corrected value.

**User does.** Process owner reviews the list monthly and adjusts the rule.

**Build.** Aggregation view over `proposals`; page under Settings → Automation quality.

**Guardrails.** Shows counts by proposal type and role, not a league table of individuals.

**Done when.** A rule change can be compared before/after on acceptance rate and fields typed.

<a id="ap-004"></a>

### AP-004 - Use one factory calendar for all date calculations

**Rating:** C2 | U1 | N1. **Builds on:** SRC-WF factory-planning shift windows.

**Today.** Due dates, ageing, reminder timing, and capacity are counted in calendar days; Sundays, Diwali shutdown, and maintenance holidays are ignored.

**System does.** A calendar of working days, shifts, weekly off, holidays, and planned shutdowns. All due-date, ageing, turnaround, and capacity functions take working time from it.

**User does.** HR or the plant head enters the year's holidays once.

**Build.** `factory_calendar` table; `lib/calendar/working-time.ts` used by planning, turnaround, receivable ageing (where policy says working days), and delivery promises.

**Guardrails.** Receivable due dates follow agreed payment terms (calendar days) unless the business sets otherwise; label which basis each number uses.

**Done when.** A promise made before Diwali shutdown moves by the shutdown length; existing calendar-day reports are unchanged unless switched.

<a id="ap-005"></a>

### AP-005 - Number documents by financial year automatically

**Rating:** C2 | U1 | N1. **Builds on:** existing document numbering.

**Today.** Number formats differ by module and do not reset on 1 April, which accounts and GST returns expect for invoices.

**System does.** Configurable series per document type (e.g. `OMX/INV/26-27/0001`), resetting each Indian financial year, gap-free for tax documents, allocated inside the posting transaction.

**User does.** Accounts confirms the formats once.

**Build.** `document_series` table with per-FY counter row and row lock; migration that keeps existing numbers unchanged.

**Guardrails.** Cancelled invoices keep their number with cancelled status; numbers are never reused.

**Done when.** Concurrent invoice posting yields unique sequential numbers; 1 April rollover tested.

## B: Capture without typing

<a id="ap-006"></a>

### AP-006 - Import masters at go-live from Excel

**Rating:** C4 | U1 | N1. **Builds on:** EOS-23 (paste lines), EOS-59 (master cleanup).

**Today.** After the 9 November wipe, customers, profiles, dies, transporters, vendors, and machines would have to be typed one at a time.

**System does.** A guided import per master: download template, upload the existing Omalco Excel, map columns (remembering the mapping), preview with row-level errors (bad GSTIN, missing kg/m, duplicate code), import valid rows in one transaction, and export the rejected rows for fixing.

**User does.** Uploads the sheet, fixes flagged rows, confirms.

**Build.** Import engine in `lib/master-data/import/`; Zod row schemas reusing existing validations; import batch table for audit and undo-before-use.

**Guardrails.** Admin only; company derived from session; an import batch can be reversed only while no transaction references its rows.

**Done when.** 500 customers and 1,000 profiles import in under two minutes with an exact rejected-row report.

<a id="ap-007"></a>

### AP-007 - Record opening balances and lock the cut-over date

**Rating:** C3 | U1 | N1. **Builds on:** SRC-STOCK, SRC-FIN.

**Today.** No clean way to bring in opening stock by location/batch, open orders, outstanding invoices, and dies at vendors as of a go-live date.

**System does.** A cut-over checklist: opening stock (via AP-006 import), open receivables per invoice, open payables, open orders with balance quantities, dies in custody elsewhere. Each posts as an "opening" movement dated the cut-over date, then entries before that date are locked.

**User does.** Accounts and stores load and sign off each section.

**Build.** Opening movement types in existing ledgers; cut-over sign-off record; integration with AP-059 period lock.

**Guardrails.** Opening entries are visibly typed "opening" in every ledger and report; they cannot be edited after sign-off, only reversed with reason.

**Done when.** Stock and receivable totals on day one match the signed Excel totals exactly.

<a id="ap-008"></a>

### AP-008 - Paste a WhatsApp enquiry to get a draft quotation

**Rating:** C4 | U2 | N2. **Builds on:** SRC-AI quotation assistant, EOS-22 (customer codes and aliases).

**Today.** Sales reads "OM-4521 6.4 mtr 200 pcs RAL 9010, 2045 mill 100 pcs" on WhatsApp and re-types it line by line.

**System does.** Paste the message (or a forwarded chat export). The parser identifies the customer from the phone number or name, maps profile codes and shop-floor aliases, lengths in m/ft/mm, quantities in pcs or kg, finish and shade, and produces a draft quote with each line's confidence. Unknown codes are listed for mapping, and the mapping is remembered.

**User does.** Reviews the draft, fixes low-confidence lines, saves.

**Build.** Deterministic parser first (regex and alias table), AI provider as optional fallback; proposal via AP-002; original text stored on the quote.

**Guardrails.** Never sends anything back to the customer; pricing comes from the normal quote calculation, not the parser.

**Done when.** On 30 real Omalco enquiries, at least 80% of lines are correct without editing, and every wrong line was flagged low-confidence.

<a id="ap-009"></a>

### AP-009 - Turn a photo of a handwritten register into a draft

**Rating:** C4 | U2 | N2. **Builds on:** SRC-AI, EOS-98 (supplier document extraction).

**Today.** Shift supervisors keep paper press logs and later re-enter them, or the data never reaches the system.

**System does.** Photograph the shift sheet; extraction maps columns (die no., billets, pushes, output pcs, rejects, downtime) into draft production entries against that shift's jobs, highlighting low-confidence cells on the image.

**User does.** Corrects highlighted cells and confirms.

**Build.** Template-per-register configuration; vision extraction through provider seam; draft rows via AP-002.

**Guardrails.** Original image retained as evidence; drafts never post until confirmed; illegible cells remain blank.

**Done when.** A full shift sheet is captured in under three minutes against roughly fifteen today.

<a id="ap-010"></a>

### AP-010 - Read bundle weight directly from the packing scale

**Rating:** C4 | U2 | N2. **Builds on:** NOV-020 (equipment double entry), EOS-94 (bundle totals).

**Today.** Packers read the platform scale and type the weight, with transcription errors and rounding.

**System does.** On a workstation PC, the browser connects to the scale over Web Serial (USB/RS-232 indicator) and fills a stable reading into the bundle weight field with "from scale" marked. Weight is compared with theoretical (pieces × length × kg/m) and out-of-tolerance bundles are flagged.

**User does.** Places the bundle, taps Capture.

**Build.** Scale driver for the indicator's protocol; stability detection; source flag on the weight column.

**Guardrails.** Manual entry stays available and is labelled manual; tolerance comes from approved policy.

**Done when.** Captured weights match the indicator display; manual vs scale share is reportable.

<a id="ap-011"></a>

### AP-011 - Count billets with one tap at the press

**Rating:** C3 | U1 | N1. **Builds on:** `production/workstation`, EOS-89/90 billet calculations.

**Today.** Billets consumed and pushes are written at shift end from memory.

**System does.** The workstation shows the running job with a large "Billet loaded" button. Each tap records a timestamped push; the system derives billet count, billet kg (from billet batch and cut length), cycle time, and runtime.

**User does.** Taps once per billet; corrects with an undo within 30 seconds.

**Build.** `production_push_events` table; derived totals in the job read model; offline-tolerant tap queue (AP-094).

**Guardrails.** Push events are append-only with correction events; billet batch is taken from the job's issued billet lot.

**Done when.** Shift billet totals need no manual entry; cycle-time chart is available per die.

<a id="ap-012"></a>

### AP-012 - Pre-fill production output from the cut plan

**Rating:** C3 | U1 | N1. **Builds on:** SRC-WF cutting-workspace, EOS-93 (cutting requirements).

**Today.** The operator types good pieces, cut lengths, and bundles even though the cut plan already says what each push should yield.

**System does.** From pushes recorded (AP-011) and the job's cut plan, the system proposes expected good pieces per cut length and bundle split.

**User does.** Enters only rejects and shortfalls; accepts the rest.

**Build.** Expected-output function in `lib/calculations/`; proposal on the job's completion form.

**Guardrails.** Proposed quantity is labelled "expected"; confirmed output is what posts stock.

**Done when.** A normal job is closed with two entries or fewer (rejects, confirm).

<a id="ap-013"></a>

### AP-013 - Calculate engineering scrap automatically

**Rating:** C3 | U1 | N1. **Builds on:** SRC-WF production-scrap, EOS-92 (material discrepancy).

**Today.** Butt-end, front/back crop, and saw loss are estimated or typed, so recovery % is unreliable.

**System does.** Per push, computes butt weight (configured butt length × billet cross-section × density), standard crops, and cut-off remainder from the cut plan. The operator records only extra rejects. Recovery % is then actual output kg ÷ billet kg.

**User does.** Records process rejects with a reason code.

**Build.** Scrap-standard settings per press/die; derived scrap lines typed "engineering" vs "process".

**Guardrails.** Engineering scrap standards are owner-approved and versioned; actual scrap weighed at the scrap yard reconciles against derived scrap monthly.

**Done when.** Recovery % for every closed job is computed without manual scrap entry.

<a id="ap-014"></a>

### AP-014 - Detect an idle press and ask why

**Rating:** C3 | U1 | N1. **Builds on:** AP-011, SRC-WF machine-usage.

**Today.** Downtime is recorded only if someone remembers to log it.

**System does.** If a press with a running job has no push for longer than its configured gap, the workstation shows a reason picker (die change, billet shortage, power, breakdown, waiting QC, no operator). The downtime interval is derived from push timestamps.

**User does.** Taps one reason.

**Build.** Gap detection client-side plus nightly reconciliation job (AP-001) for gaps nobody answered.

**Guardrails.** Unanswered gaps appear as "unexplained", never auto-assigned a reason.

**Done when.** Daily downtime report covers at least 90% of idle time with a reason.

<a id="ap-015"></a>

### AP-015 - Record die changes from the job sequence

**Rating:** C2 | U2 | N2. **Builds on:** EOS-31 (press scheduling), NOV-025 (die history).

**Today.** Die change events and times are not logged separately.

**System does.** When a press starts a job whose die differs from the last job, a die change event is recorded with duration from last push of the old die to first push of the new one.

**User does.** Nothing; may add a note.

**Build.** Trigger or server action on job start; die change read model for SMED analysis.

**Guardrails.** Derived event, editable only through correction.

**Done when.** Die change count and average duration per press per week appear without entry.

<a id="ap-016"></a>

### AP-016 - Trigger quality sampling from output quantity

**Rating:** C3 | U1 | N1. **Builds on:** EOS-54 (inspection plans), SRC-WF inspection-plans.

**Today.** QC decides when to check based on rounds; first-piece and periodic checks are missed on busy shifts.

**System does.** The inspection plan defines triggers (first piece after die change, every N pushes or bundles, last piece). When output crosses a trigger, a QC task with the right characteristics is created and shown on the QC phone queue.

**User does.** QC records readings in the generated task.

**Build.** Trigger evaluation on push and bundle events; task creation via existing task-triggers.

**Guardrails.** A missed sample is shown on the job and blocks QC release if policy says so.

**Done when.** Sampling compliance per job is reported automatically.

<a id="ap-017"></a>

### AP-017 - Print bundle labels when a bundle is confirmed

**Rating:** C3 | U2 | N2. **Builds on:** NOV-079 (packing labels), existing QR codes.

**Today.** Someone opens the bundle and clicks print each time.

**System does.** Confirming a bundle adds its label (QR, profile, length, pieces, weight, customer mark) to the packing station's print queue. A station page set to auto-print sends labels to the local label printer.

**User does.** Sticks the label.

**Build.** Per-station print queue; label template from NOV-079; reprint with reason.

**Guardrails.** Reprints are logged; customer label shows only permitted fields.

**Done when.** Labels print within five seconds of confirmation; no unlabelled bundles in a weekly audit.

<a id="ap-018"></a>

### AP-018 - Verify truck loading by scanning bundles

**Rating:** C3 | U1 | N1. **Builds on:** `mobile/dispatch/bundles`, EOS-30 (vehicle loading).

**Today.** Loading is checked against a paper list; wrong or missing bundles are found at the customer.

**System does.** The loader scans each bundle into the vehicle. The screen shows planned vs loaded per order line with live pieces and kg, warns on a bundle not in the plan, a held bundle, or another customer's bundle, and completes the dispatch lines from scans.

**User does.** Scans; resolves warnings.

**Build.** Loading session against the dispatch; scan validation server action; dispatch lines derived from the session.

**Guardrails.** A bundle cannot be loaded twice; QC-held bundles are blocked.

**Done when.** Dispatch lines need no typing when all bundles are labelled.

<a id="ap-019"></a>

### AP-019 - Derive gate-out from the dispatch

**Rating:** C2 | U2 | N2. **Builds on:** NOV-077 (returnable gate passes).

**Today.** Security keeps a separate gate register of vehicle, LR, and time.

**System does.** The gate screen lists loaded dispatches awaiting exit. Security taps "Vehicle out", which records time and checks the vehicle number; the gate register is a report.

**User does.** Security taps once per vehicle.

**Build.** Gate-out action on dispatch; gate register report.

**Guardrails.** Exit without completed e-way bill (when required) shows a warning, per policy.

**Done when.** The paper gate register can be retired for outbound dispatches.

<a id="ap-020"></a>

### AP-020 - Read billet mill test certificates on receipt

**Rating:** C3 | U2 | N2. **Builds on:** NOV-069 (incoming acceptance), SRC-AI, [alloy-composition.ts](lib/calculations/alloy-composition.ts).

**Today.** Billet chemistry from the supplier's certificate is not captured, or typed by hand.

**System does.** Upload the PDF/photo; extracted heat number, alloy, and Si/Fe/Cu/Mn/Mg/Zn/Ti values are checked against the alloy spec and attached to the billet batch.

**User does.** Confirms the extracted values; out-of-spec rows route to quality.

**Build.** Extraction template per supplier; spec check in calculations library.

**Guardrails.** Certificate retained; extraction never marks a batch accepted by itself.

**Done when.** Every billet batch has chemistry traceable to a certificate.

<a id="ap-021"></a>

### AP-021 - Allocate energy from shift meter readings

**Rating:** C3 | U3 | N2. **Builds on:** `app/(dashboard)/energy`, EOS-99 (machine energy cost).

**Today.** Energy cost per kg is an estimate.

**System does.** The shift-open/close routine asks for each press's meter reading (or reads it from AP-010-style device input later). kWh is allocated to jobs by runtime from AP-011, giving kWh/kg per job and die.

**User does.** Types two readings per press per shift.

**Build.** Meter reading in shift routine; allocation function; energy per kg report.

**Guardrails.** Missing readings leave allocation blank, not zero.

**Done when.** Monthly kWh/kg per press is reported from actual readings.

<a id="ap-022"></a>

### AP-022 - Derive crew from workstation sign-ins

**Rating:** C2 | U3 | N2. **Builds on:** `production/workstation`, competencies.

**Today.** Who worked which press is written separately for productivity and incentive.

**System does.** Operators sign in to a press station (PIN or badge scan). The crew per shift and job is derived and checked against competencies.

**User does.** Signs in at start of shift.

**Build.** Station session table; crew read model.

**Guardrails.** Not a payroll attendance system; label it as press assignment.

**Done when.** Output per crew per shift is available without a separate register.

<a id="ap-023"></a>

### AP-023 - Dictate exception reasons on the phone

**Rating:** C2 | U3 | N2. **Builds on:** EOS-33 (structured exception capture), NOV-018 (mobile workflows).

**Today.** Typing a delay or NCR description on a phone with gloves is slow, so descriptions are empty.

**System does.** A microphone button on description fields uses the browser's speech recognition (Hindi or English) to fill text, keeps the structured reason code required, and stores the text only.

**User does.** Speaks, checks the text, saves.

**Build.** Shared voice-input field wrapper; feature-detect and hide when unsupported.

**Guardrails.** Audio is not uploaded by the app; label that the browser's speech service may process audio.

**Done when.** Average description length on mobile exceptions increases without longer completion time.

<a id="ap-024"></a>

### AP-024 - Import bank statements and match receipts

**Rating:** C4 | U1 | N1. **Builds on:** SRC-FIN, NOV-040 (collection workflow).

**Today.** Accounts reads the bank statement and creates each receipt manually, guessing which customer an NEFT belongs to.

**System does.** Upload the bank CSV/Excel. Each credit is matched by amount, UTR, remitter name, and customer's known account to a customer and open invoices. Proposals: exact match, likely match, unknown. Accepting creates the receipt and allocation (AP-058).

**User does.** Confirms matches; assigns unknowns once (the remitter name is learned).

**Build.** Bank format profiles; statement line table with dedupe on UTR/date/amount; matching function.

**Guardrails.** A statement line can create at most one receipt; reversals require reason.

**Done when.** At least 80% of a month's credits match without manual search.

<a id="ap-025"></a>

### AP-025 - Use a USB barcode scanner in any field

**Rating:** C2 | U2 | N2. **Builds on:** `app/(dashboard)/scan`, EOS QR codes.

**Today.** Scanning works on the dedicated scan page and phone camera; stores and dispatch PCs with USB scanners cannot use it in normal forms.

**System does.** A global listener recognises fast keyboard-wedge input with the QR prefix and either opens the record, or fills the focused lookup field (bundle, die, billet lot).

**User does.** Scans.

**Build.** Shared hook; QR payload resolver already used by scan page.

**Guardrails.** Resolution goes through the authorised lookup; unknown codes show a clear message.

**Done when.** A bundle selector can be filled by scanning on a desktop.

## C: Derived values and smart defaults

<a id="ap-026"></a>

### AP-026 - Learn each customer's usual choices

**Rating:** C2 | U1 | N1. **Builds on:** NOV-008 (visible defaults), EOS-9 (Repeat Previous).

**Today.** Finish, packing, transporter, freight terms, payment terms, and delivery address are re-selected on every quote and order.

**System does.** From the customer's last orders, propose the most common value per field with "used in 4 of last 5 orders". Fields with no clear pattern stay empty.

**User does.** Leaves the default or changes it.

**Build.** Preference read model per customer; proposal hint on quote/order forms.

**Guardrails.** Agreed master values (payment terms on the customer record) beat learned ones; learned values never override a signed contract term.

**Done when.** Fields typed per new order for repeat customers drops measurably.

<a id="ap-027"></a>

### AP-027 - Detect section-weight drift from bundle weights

**Rating:** C3 | U1 | N1. **Builds on:** AP-010, EOS-83 (theoretical weight), NOV-025 (die history).

**Today.** Actual kg/m vs the profile master's theoretical value is not compared, so die wear and wrong billing weights go unnoticed.

**System does.** Each weighed bundle gives an actual kg/m. A rolling average per die is compared with the master; drift beyond tolerance raises a proposal: inspect die, or update the master/selling weight.

**User does.** Die shop or QC decides.

**Build.** Drift calculation in `lib/calculations/`; nightly job (AP-001).

**Guardrails.** Master weight changes go through the normal profile edit with history; issued quotes keep their snapshot.

**Done when.** Each active die shows actual vs theoretical kg/m trend.

<a id="ap-028"></a>

### AP-028 - Predict die nitriding and correction due

**Rating:** C3 | U1 | N1. **Builds on:** AP-011, NOV-025, `app/(dashboard)/dies`.

**Today.** Nitriding is triggered when the operator notices surface problems.

**System does.** Push count and kg since last nitriding are derived per die. When a die reaches its configured interval, a maintenance proposal is created, and planners see "due in ~N pushes" on die selection.

**User does.** Die shop accepts and schedules.

**Build.** Die counters from push events; interval settings per die family.

**Guardrails.** Intervals are die-shop policy; prediction is advisory.

**Done when.** No die exceeds its interval without a visible flag.

<a id="ap-029"></a>

### AP-029 - Recommend billet length per job for best recovery

**Rating:** C4 | U2 | N1. **Builds on:** [billet-estimate.ts](lib/calculations/billet-estimate.ts), EOS-89/90.

**Today.** A standard billet length is used regardless of the order's cut lengths, producing avoidable end scrap.

**System does.** Given die (kg/m, extrusion ratio), puller length, butt, crops, and the job's cut lengths, compute the billet length (within the log saw's range) that maximises pieces per push and shows recovery % for each option.

**User does.** Planner picks the recommended length or another listed option.

**Build.** Optimiser in calculations library with unit tests on real Omalco dies; shown on job planning.

**Guardrails.** Respect min/max billet length and container limits from press master.

**Done when.** Planned recovery improves on a sample of 20 jobs versus standard length.

<a id="ap-030"></a>

### AP-030 - Reprice open drafts from one daily metal-rate update

**Rating:** C3 | U1 | N1. **Builds on:** SRC-WF costing-rates, [quote.ts](lib/calculations/quote.ts).

**Today.** When the aluminium rate moves, sales recalculates draft quotes one by one, or forgets.

**System does.** Commercial enters today's ingot/billet basis once. Draft and unsent quotes recalculate, showing old vs new rate per kg and total. Sent quotes within validity are listed as "rate moved since sent" without changing them.

**User does.** Reviews the impact list.

**Build.** Dated rate entry (existing costing rates); recalc job; impact view.

**Guardrails.** Issued quote snapshots never change; only drafts reprice.

**Done when.** A rate change updates all drafts in one action with a printable impact list.

<a id="ap-031"></a>

### AP-031 - Expire stale quotations and offer a requote

**Rating:** C2 | U1 | N1. **Builds on:** quote status workflow, AP-001.

**Today.** Expired quotes stay "sent" and can be converted at an old rate.

**System does.** At validity end, the nightly job marks quotes expired. Conversion of an expired quote asks for a requote at today's rate with one click that copies lines into a new revision.

**User does.** Requotes or extends validity with reason (approval if configured).

**Build.** Expiry job; conversion guard; requote action.

**Guardrails.** Expiry is a status change with history, not deletion.

**Done when.** No order is created from an expired quote without explicit approval.

<a id="ap-032"></a>

### AP-032 - Hold orders automatically on credit limits

**Rating:** C3 | U1 | N1. **Builds on:** [receivables.ts](lib/financials/receivables.ts), exception requests.

**Today.** Credit checks depend on accounts being asked.

**System does.** At order confirmation and again at dispatch, compute exposure (outstanding + unbilled dispatches + this order) vs limit and overdue beyond grace. Over-limit orders confirm into "credit hold" with an approval request to the authorised role.

**User does.** Sales sees why; accounts/owner approves or not.

**Build.** Credit check function; hold state; exception policy routing.

**Guardrails.** Recheck at dispatch to catch payments missed since confirmation.

**Done when.** No dispatch leaves for an over-limit customer without a recorded approval.

<a id="ap-033"></a>

### AP-033 - Compute reorder points from actual consumption

**Rating:** C3 | U2 | N1. **Builds on:** NOV-022 (shortage purchasing plan), SRC-STOCK.

**Today.** Min levels for billets, packing material, powder, chemicals, and spares are guessed or absent.

**System does.** From 90-day consumption and supplier lead time, compute suggested min/reorder quantity per item. When stock falls below, a purchase requisition proposal is created.

**User does.** Stores approves the levels once; purchase accepts requisitions.

**Build.** Consumption read model; nightly job; requisition proposals.

**Guardrails.** Suggested levels require approval before they trigger requisitions.

**Done when.** Each active consumable has an approved reorder point.

<a id="ap-034"></a>

### AP-034 - Propose reservations when stock arrives

**Rating:** C4 | U2 | N2. **Builds on:** [reservation-ledger.ts](lib/inventory/reservation-ledger.ts).

**Today.** Finished stock arriving from production or finishing is reserved manually to waiting orders.

**System does.** On receipt into stock, propose reservations to open order lines needing that profile/finish/length, ordered by promise date and priority policy (NOV-043).

**User does.** Stores or coordinator accepts.

**Build.** Matching function; proposals using reservation ledger.

**Guardrails.** Respect quality hold; accept rechecks available quantity under lock.

**Done when.** Arriving stock for a waiting order is reserved within one confirmation.

<a id="ap-035"></a>

### AP-035 - Calculate bundle packing from profile and customer spec

**Rating:** C3 | U2 | N2. **Builds on:** NOV-079, EOS-94.

**Today.** Pieces per bundle and packing material are decided at the packing table.

**System does.** From profile dimensions/weight, customer packing spec (max bundle kg, wrapping, interleaving paper, wooden batten), propose bundles per order line and packing material required.

**User does.** Packers follow it; deviations recorded.

**Build.** Packing calculation in calculations library; shown on packing task and in material requirement.

**Guardrails.** Customer spec is versioned on the customer record.

**Done when.** Packing material consumption can be compared with standard.

<a id="ap-036"></a>

### AP-036 - Estimate freight from a transporter rate card

**Rating:** C3 | U2 | N2. **Builds on:** existing freight fields on quotes and dispatches.

**Today.** Freight is quoted from memory or a phone call.

**System does.** Rate cards per transporter (per kg or per vehicle type by destination). Quote and dispatch screens propose freight from weight and destination and suggest the cheapest suitable vehicle.

**User does.** Accepts or overrides with a reason.

**Build.** Rate card table; estimate function; proposal fields.

**Guardrails.** Supplier freight rates are internal; never shown on customer documents.

**Done when.** Estimated vs billed freight variance is reported per transporter.

<a id="ap-037"></a>

### AP-037 - Derive place of supply and GST type from GSTIN

**Rating:** C2 | U1 | N1. **Builds on:** [gst.ts](lib/calculations/gst.ts).

**Today.** CGST/SGST vs IGST depends on the user choosing the state correctly.

**System does.** State code is taken from the first two digits of the billing or shipping GSTIN (per configured place-of-supply rule) and compared with Omalco's state; tax type follows. HSN defaults by item type (profiles, scrap) from the item master.

**User does.** Nothing unless overriding with reason.

**Build.** State code table; derivation in gst.ts; override audit.

**Guardrails.** Rules configured and confirmed by accounts; snapshot on the invoice.

**Done when.** Wrong tax-type invoices in a sample are zero.

<a id="ap-038"></a>

### AP-038 - Validate GSTIN and fill state automatically

**Rating:** C1 | U1 | N1. **Builds on:** customer and vendor forms.

**Today.** GSTINs are typed without checking; wrong digits reach invoices.

**System does.** Validate format and check digit on entry, extract state and PAN, and fill the state field.

**User does.** Types or pastes the GSTIN.

**Build.** Validator in `lib/validations/`; used in Zod schemas.

**Guardrails.** Validity of format is not proof of active registration; label it.

**Done when.** Invalid GSTINs cannot be saved without an explicit "unregistered" choice.

<a id="ap-039"></a>

### AP-039 - Fill city and state from PIN code

**Rating:** C2 | U2 | N2. **Builds on:** address fields across customers, sites, vendors.

**Today.** City, district, and state are typed and misspelt.

**System does.** Six-digit PIN fills district and state from a bundled offline dataset; city remains editable.

**User does.** Types the PIN.

**Build.** Static JSON asset, lazily loaded; shared address input.

**Guardrails.** No external lookup call with customer data.

**Done when.** New addresses have consistent state names.

<a id="ap-040"></a>

### AP-040 - Accept lengths in any unit

**Rating:** C2 | U2 | N2. **Builds on:** [length-units.ts](lib/calculations/length-units.ts).

**Today.** Customers order in feet, metres, and millimetres; staff convert by hand.

**System does.** Length fields accept "21ft", "6.4m", "6400", "12' 6\"" and show the converted mm value beside the input before saving.

**User does.** Types what the customer said.

**Build.** Parser in length-units.ts; shared length input.

**Guardrails.** Stored in mm; original text kept on the line for audit.

**Done when.** No separate conversion step in quotation entry.

## D: Module re-engineering

<a id="ap-041"></a>

### AP-041 - Fold the /tasks pilot hubs into their home modules

**Rating:** C4 | U1 | N1. **Builds on:** SRC-HUBS (NOV batches 3-10).

**Today.** Eight hubs under `/tasks/*` each hold their own record types (assurance, coordination, lifecycle, improvement, execution, commercial, specialist, control). An employee working an order must visit several hubs to see everything about it.

**System does.** Each pilot record type is attached to its home record (order, job, die, dispatch, invoice, vendor) and appears as a panel on that record's detail page and as items in My Work. The hubs remain as cross-record reports, not entry points.

**User does.** Works from the order, job, or dispatch they already have open.

**Build.** Inventory every hub record type and its home record; shared "related work" panel; route redirects from hub `new` pages to the home record's action; navigation update (AP-042).

**Guardrails.** No data migration of hub tables is needed; only presentation and entry points move. Permissions continue to come from existing policies.

**Done when.** No daily task requires visiting a `/tasks/*` hub; hub pages are read-only reports.

<a id="ap-042"></a>

### AP-042 - Slim the navigation using real usage

**Rating:** C2 | U1 | N1. **Builds on:** [task-navigation.ts](lib/navigation/task-navigation.ts), NOV-002.

**Today.** The sidebar lists about 45 modules; most roles use fewer than ten.

**System does.** Record route visits per role (counts, not content). After two weeks, propose a role navigation of the seven to nine most used destinations, with the rest under "More".

**User does.** Admin approves the role navigation.

**Build.** Lightweight visit counter; role navigation config; "More" menu.

**Guardrails.** Hiding a link does not change permissions; search still finds everything authorised.

**Done when.** Each role's main navigation has nine items or fewer.

<a id="ap-043"></a>

### AP-043 - Merge Dies and Die Intelligence

**Rating:** C3 | U2 | N2. **Builds on:** `app/(dashboard)/dies`, `app/(dashboard)/die-intelligence`.

**Today.** Die records and die analytics live in two modules.

**System does.** One die module: overview (attention list: due nitriding, at vendor, poor recovery, drift), database, die detail with history, counters, performance, and custody.

**User does.** Uses one place.

**Build.** Move die-intelligence widgets into die overview/detail; redirect old route.

**Guardrails.** Keep existing queries and RLS; no table changes.

**Done when.** The die-intelligence route redirects and no information is lost.

<a id="ap-044"></a>

### AP-044 - Combine reporting into one Insights module

**Rating:** C3 | U2 | N2. **Builds on:** `reports`, `report-builder`, `analytics`, `command-center`, `profitability`.

**Today.** Five reporting entry points with overlapping numbers that can disagree.

**System does.** One Insights module with a shared metric catalogue (each KPI defined once in `lib/`), saved views, and the existing builder for custom reports.

**User does.** Opens Insights.

**Build.** Metric registry; migrate dashboards to registry metrics; redirects.

**Guardrails.** Role-based visibility of financial metrics preserved.

**Done when.** A KPI such as recovery % has one definition used everywhere.

<a id="ap-045"></a>

### AP-045 - Create draft production jobs when an order is confirmed

**Rating:** C3 | U1 | N1. **Builds on:** EOS-88 (stock vs production), SRC-WF stock-production.

**Today.** Planning reads confirmed orders and creates jobs by hand.

**System does.** On confirmation, quantities needing production are grouped by die, alloy, and temper into draft jobs (merging with existing open drafts for the same die), with required kg and due dates.

**User does.** Planner reviews drafts in the plan and releases them.

**Build.** Grouping function; draft job state; link order lines to jobs.

**Guardrails.** Drafts do not reserve billets or capacity until released.

**Done when.** No production job is typed from scratch for a normal order.

<a id="ap-046"></a>

### AP-046 - Draft invoices automatically at gate-out

**Rating:** C3 | U1 | N1. **Builds on:** EOS-96 (invoices from dispatches), [invoice-sources.ts](lib/financials/invoice-sources.ts), AP-019.

**Today.** Accounts creates an invoice from each dispatch when they get to it, so some dispatches go unbilled for days.

**System does.** When a dispatch is marked loaded/gate-out, a draft invoice is created from the dispatch, order prices, GST derivation, and freight terms. Accounts sees "Drafts to post" with totals.

**User does.** Reviews and posts in a batch.

**Build.** Draft creation on gate-out; batch post action; unbilled-dispatch report.

**Guardrails.** Posting allocates the tax number (AP-005) only at post; drafts carry no number.

**Done when.** Unbilled dispatches older than one working day are zero or explained.

<a id="ap-047"></a>

### AP-047 - Change stock only through movements

**Rating:** C3 | U1 | N1. **Builds on:** SRC-STOCK, NOV-030 (cycle counting).

**Today.** Some inventory screens allow editing a quantity field directly, which breaks traceability.

**System does.** Quantities become read-only everywhere; every change is a typed movement (receipt, issue, transfer, adjustment with reason and approval). Every stock number links to its movements.

**User does.** Uses "Adjust" with reason when needed.

**Build.** Remove direct quantity edits; adjustment movement with approval threshold; drill-down links.

**Guardrails.** Database constraint or trigger prevents quantity updates outside the movement function.

**Done when.** Any balance can be rebuilt exactly from movements.

<a id="ap-048"></a>

### AP-048 - Calculate kg/m and perimeter from a die drawing

**Rating:** C4 | U2 | N2. **Builds on:** `app/(dashboard)/profiles`, EOS-82/84.

**Today.** Section weight and coated perimeter are typed from the die maker's sheet.

**System does.** Upload the profile DXF. Closed outlines are read; area (outer minus voids) × alloy density gives theoretical kg/m; outer perimeter gives finishing area per metre. Values are proposed to the profile master with a preview image.

**User does.** Confirms or corrects.

**Build.** DXF parser (small dependency or in-house for LWPOLYLINE/ARC); geometry in calculations library.

**Guardrails.** Drawing stored in company storage; proposal only; density per alloy from master.

**Done when.** Computed kg/m is within 1% of the die maker's figure on ten test profiles.

<a id="ap-049"></a>

### AP-049 - Suggest equivalent profiles available in stock

**Rating:** C3 | U3 | N2. **Builds on:** profile master, SRC-STOCK.

**Today.** A customer's urgent need for one profile can sometimes be met by an equivalent in stock, but nobody knows which.

**System does.** Profiles marked as approved equivalents (same section, different code; or customer-approved alternatives) are suggested when the requested one is short.

**User does.** Sales offers the alternative to the customer.

**Build.** Equivalence table; suggestion on order line shortage.

**Guardrails.** Equivalence is approved by technical; customer consent recorded before substitution.

**Done when.** Shortages show available approved equivalents.

<a id="ap-050"></a>

### AP-050 - Score customer health

**Rating:** C3 | U2 | N2. **Builds on:** CRM, receivables, quality complaints.

**Today.** A customer drifting away is noticed late.

**System does.** Monthly score per customer from order frequency vs their normal, volume trend, payment delay trend, complaint count, and quote win rate; "at risk" list for sales with the reason.

**User does.** Sales follows up.

**Build.** Read model; nightly job; CRM panel.

**Guardrails.** Internal only; explain each component.

**Done when.** Sales sees the top ten at-risk customers each Monday with reasons.

<a id="ap-051"></a>

### AP-051 - Generate the ready-to-ship list

**Rating:** C3 | U1 | N1. **Builds on:** NOV-036 (vehicle load planning), order-line schedule.

**Today.** Dispatch asks production and stores what is ready.

**System does.** A computed list of order lines with packed, QC-released quantity, grouped by customer and destination, with due date, weight, and credit status (AP-032).

**User does.** Dispatch plans vehicles from the list.

**Build.** Read model over bundles, QC status, reservations.

**Guardrails.** Credit-held customers are shown but marked.

**Done when.** Dispatch planning starts from the list, not phone calls.

<a id="ap-052"></a>

### AP-052 - Chart quality readings and alarm on drift

**Rating:** C3 | U2 | N2. **Builds on:** inspection plans, quality readings.

**Today.** Hardness, wall thickness, and coating thickness readings are stored but not trended.

**System does.** Control charts per characteristic per die/finish line with limits from the plan; rules (point outside limits, run of seven on one side) raise an alert before rejects start.

**User does.** QC reviews the alarm.

**Build.** SPC calculations in `lib/calculations/`; chart on quality overview and die detail.

**Guardrails.** Limits come from approved plans.

**Done when.** Each active characteristic has a chart and alarms appear on QC's queue.

<a id="ap-053"></a>

### AP-053 - Raise NCRs automatically from rejections

**Rating:** C3 | U2 | N1. **Builds on:** quality module, NOV-053.

**Today.** NCRs are opened only when someone decides to.

**System does.** When rejects on a job or receipt exceed a threshold, or a customer complaint is logged, a draft NCR is created with linked job, die, billet lot, and readings.

**User does.** QC confirms and completes cause and action.

**Build.** Threshold settings; draft NCR proposal.

**Guardrails.** Threshold set by QC head.

**Done when.** Rejects above threshold always have an NCR or a recorded dismissal.

<a id="ap-054"></a>

### AP-054 - Schedule preventive maintenance from running hours

**Rating:** C3 | U2 | N1. **Builds on:** `maintenance`, AP-011, NOV-026.

**Today.** Preventive maintenance is calendar-based or forgotten.

**System does.** Running hours and push counts per press, puller, and saw are derived from production events; tasks (filter change, container inspection) are proposed when due, inside planned maintenance windows.

**User does.** Maintenance accepts and records completion.

**Build.** Counters per asset; PM plan table; proposals; capacity block (NOV-026).

**Guardrails.** Safety-critical tasks cannot be dismissed without supervisor approval.

**Done when.** PM compliance is reported per asset.

<a id="ap-055"></a>

### AP-055 - Batch powder coating by shade

**Rating:** C4 | U2 | N2. **Builds on:** finishing workflow, NOV-073.

**Today.** Colour changes on the coating line are frequent and each costs powder and time.

**System does.** Material waiting for coating is grouped by RAL shade and powder brand, with due dates, into proposed runs that minimise changes while meeting promises.

**User does.** Finishing supervisor confirms the run order.

**Build.** Grouping and sequencing function; finishing queue view.

**Guardrails.** Due-date breaches from batching are shown before confirmation.

**Done when.** Shade changes per shift fall without late orders.

<a id="ap-056"></a>

### AP-056 - Generate a chase list for finishing vendors

**Rating:** C2 | U1 | N1. **Builds on:** NOV-031 (vendor material account), NOV-039.

**Today.** Material at anodizing or coating vendors is chased by memory.

**System does.** Daily list of material at each vendor beyond expected turnaround, with quantities, order due dates, and a prepared WhatsApp message per vendor.

**User does.** Copies the message, records the vendor's promised date.

**Build.** Read model on vendor custody; message template.

**Guardrails.** Prepared text is not marked sent.

**Done when.** No vendor-held material is overdue without a recorded follow-up.

<a id="ap-057"></a>

### AP-057 - Show last price and variance on purchase entry

**Rating:** C2 | U2 | N2. **Builds on:** purchase lifecycle, EOS-55.

**Today.** Purchase rates are entered without reference to the last price.

**System does.** On each PO line, show the last three prices from this and other suppliers with dates; flag a variance above threshold.

**User does.** Justifies higher prices when flagged.

**Build.** Price history query; variance flag.

**Guardrails.** Visible only to purchase and management roles.

**Done when.** High-variance POs carry a reason.

<a id="ap-058"></a>

### AP-058 - Allocate receipts to the oldest invoices

**Rating:** C2 | U1 | N1. **Builds on:** EOS-97 (receivables from receipts).

**Today.** Each receipt is allocated to invoices manually.

**System does.** Propose allocation oldest-first (or by remittance reference if the bank narration names invoices), with any balance as on-account.

**User does.** Accepts or adjusts.

**Build.** Allocation function; proposal on receipt form and in AP-024.

**Guardrails.** Allocation changes are audited.

**Done when.** Most receipts are allocated with one confirmation.

<a id="ap-059"></a>

### AP-059 - Lock periods and control back-dated entries

**Rating:** C3 | U1 | N1. **Builds on:** AP-007.

**Today.** Entries can be dated into a closed month, changing reported figures.

**System does.** Accounts closes a month; posting into a closed period requires a reopen request with reason and approval. Back-dating more than N days in an open period is flagged.

**User does.** Accounts closes months; others request exceptions.

**Build.** Period table; database check in posting functions.

**Guardrails.** Enforced server-side and in database functions, not only the UI.

**Done when.** No posting lands in a closed period without an approved reopen.

<a id="ap-060"></a>

### AP-060 - Share a safe order-status link

**Rating:** C3 | U2 | N2. **Builds on:** EOS-52 (self-service), portal routes.

**Today.** Customers phone to ask where their order is.

**System does.** Each order can produce a signed, expiring link showing order lines, produced/packed/dispatched quantities, vehicle, LR number, and expected date. Shareable on WhatsApp.

**User does.** Taps "Share status".

**Build.** Token table with expiry and revoke; public read route returning a safe projection.

**Guardrails.** No prices, cost, internal notes, or other orders; tokens are random and revocable.

**Done when.** Status calls from customers drop for pilot customers.

## E: Planning autopilot

<a id="ap-061"></a>

### AP-061 - Draft tomorrow's press plan overnight

**Rating:** C5 | U2 | N1. **Builds on:** NOV-023 (compatible runs), NOV-024 (what-if), SRC-WF factory-planning, AP-045.

**Today.** The planner builds each day's plan by hand from scratch.

**System does.** A nightly job builds a draft plan for the next one or two shifts from released jobs: die availability, billet availability, alloy/temper grouping, promise dates, press capacity, maintenance windows. The planner sees the draft with reasons and any lines it could not schedule.

**User does.** Adjusts and publishes.

**Build.** Heuristic scheduler in `lib/workflow/` reusing factory-planning checks; draft plan state; diff against published plan.

**Guardrails.** Draft only; existing plan validation must pass before publish.

**Done when.** The planner publishes with fewer than five edits on a typical day.

<a id="ap-062"></a>

### AP-062 - Calculate seven-day billet requirement from the plan

**Rating:** C3 | U1 | N1. **Builds on:** EOS-89, foundry, purchase lifecycle.

**Today.** Billet needs are estimated by the foundry and purchase separately.

**System does.** From planned and draft jobs, compute billet kg and count by alloy and diameter per day for seven days, against billet stock and incoming POs/casts; shortfalls become foundry or purchase proposals.

**User does.** Foundry and purchase accept.

**Build.** Requirement read model; proposals.

**Guardrails.** Draft jobs are labelled as uncertain demand.

**Done when.** Billet shortages are visible at least three days ahead.

<a id="ap-063"></a>

### AP-063 - Predict late order lines every morning

**Rating:** C4 | U1 | N1. **Builds on:** NOV-021 (feasibility), order-line schedule, AP-004.

**Today.** Lateness is discovered on or after the due date.

**System does.** For every open line, estimate completion from remaining stages (job planned? produced? finishing? packed?) using typical stage durations and the plan. Lines likely to miss promise are listed with the blocking stage.

**User does.** Coordinator acts on the red list.

**Build.** Stage duration statistics; prediction function; nightly job; My Work section.

**Guardrails.** Show the basis; prediction is advisory.

**Done when.** At least 80% of late lines were on the red list two days before due.

<a id="ap-064"></a>

### AP-064 - Draft customer delay notices

**Rating:** C2 | U2 | N2. **Builds on:** AP-063, transaction communication.

**Today.** Customers learn of delays when they chase.

**System does.** When a line turns red, a message is drafted with the new expected date and status.

**User does.** Sales edits and sends (copy or provider), recording that it was sent.

**Build.** Template; proposal on the order.

**Guardrails.** Never sent automatically.

**Done when.** Late lines have a recorded customer communication.

<a id="ap-065"></a>

### AP-065 - Project die availability into the plan

**Rating:** C3 | U2 | N2. **Builds on:** die custody, AP-028.

**Today.** Planners schedule a die that is at nitriding or correction.

**System does.** Dies at vendors or in correction carry an expected return date; the plan shows them unavailable until then and warns if a job's due date depends on the return.

**User does.** Die shop maintains expected return dates.

**Build.** Availability windows per die; planning check.

**Guardrails.** Overdue returns are highlighted, not assumed back.

**Done when.** No job is scheduled on an unavailable die without a warning.

<a id="ap-066"></a>

### AP-066 - Set shift targets from the plan and show achievement

**Rating:** C2 | U1 | N1. **Builds on:** workstation, AP-011.

**Today.** Targets are spoken at shift start; achievement is known at shift end.

**System does.** Each press's target (kg, pushes) is derived from the published plan; the workstation and supervisor screen show live achievement from push events.

**User does.** Watches.

**Build.** Target derivation; live counter on workstation.

**Guardrails.** Targets reflect planned die changes and maintenance.

**Done when.** Supervisors see plan vs actual per press during the shift.

<a id="ap-067"></a>

### AP-067 - Combine cut lengths across orders of one profile

**Rating:** C4 | U2 | N2. **Builds on:** cutting workspace, AP-029.

**Today.** Each order's cut lengths are planned separately even when several orders use the same die.

**System does.** For jobs of the same die, combine cut lengths from multiple orders into one push pattern that maximises recovery, then split output back to orders.

**User does.** Planner accepts the combined pattern.

**Build.** One-dimensional cutting optimiser; output allocation to orders.

**Guardrails.** Order quantities and lengths are never changed; allocation is traceable.

**Done when.** Combined jobs show higher planned recovery than separate ones.

<a id="ap-068"></a>

### AP-068 - Suggest make-to-stock runs for idle capacity

**Rating:** C3 | U3 | N2. **Builds on:** capacity page, sales history.

**Today.** Idle press time is lost or filled ad hoc.

**System does.** When capacity is free, propose fast-moving profiles (by 90-day demand) below their target stock.

**User does.** Owner or planner approves.

**Build.** Fast-mover read model; suggestion on capacity page.

**Guardrails.** Respect billet availability and stock holding limits.

**Done when.** Idle hours are reported with suggestions.

<a id="ap-069"></a>

### AP-069 - Show sellable capacity while quoting

**Rating:** C3 | U2 | N2. **Builds on:** NOV-021, capacity.

**Today.** Sales promises dates without knowing press load.

**System does.** On the quote, show booked vs available kg per week for the relevant press group and the earliest realistic week for this quantity.

**User does.** Uses it to promise.

**Build.** Capacity read model by press group and week.

**Guardrails.** Indicative; final promise still goes through feasibility checks.

**Done when.** Promised dates align better with actual completion.

<a id="ap-070"></a>

### AP-070 - Convert configurator projects to orders with a stock check

**Rating:** C4 | U3 | N3. **Builds on:** systems-configurator, EOS-100.

**Today.** Configurator output (windows and doors) has to be retyped into an order.

**System does.** Accepting a configurator project creates order lines for profiles (stock lengths from the cutting list), hardware, and accessories, and shows stock availability for each.

**User does.** Sales reviews and confirms.

**Build.** Mapping from configurator BOM to order lines.

**Guardrails.** Applies only if Omalco sells systems; confirm before building.

**Done when.** A configured project becomes an order without retyping.

## F: Commercial and finance autopilot

<a id="ap-071"></a>

### AP-071 - Follow up quotations on a schedule

**Rating:** C2 | U1 | N1. **Builds on:** NOV-066, CRM.

**Today.** Sent quotes are followed up when someone remembers.

**System does.** After sending, follow-up tasks are created at configured intervals (e.g. day 2, day 7, before validity end) with a prepared message; recording an outcome stops the sequence.

**User does.** Calls or messages, records the outcome.

**Build.** Follow-up schedule per quote; tasks via AP-001.

**Guardrails.** Stops on order, loss, or expiry.

**Done when.** Every open quote has a next follow-up date.

<a id="ap-072"></a>

### AP-072 - Guard floor prices by alloy and finish

**Rating:** C2 | U1 | N1. **Builds on:** quote calculation, approvals.

**Today.** Low prices are caught only if a manager reviews the quote.

**System does.** Floor conversion charges per alloy, finish, and quantity band; quote lines below floor require approval with reason before sending.

**User does.** Sales requests; owner approves.

**Build.** Floor table; check in quote send action.

**Guardrails.** Internal only.

**Done when.** No quote below floor is sent without approval.

<a id="ap-073"></a>

### AP-073 - Generate customer rate cards from today's metal rate

**Rating:** C3 | U2 | N2. **Builds on:** AP-030, PDF engine.

**Today.** Dealers ask for current rates and get typed messages.

**System does.** A PDF/WhatsApp rate card per customer category (profile family, finish, rate per kg) built from today's basis and the customer's agreed conversion.

**User does.** Shares it.

**Build.** Rate card template; generator.

**Guardrails.** Shows selling prices only; validity date printed.

**Done when.** A rate card is produced in one click after the daily rate update.

<a id="ap-074"></a>

### AP-074 - Manage scrap sales by grade

**Rating:** C3 | U2 | N2. **Builds on:** foundry scrap, AP-013.

**Today.** Surplus scrap sales are handled outside the system.

**System does.** Scrap stock by grade (from derived and weighed scrap), buyer offers, sale order, weighbridge weight, and invoice with the correct HSN.

**User does.** Accepts the best offer, records the weight.

**Build.** Scrap grade master; sale flow reusing invoice posting.

**Guardrails.** Scrap issued to foundry vs sold is tracked separately.

**Done when.** Scrap stock reconciles to generation minus remelt minus sales.

<a id="ap-075"></a>

### AP-075 - Raise weight-difference notes from customer receipt weight

**Rating:** C3 | U2 | N2. **Builds on:** NOV-076 (partial acceptance), credit notes.

**Today.** When the customer's weighbridge differs from Omalco's invoice weight, the note is calculated manually.

**System does.** Enter the customer's reported weight; if the difference exceeds the agreed tolerance, a debit or credit note is drafted at the invoice rate with GST.

**User does.** Accounts approves.

**Build.** Tolerance per customer; draft note.

**Guardrails.** Notes reference the original invoice and require approval.

**Done when.** Weight disputes have a recorded outcome.

<a id="ap-076"></a>

### AP-076 - Forecast cash for four weeks

**Rating:** C3 | U2 | N2. **Builds on:** receivables, payables, purchase orders.

**Today.** Cash planning is done in a separate spreadsheet.

**System does.** Weekly view of expected receipts (due dates and each customer's actual payment delay), payables due, committed POs, and fixed expenses.

**User does.** Owner reviews; accounts adds known one-offs.

**Build.** Forecast read model.

**Guardrails.** Owner and accounts only.

**Done when.** Forecast vs actual is compared weekly.

<a id="ap-077"></a>

### AP-077 - Reconcile customer TDS deductions

**Rating:** C3 | U2 | N1. **Builds on:** receivables.

**Today.** Customers deduct TDS on purchases and pay short; the difference stays open on invoices.

**System does.** Receipt entry accepts a TDS amount per invoice; open TDS receivable is tracked per customer and quarter, and can be matched against the uploaded tax credit statement.

**User does.** Accounts records TDS and reconciles quarterly.

**Build.** TDS fields on receipt allocation; reconciliation import.

**Guardrails.** Rates and rules configured by accounts; the system does not give tax advice.

**Done when.** No invoice is open only because of unrecorded TDS.

<a id="ap-078"></a>

### AP-078 - Track MSME supplier payment deadlines

**Rating:** C2 | U2 | N1. **Builds on:** vendors, payables.

**Today.** Payments to MSME-registered suppliers are not tracked against statutory payment periods.

**System does.** Vendors flagged MSME (with Udyam number) have bills tracked against the agreed period (capped at the configured statutory limit); upcoming and overdue items appear for accounts.

**User does.** Pays or records reason.

**Build.** Vendor MSME fields; due calculation; accounts queue.

**Guardrails.** Limits set by accounts; label as an aid, not legal advice.

**Done when.** No MSME bill passes its deadline unnoticed.

<a id="ap-079"></a>

### AP-079 - Send monthly customer statements from a queue

**Rating:** C2 | U2 | N2. **Builds on:** PDF engine, receivables.

**Today.** Statements are prepared on request.

**System does.** On the first working day, statements for customers with balances are generated and queued with an email or WhatsApp text.

**User does.** Reviews the queue and sends.

**Build.** Statement PDF; queue via AP-001.

**Guardrails.** Each statement contains only that customer's records.

**Done when.** Every customer with a balance receives a monthly statement.

<a id="ap-080"></a>

### AP-080 - Prepare a daily owner digest at 8 am

**Rating:** C2 | U1 | N1. **Builds on:** command center metrics, AP-001.

**Today.** The owner opens several screens or calls departments every morning.

**System does.** At 8 am a short summary: yesterday's production kg and recovery %, dispatch kg, invoicing, collections, overdue total, credit holds, red-list orders, presses idle, and anything needing the owner's approval. Ready to read in-app and to copy to WhatsApp.

**User does.** Reads it.

**Build.** Digest generator from Insights metrics (AP-044); stored daily snapshot.

**Guardrails.** Only owner/management roles; digest text marks figures as of its generation time.

**Done when.** The owner uses the digest instead of morning calls.

<a id="ap-081"></a>

### AP-081 - Create the e-way bill upload file from dispatches

**Rating:** C3 | U1 | N1. **Builds on:** dispatch e-way bill fields, invoices.

**Today.** E-way bill details are typed into the government portal from the invoice.

**System does.** Select dispatches; produce the portal's bulk-upload JSON with GSTINs, HSN, values, vehicle, transporter, and distance. After generation on the portal, paste back the EWB number (or import the response) onto the dispatch.

**User does.** Uploads the file to the portal.

**Build.** Schema mapping in `lib/`; validation before export.

**Guardrails.** No portal credentials stored; schema version recorded.

**Done when.** E-way bills for a day's dispatches need one upload.

<a id="ap-082"></a>

### AP-082 - Create e-invoice JSON from invoices

**Rating:** C3 | U2 | N1. **Builds on:** invoices, AP-037.

**Today.** If Omalco is above the e-invoicing threshold, IRN data is retyped into another tool.

**System does.** Export invoices in the e-invoice schema; import IRN, acknowledgement number, and signed QR back onto the invoice; print the QR on the invoice PDF.

**User does.** Uploads to the IRP or GSP tool.

**Build.** Schema mapping; import of the response.

**Guardrails.** Applicability confirmed by accounts; posted invoices keep a snapshot.

**Done when.** IRN and QR appear on invoices without retyping.

<a id="ap-083"></a>

### AP-083 - Export vouchers to Tally

**Rating:** C3 | U1 | N1. **Builds on:** SRC-INTEG, invoices, receipts, purchases.

**Today.** Every invoice, receipt, and purchase is entered again in Tally.

**System does.** Daily export of posted sales invoices, receipts, purchase bills, credit/debit notes as Tally-importable XML, with a ledger mapping table (customers, GST ledgers, sales ledgers). Each voucher is exported once and marked.

**User does.** Imports the file into Tally.

**Build.** Ledger mapping settings; XML generator; export batch table.

**Guardrails.** Re-export only through an explicit re-export with reason.

**Done when.** A day's vouchers import into Tally without manual entry.

<a id="ap-084"></a>

### AP-084 - Prepare a daily payment reminder queue

**Rating:** C3 | U1 | N1. **Builds on:** NOV-040 (collection commitments), receivables.

**Today.** Reminders depend on accounts' memory.

**System does.** Each morning, a queue of customers whose invoices are due in three days, due today, or overdue by set steps, each with a prepared message listing invoices and amounts. Customers with an active payment commitment are skipped until it lapses.

**User does.** Sends or skips with reason.

**Build.** Reminder rules; queue via AP-001.

**Guardrails.** Prepared vs sent states recorded; no automatic sending.

**Done when.** Overdue invoices always have a recent reminder or commitment.

<a id="ap-085"></a>

### AP-085 - Generate the month-end close checklist

**Rating:** C3 | U1 | N1. **Builds on:** AP-059, finance review.

**Today.** Month-end misses unbilled dispatches, unallocated receipts, open receipts, and stock variances.

**System does.** A checklist computed from open items: unbilled dispatches, draft invoices, unallocated receipts, GRNs without bills, unreconciled bank lines, open stock adjustments, unexported Tally vouchers. Each item links to its fix.

**User does.** Clears items, then closes the period.

**Build.** Checklist read model; close action requires zero blocking items or approval.

**Guardrails.** Close is accounts head only.

**Done when.** Months close with no blocking items.

## G: Small efficiency features

<a id="ap-086"></a>

### AP-086 - Add date chips to every date filter

**Rating:** C1 | U2 | N2. **Builds on:** shared table filters.

**Today.** Date ranges are picked day by day.

**System does.** Chips for Today, Yesterday, This week, This month, Last month, This FY.

**Build.** Shared date-range filter component.

**Done when.** All database pages use the shared filter.

<a id="ap-087"></a>

### AP-087 - Use a large numeric keypad on workstations

**Rating:** C1 | U1 | N1. **Builds on:** workstation mode.

**Today.** Touch screens open a full keyboard for numbers.

**System does.** Numeric fields use `inputmode="decimal"` and, in workstation mode, an on-screen keypad with large keys.

**Build.** Shared numeric input variant.

**Done when.** Gloved operators can enter numbers without mis-taps in a floor test.

<a id="ap-088"></a>

### AP-088 - Allow arithmetic inside numeric fields

**Rating:** C1 | U3 | N2. **Builds on:** shared numeric input.

**Today.** Staff use a phone calculator, then type the result.

**System does.** Typing `=12*6.4` or `250+180` evaluates on blur, shows the expression, and stores the result.

**Build.** Safe expression parser (numbers and + - * / only).

**Done when.** No eval of arbitrary code; expression kept as a hint only.

<a id="ap-089"></a>

### AP-089 - Copy a WhatsApp-ready summary from every record

**Rating:** C1 | U1 | N1. **Builds on:** transaction communication.

**Today.** Staff compose summaries for WhatsApp by hand.

**System does.** A "Copy summary" button on orders, dispatches, invoices, jobs, and quotes with a standard short format (customer-safe version and internal version).

**Build.** Summary formatters in `lib/`; role-checked internal version.

**Done when.** Each main record type has a copy button.

<a id="ap-090"></a>

### AP-090 - Show recently used values first in selectors

**Rating:** C1 | U2 | N2. **Builds on:** [searchable-select.tsx](components/ui/searchable-select.tsx).

**Today.** The same customers and profiles are searched for repeatedly.

**System does.** Selectors list the user's last five choices for that field at the top.

**Build.** Per-user recent list (local storage acceptable, with try/catch fallback).

**Done when.** Common selections take one tap.

<a id="ap-091"></a>

### AP-091 - Print selected documents as one PDF

**Rating:** C2 | U2 | N2. **Builds on:** PDF engine.

**Today.** Challans, invoices, and labels print one at a time.

**System does.** Select rows on a database page; "Print selected" merges their PDFs.

**Build.** Server-side merge with per-record authorisation.

**Done when.** A day's challans print in one action.

<a id="ap-092"></a>

### AP-092 - Save filters as links and personal default views

**Rating:** C2 | U2 | N2. **Builds on:** NOV-091 (active filters).

**Today.** Filters are re-applied every visit.

**System does.** Filters live in the URL; a user can save a named view and set it as their default for that page.

**Build.** View preference table; URL state.

**Done when.** Returning to a page restores the user's default view.

<a id="ap-093"></a>

### AP-093 - Undo reversible actions for a few seconds

**Rating:** C2 | U3 | N2. **Builds on:** NOV-098 (action results).

**Today.** Accidental assign, archive, or status moves need a manual reversal.

**System does.** Low-risk actions show an Undo toast for ten seconds; undo runs the inverse action.

**Build.** Inverse action registry for low-risk actions only.

**Done when.** No posting action (stock, money, quality release) offers undo; those use corrections.

<a id="ap-094"></a>

### AP-094 - Queue factory phone entries while offline

**Rating:** C4 | U2 | N1. **Builds on:** mobile routes, NOV-013 (drafts).

**Today.** Weak Wi-Fi in the plant loses entries.

**System does.** Mobile tasks (pushes, QC readings, bundle confirmation, loading scans) queue locally with request IDs and sync when online; conflicts are shown for resolution.

**Build.** Service worker or IndexedDB queue; idempotent server actions keyed by request ID.

**Done when.** An entry made offline posts exactly once after reconnecting.

<a id="ap-095"></a>

### AP-095 - Offer Hindi labels on shop-floor screens

**Rating:** C3 | U2 | N2. **Builds on:** workstation and mobile routes.

**Today.** Operators who read Hindi more easily struggle with English labels.

**System does.** Language toggle for workstation, mobile tasks, and labels on floor screens; record values stay unchanged.

**Build.** Message catalogue for floor screens only; per-user preference.

**Done when.** Floor workflows can be completed fully in Hindi.

<a id="ap-096"></a>

### AP-096 - Print a paper job card with a QR fallback

**Rating:** C2 | U2 | N2. **Builds on:** production jobs, QR.

**Today.** If a tablet is unavailable, the job has no instructions at the press.

**System does.** A one-page job card (die, alloy, temper, billet length, cut lengths, quantities, packing, QC checks) with a QR that opens the job.

**Build.** PDF template.

**Done when.** Every released job can print a card.

<a id="ap-097"></a>

### AP-097 - Warn about duplicate entries

**Rating:** C2 | U1 | N1. **Builds on:** quote, order, receipt, and dispatch create actions.

**Today.** The same order or receipt is sometimes entered twice by different people.

**System does.** Before saving, warn if a record with the same customer, amount or quantity, and reference exists within a short window; the user confirms or opens the existing one.

**Build.** Duplicate check per record type in server actions.

**Done when.** Duplicate receipts and orders in an audit sample fall to zero.

<a id="ap-098"></a>

### AP-098 - Close alerts automatically when their condition clears

**Rating:** C2 | U1 | N1. **Builds on:** alerts, tasks, NOV-016.

**Today.** Alerts stay open after the problem is solved, so lists fill with noise.

**System does.** Condition-based alerts and tasks re-evaluate on the relevant event or nightly; cleared ones resolve with "resolved by system: condition cleared".

**Build.** Condition key on alerts; re-evaluation job.

**Done when.** Open alert counts reflect real open problems.

<a id="ap-099"></a>

### AP-099 - Paste screenshots and photos into attachments

**Rating:** C1 | U2 | N2. **Builds on:** EOS-36 (upload once and link).

**Today.** Images from WhatsApp Web must be saved, then uploaded.

**System does.** Ctrl+V on a record's attachment area uploads the clipboard image; drag-and-drop also works.

**Build.** Paste handler on the shared attachment component.

**Done when.** A copied image attaches in one step.

<a id="ap-100"></a>

### AP-100 - Give the owner a system health page

**Rating:** C2 | U2 | N1. **Builds on:** AP-001, deployment checks.

**Today.** The owner cannot tell whether background jobs, backups, and integrations are working.

**System does.** One page: last successful run of each job, failed jobs, pending proposals by age, last Tally/e-way exports, database backup status (from the provider where available), and error count today.

**Build.** Read model over job runs and export batches.

**Done when.** A failed job is visible on the page within one run window.

## Delivery plan

Work in batches of ten like the November catalogue, each slice independently reviewable with its own record file (`AUTOPILOT_UPGRADE_BATCH_N.md`).

| Batch | Focus | Entries | Why first |
| --- | --- | --- | --- |
| 1 | Go-live and foundations | AP-001, 002, 004, 005, 006, 007, 038, 059, 041, 042 | Needed to load Omalco's data after the wipe and to run anything automatically; removes the hub sprawl before more features land |
| 2 | Press floor capture | AP-011, 012, 013, 014, 015, 016, 066, 087, 028, 054 | One tap per billet feeds output, scrap, recovery, downtime, die, and maintenance counters |
| 3 | Order-to-cash autopilot | AP-045, 046, 032, 058, 024, 084, 031, 037, 097, 098 | Removes the biggest manual steps between confirmation and cash |
| 4 | Dispatch and compliance | AP-018, 019, 051, 081, 083, 017, 035, 036, 089, 060 | Loading by scan, e-way bills, and Tally export end the largest double-entry |
| 5 onward | Planning, quality, commercial, and small efficiencies | Remaining entries by delivery rank | Depend on data produced by batches 1-4 |

Rules for each batch: follow the [shared implementation contract](#shared-implementation-contract); record fields typed and proposal acceptance before and after on a small Omalco pilot group; keep local checks, hosted migration state, and employee acceptance as separate facts in the batch record.

## Catalogue integrity record

- Exactly 100 entries, AP-001 to AP-100, each with one rating line.
- Counts in the register are generated from the rating lines in this file.
- References to older work: `EOS-n` means feature n of [UPGRADE_EOS.md](UPGRADE_EOS.md); `NOV-nnn` means the entry in [NOV_UPGRADES.md](NOV_UPGRADES.md).
- Ratings are an initial assessment on 9 November 2026 and should be revisited after observing work at Omalco.
