# FIXES-CLAUDE.md — Business Logic Flaw Register

**Companion to `CLAUDE.md`.** This document is the authoritative register of **business-logic flaws** found in ExtrusionOS during a deep, line-by-line audit of the core calculation and workflow code. It is written for AI coding agents (and humans) who will fix these issues.

- **Audit date:** 2026-09-20
- **Branch audited:** `codex/v1`
- **Scope of audit:** core business logic only — costing/quotation math, GST, margins, inventory movement, payments/invoicing, foundry/yield, the door/window systems configurator, quote→order→dispatch→invoice traceability, and business-number generation. UI styling, accessibility, and non-business code were **not** in scope.
- **Method:** static read-through of `lib/**`, `supabase/migrations/**`, and the relevant `components/**` form clients. No code was executed. No code was modified by this audit.

> **How to use this file:** Fix in severity order (P0 → P3). Each finding has a stable ID (`BL-xx`). When you fix one, do **not** delete it — append a `**STATUS: FIXED (commit/PR)**` line so history is preserved. Follow every rule in `CLAUDE.md` (safe/additive migrations, RLS intact, no service-role in client, business logic in `/lib`, checks before completion).

---

## Remediation status (2026-09-29)

All 18 findings have local implementations. Database behavior requires applying
`supabase/migrations/20260929000000_business_logic_fixes.sql` before deploying the
application changes. The historical findings below are preserved as audit history.
No commit, PR, live migration, or production deployment was made by this task.

| Finding | Status and implementation |
|---|---|
| BL-01 | **STATUS: FIXED (local worktree).** Existing profile section perimeter supplies finishing area; missing area costs zero and blocks approval/sending and quote PDF. |
| BL-02 | **STATUS: FIXED (local worktree).** Billet consumption is grossed up by recovery in TypeScript and SQL; handling/offcut allowance remains additional. |
| BL-03 | **STATUS: FIXED (local worktree).** Browser allocation removed; insert triggers allocate under the database lock, with immutable allocated identifiers and Kolkata dates. |
| BL-04 | **STATUS: FIXED (local worktree).** Quote price and minimum-profit approval use margin on selling revenue. |
| BL-05 | **STATUS: FIXED (local worktree; domestic GST scope).** Explicit supply state, company GST state, HSN, source-derived rates, CGST/SGST/UTGST/IGST, invoice display and protected PDF. |
| BL-06 | **STATUS: FIXED (local worktree).** External metal defaults to the scrap complement; invalid shares rejected; rounded kilograms conserve charge. |
| BL-07 | **STATUS: FIXED (local worktree).** Glass excludes wastage in its material bucket; rounded component costs reconcile. |
| BL-08 | **STATUS: FIXED (local worktree).** Payment plus credit settles the invoice; additive migration corrects affected status labels without repricing. |
| BL-09 | **STATUS: FIXED (local worktree).** Removed unused TypeScript copier; SQL conversion stamps quote and line identity. |
| BL-10 | **STATUS: FIXED (local worktree).** PCDA totals, per-kg net rate, full internal cost and override profit are consistent and reconstructable. |
| BL-11 | **STATUS: FIXED (local worktree).** Quote and invoice GST sum rounded per-line tax, preserving zero and mixed rates. |
| BL-12 | **STATUS: FIXED (local worktree).** Signed half-away-from-zero rounding also supports scientific notation. |
| BL-13 | **STATUS: FIXED (local worktree).** Crore groups use recursive integer wording. |
| BL-14 | **STATUS: FIXED (local worktree).** Renamed the planned-versus-actual helper to `planAttainmentPercent`. |
| BL-15 | **STATUS: FIXED (local worktree).** Glass, formula variables and hardware share one deduction lookup with `_mm` precedence. |
| BL-16 | **STATUS: FIXED (local worktree).** Oversized cuts are unplaced; reusable offcuts are excluded from waste; kerf remains waste. |
| BL-17 | **STATUS: FIXED (local worktree).** Direct order totals derive from line values and line GST; quoted orders derive from the quote. |
| BL-18 | **STATUS: FIXED (local worktree).** Composition equality compares element values independently of property order. |

Verification and release limits are recorded in `BUSINESS_LOGIC_VERIFICATION.md`.

## Severity legend

| Level | Meaning |
|-------|---------|
| **P0 — Critical** | Produces wrong money on customer-facing or financial documents, or corrupts data integrity. Fix before factory-floor use. |
| **P1 — High** | Systematic mis-costing, compliance gap, or concurrency defect with a realistic trigger. |
| **P2 — Medium** | Incorrect in edge cases, cross-module inconsistency, or misleading numbers that erode trust. |
| **P3 — Low** | Narrow edge cases, cosmetic-but-wrong output, or latent risks behind currently-unused paths. |

---

## Summary table

| ID | Severity | Area | One-line |
|----|----------|------|----------|
| BL-01 | P0 | Quotation costing | `per_sqft` finishing cost is always a hardcoded estimate; the warning falsely says "zero cost" |
| BL-02 | P0 | Quotation costing | `expected_recovery_percent` is captured everywhere but never used → billet cost under-stated |
| BL-03 | P0 | Numbering | Business numbers minted in-browser via read-then-max+1 → duplicate/failed order/quote/invoice numbers |
| BL-04 | P1 | Margins/approvals | Markup-on-cost input vs margin-on-revenue threshold → false "low margin" approval gate |
| BL-05 | P1 | GST / compliance | No CGST/SGST/IGST split anywhere; quotes use a single flat GST on the whole subtotal |
| BL-06 | P1 | Foundry / yield | Furnace-mix scrap% + external% not constrained to 100%; default over-counts the charge |
| BL-07 | P2 | Configurator costing | Glass wastage double-represented in the returned cost breakdown |
| BL-08 | P2 | Receivables | Invoice settled by payment + credit note stays `partially_paid` forever (never `paid`) |
| BL-09 | P2 | Traceability | Quote→order conversion is duplicated in TS and SQL and they diverge; live SQL path drops line lineage |
| BL-10 | P2 | PCDA snapshot | PCDA line-item fields mix per-kg and totals; `internal_cost` omits packing/transport/other |
| BL-11 | P2 | GST consistency | Quote total uses one flat GST%; invoice total uses per-line GST% → totals can drift |
| BL-12 | P3 | Rounding | `roundHalfUp` rounds negatives toward +∞ (asymmetric) for signed values |
| BL-13 | P3 | Invoice words | `numberToWordsINR` prints "undefined Crore" for amounts ≥ ₹100 crore |
| BL-14 | P3 | Naming | Two different "yield" definitions (plan attainment vs material recovery) |
| BL-15 | P3 | Configurator BOM | Glass-deduction option keys read inconsistently → glass area vs gasket/bead mismatch |
| BL-16 | P3 | Cutting optimizer | Over-length cut placed in an impossible bar silently; reusable offcut counted as waste |
| BL-17 | P3 | Order value | `order_value` is client-supplied on direct order save, not derived from line items |
| BL-18 | P3 | Alloy master | `compositionsMatch` is key-order sensitive (JSON.stringify) → false "customized" flags |

---

## P0 — Critical

### BL-01 — `per_sqft` finishing cost is always a fabricated estimate, and the warning lies

- **Location:** `lib/calculations/quote.ts:80` (`calculateFinishingCost`), `:123` (the only caller), `:203` (the warning text)
- **What's wrong:** `calculateFinishingCost(chargeType, charge, billingWeightKg, totalMeters, surfaceAreaSqft?)` accepts an optional real surface area, but the **only** call site never passes it:
  ```ts
  // quote.ts:123
  const finishing_cost = calculateFinishingCost(input.finishing_charge_type, input.finishing_charge, billing_weight_kg, total_meters);
  //                                                                                             ^ surfaceAreaSqft omitted
  ```
  So for `finishing_charge_type === "per_sqft"`, `surfaceAreaSqft` is always `undefined`, and the function always falls through to a hardcoded geometry guess:
  ```ts
  const estimatedSqft = totalMeters * 0.3 * 10.764; // assumes a 0.3 m perimeter for EVERY profile
  return money(estimatedSqft * nonNegative(charge));
  ```
  Meanwhile the estimator is shown warning `surface_area_missing`: *"…This line uses zero finishing cost until surface area is added."* — which is **false**; the line is charged a non-zero, profile-blind estimate.
- **Business impact:** Directly wrong quotation costing (business problem #1) and a "fake feature" (violates `CLAUDE.md` §5.8). Powder-coating/anodizing is often quoted per sqft; a 0.3 m perimeter assumption can be off by 2–5× for wide sections, and the user is told the cost is zero so they never sanity-check it.
- **Fix:**
  1. Compute real surface area = (profile perimeter in m) × (total meters) → sqft, and thread it into `calculateFinishingCost` from `calculateQuoteItem`. Perimeter should come from the profile master (add a `perimeter_mm` / surface-area-per-m field if absent).
  2. If surface area is genuinely unavailable, return `0` **and** make the warning truthful, and mark the line as not-costed (block send / require override) instead of silently charging a guess.
- **Confidence:** High (caller confirmed by full-repo grep: symbol has exactly two references — definition + one call).

### BL-02 — `expected_recovery_percent` is captured everywhere but never affects cost

- **Location:** `lib/calculations/quote.ts:9` (input type), `:111` (assigned), `:138` (returned); UI at `components/modules/quotes-client.tsx:415` ("Recovery %" field, default 100); validated at `lib/validations/schemas.ts:208`.
- **What's wrong:** The estimator can enter a "Recovery %" per line, but it is **never used in any cost formula**. Material weight is grossed up only by `scrap_allowance_percent`:
  ```ts
  const effective_weight_kg = qty(total_weight_kg * (1 + scrap_allowance_percent / 100));
  const raw_material_cost   = money(billing_weight_kg * nonNegative(input.billet_rate_per_kg));
  // expected_recovery_percent is read into a local and returned, but not referenced in any math
  ```
- **Business impact:** Recovery (yield) is the single biggest driver of billet consumption per kg of saleable extrusion. At 85% recovery you must charge for ~1/0.85 = **1.176× billet input**, but the quote charges for finished weight (plus scrap allowance) only. Result: **systematic under-costing of raw material** on virtually every quote (recovery is essentially never 100%). Hits business problems #1 (wrong costing) and #6 (scrap/yield loss). Worse, the field *looks* like it works, so estimators trust it.
- **Fix:** Decide the intended model and implement one of:
  - Gross up billet consumption: `billet_input_kg = billing_weight_kg / (expected_recovery_percent/100)` and cost raw material on `billet_input_kg`; keep `scrap_allowance_percent` only if it means something distinct (e.g., handling/offcut on top of metallurgical recovery), otherwise remove it to avoid double-buffering.
  - Or, if recovery is deliberately informational, remove the field from the form so it does not imply an effect. Do not leave a live-looking no-op input.
- **Confidence:** High (grep shows no usage of the variable in any formula).

### BL-03 — Business numbers are minted client-side with a racy read-then-max+1 (duplicate/failed numbers)

- **Location:** `lib/utils/numbering.ts:7` (`nextBusinessNumber`); used at `components/modules/operations/record-form-client.tsx:764-773` (browser fetch → compute → direct insert), `components/modules/orders/quote-order-form-client.tsx:145`, and `lib/actions/quotes-orders.ts:224`. A **safe, locked** alternative already exists: `private.next_business_number_locked(...)` (used by the atomic RPCs).
- **What's wrong:** `nextBusinessNumber` scans a list of existing numbers and returns `max + 1`. In `record-form-client.tsx` this runs **in the browser** and the result is inserted directly:
  ```ts
  const { data: existing } = await supabase.from(config.table).select(config.numberField).eq("company_id", context.companyId);
  payload = { ...payload, [config.numberField]: nextBusinessNumber(config.numberPrefix, (existing ?? []).map(r => r[config.numberField]).filter(Boolean)) };
  // ... supabase.from(config.table).insert(payload)
  ```
  Two concurrent creates read the same set and compute the **same** next number.
- **Business impact:**
  - Tables with `unique(company_id, <number>)` (`quotes`, `orders`, `dispatches`, `invoices`, `dealer_orders` — see `supabase/schema.sql:144/222/256`, `20260512_phase5_financials_analytics.sql:30`, `0040_...:240`): the losing insert fails with a constraint violation → user sees a cryptic error and loses the form.
  - Tables **without** that constraint (job/foundry/scrap/packaging prefixes `J/FB/EAS/SCR/PKG/PM`): **silent duplicate numbers** → broken traceability (business problem #12) and confused registers.
  - `getFullYear()` uses local time, not the business timezone (`Asia/Kolkata`), so year prefixes can flip around midnight/New Year.
- **Fix:** Route **all** number generation through the existing `next_business_number_locked` SQL function inside the same atomic transaction as the insert (it already takes a company-scoped advisory lock and a business date). Remove client-side number generation entirely; never compute a persisted number in the browser. Delete or repurpose `nextBusinessNumber` for **preview-only** display, clearly labelled as non-authoritative.
- **Confidence:** High.

---

## P1 — High

### BL-04 — Margin base mismatch triggers false "low margin" approvals

- **Location:** `lib/calculations/quote.ts:126-131`
- **What's wrong:** The input margin is applied as **markup on cost**, but the approval gate compares **margin on revenue** to `minimum_margin_percent`:
  ```ts
  const margin_amount = money(line_subtotal * margin_percent / 100);          // markup on cost
  const estimated_profit_percent = (estimated_profit_amount / line_total_before_gst) * 100; // margin on revenue
  const approval_required = estimated_profit_percent < minimum_margin_percent;
  ```
  A line priced at exactly a 20% markup shows `estimated_profit_percent ≈ 16.67%`. If `minimum_margin_percent = 20`, the line is flagged for owner approval even though the estimator "hit 20%".
- **Business impact:** Spurious low-margin approval gates on correctly-priced quotes; estimators learn to ignore the flag, defeating owner control (business problem #10). Or, if the intent really is margin-on-revenue, the input knob mislabels itself as the same number.
- **Fix:** Pick one convention (recommend **margin on revenue** throughout, which is the trade norm) and make the input, the displayed profit %, and the `minimum_margin_percent` threshold all use the same base. Add a unit test pinning the definition.
- **Confidence:** High (arithmetic is unambiguous; the "bug vs. definitional" call is a product decision, but the two bases are provably different).

### BL-05 — No CGST/SGST/IGST split; quotes apply one flat GST to the whole subtotal

- **Location:** `lib/calculations/quote.ts:169` (`gst_amount = subtotal * gstPercent/100`); confirmed absent repo-wide — grep for `igst|cgst|sgst|place_of_supply` returns **zero** matches in any `.ts`. Invoice side computes per-line tax but still a single `tax_total` (`supabase/migrations/20260718010000_financial_closure.sql:64-69`).
- **What's wrong:** A compliant Indian **tax invoice** must split CGST+SGST for intra-state supply or charge IGST for inter-state, decided by place-of-supply vs. the company's state. The system stores/derives only a single "GST".
- **Business impact:** Generated invoices are not GST-compliant tax invoices (`CLAUDE.md` §11 lists GST as required context). Also blocks correct GSTR filing/export.
- **Fix:** Add company state + customer place-of-supply, HSN + rate per line, and compute CGST/SGST (intra) or IGST (inter) on the invoice. Keep the single rate on the quote if desired, but the invoice must split. Verify with the business whether the current single-figure invoice is a known interim.
- **Confidence:** High for the gap; the compliance requirement is standard Indian GST law.

### BL-06 — Foundry furnace-mix: scrap% and external% aren't constrained to sum to 100

- **Location:** `lib/calculations/foundry.ts:28-39` (`calculateFoundryFurnaceMix`)
- **What's wrong:** The charge is split into scrap and fresh/external metal, but the two percentages are independent, and the defaults are `scrapPercentage = 0`, `externalAluminiumPercentage = 100`:
  ```ts
  const requiredFurnaceChargeKg = totalBilletWeightKg / (furnaceEfficiencyPercent/100);
  scrapAluminiumKg    = requiredFurnaceChargeKg * (scrapPercentage/100);
  externalAluminiumKg = requiredFurnaceChargeKg * (externalAluminiumPercentage/100);
  ```
  Call it with `scrapPercentage = 30` and leave `externalAluminiumPercentage` at its default `100`: you get scrap 30% **plus** external 100% = **130%** of the furnace charge. There is no invariant that `scrap% + external% = 100%`.
- **Business impact:** Over-counts total metal input → wrong scrap-vs-fresh planning and wrong material cost/consumption for the foundry (business problems #5, #6).
- **Fix:** Either derive `externalAluminiumKg = charge − scrapAluminiumKg` (complementary by construction), or validate `scrap% + external% === 100` and reject otherwise. Change the default so external defaults to `100 − scrap`.
- **Confidence:** High (defaults provably violate the physical invariant whenever scrap > 0).

---

## P2 — Medium

### BL-07 — Glass wastage double-represented in the configurator cost breakdown

- **Location:** `lib/systems-configurator/costing-engine.ts:81` (added once, correct), `:95` and `:101` (reported twice)
- **What's wrong:** `internalCost`/`grandTotal` are correct, but the returned breakdown reports glass wastage in **both** buckets, while aluminium wastage is reported in only one:
  ```ts
  glassCost:     roundMoney(glassCost + glassWastageAmount),               // includes glass wastage
  wastageAmount: roundMoney(aluminiumWastageAmount + glassWastageAmount),  // includes it again
  aluminiumCost: roundMoney(aluminiumBaseCost),                            // excludes its own wastage
  ```
- **Business impact:** Any PDF/UI that sums the component lines overstates the total by the glass wastage and won't reconcile to `grandTotal`; the breakdown is internally inconsistent (aluminium ex-wastage, glass incl-wastage). Erodes trust on customer-facing quote breakdowns.
- **Fix:** Choose one convention — either report every material cost **excluding** wastage and keep the single `wastageAmount` bucket, or fold each wastage into its own material line and drop it from `wastageAmount`. Don't do both for glass. Add a test asserting `sum(components) === internalCost`.
- **Confidence:** High.

### BL-08 — Invoice settled by payment + credit note is stuck at `partially_paid`

- **Location:** `supabase/migrations/20260723070000_dispatch_return_credit_notes.sql:98-106` (status ladder); `balance_due` generated column at `:12`
- **What's wrong:** `balance_due = greatest(grand_total − amount_paid − credited_amount, 0)` is correct, but the status ladder checks each component **alone**:
  ```sql
  when credited_amount >= grand_total and grand_total > 0 then 'credited'
  when grand_total > 0 and v_effective_paid = grand_total then 'paid'
  when v_effective_paid > 0 then 'partially_paid'
  ```
  An invoice of ₹1000 with ₹600 paid + ₹400 credited has `balance_due = 0` but hits neither `credited` (400 < 1000) nor `paid` (600 ≠ 1000) → it lands on `partially_paid` permanently.
- **Business impact:** Fully-settled invoices show as outstanding/partially-paid on collection dashboards and owner views (business problems #8, #10). (Overpayment itself is correctly prevented — `balance_due` and the payment guard already account for credits — so this is a status-label defect, not a money leak.)
- **Fix:** Add a terminal branch: `when (amount_paid + credited_amount) >= grand_total and grand_total > 0 then 'paid'` (or a distinct `settled`), evaluated before `partially_paid`.
- **Confidence:** High.

### BL-09 — Quote→order conversion is duplicated (TS + SQL) and the live path drops line lineage

- **Location:** SQL live path `supabase/migrations/20260715000000_atomic_business_workflows.sql:182,207-217`; TS variant `lib/pcda/quote-order.ts:131-152` (`buildOrderItemFromQuoteItem`)
- **What's wrong:** Two implementations of "make order items from quote items" exist and disagree:
  - The **live** RPC copies `to_jsonb(qi) − [id, company_id, order_id, created_at, updated_at]` and sets `source_record_id = quote_id`, but **does not** set `source_line_id = quote_item.id`.
  - The **TS** helper explicitly sets `source_line_id: quoteItem.id` and a curated field list.
- **Business impact:** Duplicated business logic (violates `CLAUDE.md` §5.7) that can silently drift. The live path loses per-line quote→order lineage (which quote line produced which order line), weakening end-to-end traceability (business problem #12). Downstream production keys off `order_item.id`, so production still works, but the quote linkage is gone.
- **Fix:** Delete one implementation. Keep the SQL RPC as the single source of truth and have it stamp `source_line_id := qi.id`. If `buildOrderItemFromQuoteItem` is dead, remove it; if it's used on another path, replace that path with the RPC.
- **Confidence:** High for the divergence; Medium on downstream impact (depends how much reporting relies on quote-line lineage).

### BL-10 — PCDA snapshot fields mix units and understate internal cost

- **Location:** `lib/pcda/quote-order.ts:103,105,115,116,119`
- **What's wrong:** When snapshotting a calculated quote line into PCDA technical-line-item fields:
  - `value_added_service_price: (conversion_charge_per_kg + finishing_charge)` mixes a **per-kg** rate with a charge whose unit depends on `finishing_charge_type` (per-kg / per-meter / fixed).
  - `basic_price` and `net_rate` are set to `price_per_kg` (a **per-kg** value), but the PCDA pure functions in `lib/calculations/pcda/cost.ts` (`basicPrice`, `netRateAndLineValue`) treat `basic_price` as a **line total** and divide by quantity. Semantics don't match.
  - `internal_cost = raw_material_cost + conversion_cost + finishing_cost + die_amortization_amount` **omits** `packing_charge + transport_charge + other_charges`, which *are* in the quote's `line_subtotal`.
- **Business impact:** Two different "internal cost" numbers exist for the same line (PCDA snapshot vs quote `line_subtotal`), so profit/margin reporting off the PCDA snapshot **overstates profit**. And if any downstream module ever recomputes value via `cost.ts` on these fields, the per-kg-as-total mismatch produces grossly wrong numbers. Currently latent because the authoritative `final_line_value` is carried forward, but it's a landmine.
- **Fix:** Make `internal_cost` equal the quote's full `line_subtotal` (include packing/transport/other). Store per-kg and total values in fields whose semantics match how `cost.ts` consumes them, or stop populating fields the recompute path would misread. Add a test asserting PCDA `internal_cost === quote line_subtotal`.
- **Confidence:** High on the `internal_cost` omission; Medium on the recompute risk (no active recompute path found, but the invariant mismatch is real).

### BL-11 — Quote total uses flat GST; invoice total uses per-line GST → totals drift

- **Location:** `lib/calculations/quote.ts:163-170` (flat `gstPercent` on subtotal) vs `supabase/migrations/20260718010000_financial_closure.sql:64-69` (per-line `gst_percent`, default 18)
- **What's wrong:** The quote summary applies a single `gstPercent` to the whole subtotal; the invoice recalculation sums each line's `gst_percent`. If any line carries a different GST% (or the quote-level % differs from the line default), the quote `grand_total` and the invoice `grand_total` for the same order won't match.
- **Business impact:** Customer sees one grand total on the quote and a different one on the invoice — a credibility and reconciliation problem (business problems #1, #12).
- **Fix:** Use per-line GST consistently in both places (preferred), or enforce a single company GST% end-to-end. Whichever is chosen, compute quote and invoice tax with the **same** rule.
- **Confidence:** Medium-High (drift only occurs with mixed rates, which the invoice path explicitly supports).

---

## P3 — Low / latent

### BL-12 — `roundHalfUp` is asymmetric for negative numbers
- **Location:** `lib/calculations/pcda/rounding.ts:18-25`
- **What's wrong:** Uses `Math.round`, which rounds halves toward +∞, so `-0.005 → -0.00` but `+0.005 → +0.01`. Documented as "half-up," which is fine for non-negative money but not for signed outputs (`weightVariance`, `contributionMargin` are explicitly allowed to be negative).
- **Impact:** Directionally biased rounding on variance/margin figures (sub-paise/sub-gram, but inconsistent).
- **Fix:** Round on magnitude and reapply sign (`sign * roundHalfUp(abs(value), d)`) if symmetric half-away-from-zero is intended, or document the asymmetry deliberately.
- **Confidence:** High.

### BL-13 — `numberToWordsINR` breaks for amounts ≥ ₹100 crore
- **Location:** `lib/utils/number-to-words.ts:44` (`twoDigitWords(crore)`)
- **What's wrong:** `crore` is passed to `twoDigitWords`, which only handles 0–99. At ≥ ₹100 crore, `tens[10]` is `undefined` → output like `"undefined Crore …"`.
- **Impact:** Garbage amount-in-words on large invoices/aggregate documents.
- **Fix:** Convert the crore group with a full number-to-words routine (recurse), not `twoDigitWords`.
- **Confidence:** High.

### BL-14 — Two conflicting "yield" definitions
- **Location:** `lib/calculations/operations.ts:105` (`calculateProductionYield = actual/planned`, i.e. plan attainment) vs `lib/calculations/pcda/recovery.ts:28` (`recoveryPercent = output/input`, i.e. material recovery)
- **Impact:** Both are legitimate but share yield-like naming; easy to misread one as the other in reports.
- **Fix:** Rename `calculateProductionYield` → `planAttainmentPercent` (or similar) and reserve "recovery/yield" for the material metric.
- **Confidence:** High (naming), informational.

### BL-15 — Glass-deduction option keys read inconsistently between engines
- **Location:** `lib/systems-configurator/hardware-engine.ts:102` reads only `glass_deduction_width`/`glass_deduction_height` (default 90); `lib/systems-configurator/glass-engine.ts:26-27` reads both those **and** the `_mm` variants.
- **Impact:** If a template sets only the `_mm` keys, glass area (glass-engine) and gasket/wool-pile perimeter (hardware-engine) use different deductions → BOM perimeter won't match the actual glass.
- **Fix:** Centralize option lookups (single helper that checks both key spellings) and use it in every engine.
- **Confidence:** High.

### BL-16 — Cutting optimizer places over-length cuts in impossible bars; conflates reusable offcut with waste
- **Location:** `lib/systems-configurator/profile-optimization.ts:89-116,131`
- **What's wrong:** A cut longer than stock length is warned about but still "placed" in its own bar with `usedLengthMm > stockLengthMm` and `wasteMm = 0` (physically impossible). Separately, `reusableLeftoverMm` is also counted inside `totalWasteMm`/`wastePercent`, so reusable offcuts inflate reported waste.
- **Impact:** Misleading cutting-list metrics (business problem #6 scrap/yield). Not a money bug, but planners rely on these numbers.
- **Fix:** Reject/segregate over-length cuts (don't fabricate a bar); separate "true waste" from "reusable offcut" in totals and `wastePercent`.
- **Confidence:** High.

### BL-17 — `order_value` is client-supplied on direct order save
- **Location:** `supabase/migrations/20260715000000_atomic_business_workflows.sql:255-260` (`save_order_atomic` keeps `order_value` from `p_order`)
- **What's wrong:** On direct order creation, `order_value` comes from the form, not from the sum of order line items. (The quote→order path is safer — it passes the server-read `quote.grand_total` — but the direct save path trusts the client figure.)
- **Impact:** Owner revenue/visibility figures can drift from the true line-item sum (business problem #10); borderline `CLAUDE.md` §5.6 (don't trust the frontend for authoritative values).
- **Fix:** Derive `order_value` from order line items server-side, or clearly treat it as an informational estimate distinct from the billed total.
- **Confidence:** Medium.

### BL-18 — `compositionsMatch` is key-order sensitive
- **Location:** `lib/calculations/alloy-composition.ts:127-129`
- **What's wrong:** Compares two compositions with `JSON.stringify(a) === JSON.stringify(b)`, which is order-sensitive; the same elements in a different key order compare as different.
- **Impact:** False "customized composition" detection → spurious flags/records against standard alloys.
- **Fix:** Compare normalized, key-sorted structures (or deep-equal element by element).
- **Confidence:** High.

---

## Verified correct (do not "fix" — these are strengths)

These areas were scrutinized and found sound; changing them risks regressions:

- **Payment atomicity & idempotency** — `record_payment_atomic` re-checks `balance_due` inside `SELECT … FOR UPDATE`, serializes via advisory lock + `idempotency_key`, and validates lineage (`20260718010000_financial_closure.sql`). Overpayment races are not possible.
- **`balance_due` / credit-note accounting** — generated column `greatest(grand_total − amount_paid − credited_amount, 0)`, with `overpaid_amount` tracked; over-collection with credits is prevented (`20260723070000_dispatch_return_credit_notes.sql`).
- **FIFO stock consumption** — row-locked (`FOR UPDATE`), subtracts active reservations, consumes `LEAST(remaining, available)`, and raises on shortfall; negative stock cannot be written (`0038_order_dealer_stock_fulfillment.sql:183-239`).
- **Formula engine** — hand-written recursive-descent parser with a function whitelist and blocked identifiers (`constructor`, `__proto__`, `eval`, …) and non-finite rejection; template formulas cannot execute code (`lib/systems-configurator/formula-engine.ts`).
- **Production lineage trigger** — locks lineage after planning, validates source line/profile, and gates `in_progress` on allocated billets (`20260918000000_production_source_line_integrity.sql`).
- **Customer-facing PDF gating (§10)** — internal cost/margin only render for `reportType === "internal_costing"` behind a server-side `canShowInternalCost` guard (`lib/pdf/systems-configurator-pdf.ts:255`); the customer quote PDF exposes no cost/margin.
- **Multi-tenancy in RPCs** — company_id is derived from `get_current_user_company_id()` server-side and every workflow function filters by it (`CLAUDE.md` §5.6/§6).
- **Billet weight / furnace charge math** — cylinder volume × density and required-billet-count grossing are correct (`lib/calculations/foundry.ts` — except the mix-percentage invariant in BL-06).

---

## Scope & caveats (not exhaustively audited)

- RLS policies were spot-checked (invoices, payments, profile_stock_batches) and looked role+company scoped, but **not all 292 migrations' policies** were reviewed line-by-line. A dedicated RLS/tenant-isolation pass is recommended (especially dealer-portal and customer-portal read paths, and storage-object scoping).
- The **customer/dealer portal** exposure surface (which fields reach external users) was not fully traced end-to-end; verify no cost/margin/supplier/internal-note fields leak through portal queries or share links (`CLAUDE.md` §10).
- Schema parity for the quote→order column copy (BL-09) was not verified against `order_items` columns; confirm all copied PCDA fields have matching destination columns.
- No tests were executed. After fixes, run the `CLAUDE.md` §12 checks (`npm run lint`, `typecheck`, `build`, `test`) and add regression tests for BL-01, BL-02, BL-04, BL-07, BL-08, BL-10.

---

*Generated by a static business-logic audit of branch `codex/v1` on 2026-09-20. No production data or code was modified.*
