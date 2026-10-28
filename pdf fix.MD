# PDF & Report Generation Overhaul — Handover

**Date:** 2026-10-20  **Branch:** `codex/v1` (uncommitted working-tree changes)  **Author:** Claude Code session

**User goal (verbatim intent):** Every PDF and report PDF must be of top quality: completely readable, properly formatted, professional and precise. Fix all the files and the way reports are generated.

> **Status (updated 2026-10-20, follow-up session): §5 complete.** §5 has been worked through: every document type was rendered with realistic fixtures and inspected page by page, the defects found are fixed, and lint, typecheck, build and the full test suite pass. See **§8** for what the visual audit found and changed, and §8.5 for the items that need a team decision or a database change. §0–§7 are kept as the original handover record.

---

## 0. ⚠️ Read first: a concurrent process is committing in this checkout

While this work was in progress, another tool (Codex or another agent) committed in this same folder:

- `af6d889` and `9d5ad3a` on **`main`**, both titled "Refresh codebase memory index". `af6d889` swept up the new file `lib/pdf/format.ts`. The branch was then switched back to `codex/v1`, and that switch **deleted `format.ts` from the working tree**. I restored it with `git show main:lib/pdf/format.ts > lib/pdf/format.ts`.
- `2e37d09` and `12874da` on `codex/v1` (finance remediation, migration reconciliation) committed the pre-existing finance/PDF work at about 12:20–12:22 IST.
- Worktrees: `C:/Users/arnav/.codex/worktrees/bugs-mega-next-issue/ExtrusionOS` and `.claude/worktrees/understand-project-c0e7dc`.

**Before continuing:** make sure no other agent is running in this folder, run `git status`, and check that every file listed in §2 still exists with the content described. `lib/pdf/format.ts` is tracked on `main` but **untracked** on `codex/v1`.

---

## 1. What was wrong (audit findings)

| # | Problem | Where |
|---|---------|-------|
| 1 | Four or more independent renderers, each with its own layout, colours, margins and fonts. No consistent document identity. | All PDF files |
| 2 | Non-Latin text **silently stripped** (`/[^\x00-\xFF]/g` removed). Indian-script names, addresses and "₹" vanished. | `systems-configurator-pdf.ts`, `die-technical-sheet.ts`, `profile-technical-sheet.ts` |
| 3 | Text overflow: pdf-lib `maxWidth` does not wrap, so table cells and long values ran into neighbouring columns. | Configurator tables, technical sheets |
| 4 | Footer and page numbers missing on all pages but the last. | Configurator PDF |
| 5 | Production sheet showed only the "top 12" cuts, "top 8" glass and "top 8" hardware lines: incomplete shop-floor documents. | Configurator `production_sheet` |
| 6 | Die sheet fetched trials, corrections and nitriding history but **never printed them**. | `die-technical-sheet.ts` |
| 7 | Quote terms were truncated to the first 5 lines. The placeholder "Configure bank details in Settings" was printed on customer documents. | `quote-pdf.ts` |
| 8 | Invoice was a plain text dump: no line-item table, no HSN-wise tax summary, no ruled totals. | `invoice-pdf.ts` |
| 9 | Vouchers were plain text lines with raw ISO dates and snake_case enums. | `finance-vouchers.ts` |
| 10 | PCDA reports printed "Label: value" lines with no structure. | `lib/reports/pcda/generator.ts` |
| 11 | Report Builder PDF had its layout code inside a React component, no subtotals, amounts with variable decimals, and UUIDs printed in cells. | `report-builder-client.tsx` |
| 12 | Standard (non-embedded) Helvetica: MuPDF-based viewers mis-measure "—" and "·", so right-aligned text overshot the margin and copy-paste was unreliable. | All |

---

## 2. What has been done

### 2.1 New files

| File | Purpose |
|------|---------|
| `lib/pdf/format.ts` | Deterministic formatters: `pdfAmount` (en-IN grouping, 2 dp), `pdfMoney` ("INR 1,23,456.00"), `pdfQuantity` (fixed dp and unit), `pdfNumber` (trimmed dp), `pdfInteger`, `pdfPercent`, `pdfDate` ("20 Oct 2026"; date-only strings printed as stored, timestamps converted to IST), `pdfDateTime` (IST), `pdfLabel` (snake_case to Title Case), `pdfText`, `pdfYesNo`, `joinParts`, `toNumber`, `PDF_BLANK` ("—"). |
| `lib/pdf/document-kit.ts` | **Shared layout engine.** `PdfDocumentWriter.create(identity, loadFont, content)`; see §3. |
| `lib/reports/report-builder-pdf.ts` | `buildReportBuilderPdf(input)`: landscape statement with column bands (7 per band), group heading rows, per-group subtotal rows, grand total, a statement-totals table, and a criteria block. Totals are kept separate per currency. UUID suffixes are removed from cells. |
| `public/fonts/pdf/noto-sans-devanagari-latin-400-normal.woff` and `-700-normal.woff` | Embedded Latin base font (copied by `scripts/sync-pdf-fonts.mjs`). |

### 2.2 Rewritten or modified files

| File | Change |
|------|--------|
| `lib/pdf/unicode-text.ts` | (a) Base font is now **embedded Noto Sans Latin** (subset, tabular digits) loaded through `PDF_BASE_FONT`, falling back to standard Helvetica if loading fails. (b) `draw()` accepts `rotate` (degrees), used for the vertical dimension label on elevations. |
| `lib/pdf/font-catalog.ts` | Added `PDF_BASE_FONT` and included it in `PDF_FONT_FILES`. |
| `lib/pdf/invoice-pdf.ts` | Full GST tax-invoice layout. Header: supplier block, title, and meta (Invoice No., date, due date, place of supply, supply type). Draft/cancelled stamp and notice. Billed-to and shipped-to panels. 9-column line table (#, description, HSN, qty kg, rate, taxable, GST %, GST, amount) with a total row. **HSN-wise tax summary** (CGST/SGST/UTGST or IGST) printed **only when line tax reconciles to the paisa** with `invoice.tax_total` (DB rule: `round(line_total × rate / 100, 2)`; the CGST remainder goes to the last group). Totals block, amount in words, payment status, notes, signatures. Signature and validation error message unchanged. |
| `lib/pdf/quote-pdf.ts` | Quotation on the engine, using relative imports only (no `@/` aliases). Panels, item table with total row, a physical/billing weight line, totals (GST rate printed only if it reproduces the stored GST; otherwise "line-wise rates"), amount in words, commercial terms, **all** T&C lines with hanging indents, bank details panel only when configured (string or object), and signatures. Only customer-safe fields are printed. |
| `lib/pdf/finance-vouchers.ts` | `buildVoucherPdf` rewritten on the engine. `VoucherDocument` gained optional `currency` and `linesTitle`. Builders now format dates and labels. `expenseVoucher` passes `currency`, and amount in words prints only for INR. Reversed documents get a void notice and stamp. Public API, titles and totals tuples are unchanged (tests rely on them). |
| `lib/pdf/systems-configurator-pdf.ts` | All 7 report types rebuilt. Full Unicode, footers on every page, scaled elevation (panel ratios, type labels, dimension lines, rotated height), cut lists at fixed 0.1 mm, totals rows, internal-costing confidentiality stamp and notice, a production sheet with **complete** lists plus an output checklist, an optimisation report per profile with bar tables, and signatures. Optional `loadFont`. |
| `lib/reports/pcda/die-technical-sheet.ts` | Rebuilt as 2-column spec grids (identity, geometry, material, performance) plus **trial, correction and nitriding history tables** (previously dropped). "Not Captured" is kept for absent values. |
| `lib/reports/pcda/profile-technical-sheet.ts` | Rebuilt as spec grids (identity, weight/geometry, alloy, production, die linkage, surface). |
| `lib/reports/pcda/generator.ts` | `generatePDF` rewritten. Report header meta, references, each section as a field grid (switches to 1 column when values are long), and signatures. CSV/Excel generators unchanged. |
| `components/modules/report-builder-client.tsx` | `exportPdf` now calls `buildReportBuilderPdf` and builds readable filter sentences. pdf-lib/`PdfTextKit` imports removed. New optional props `companyName` and `preparedBy`. |
| `app/(dashboard)/report-builder/page.tsx` | Passes `companyName={context.companyName}` and `preparedBy={context.fullName ?? null}`. |

### 2.3 Visually verified (rendered to PNG with PyMuPDF and inspected)

✅ Tax invoice (2 pages, continuation header) · ✅ Quotation · ✅ Credit note · ✅ Expense voucher · ✅ Reversed payment voucher · ✅ Configurator `customer_quote`, `production_sheet`, `optimization_report`, `internal_costing`.
Also confirmed: right-aligned text ends exactly at the 555.28 pt margin, and text extraction yields the correct Unicode for "—" and "·".

---

## 3. Engine reference (`lib/pdf/document-kit.ts`)

```ts
const doc = await PdfDocumentWriter.create({
  title: "TAX INVOICE", number: "INV/26-27/0142",
  issuer: { name, lines: [address, "GSTIN: …"] },
  meta: [["Invoice No.", …], ["Invoice date", pdfDate(…)]],   // empty values skipped
  stamp: { text: "Draft", tone: "warning" },                   // void | warning | neutral | positive
  orientation: "portrait" | "landscape", footerNote, subject
}, loadFont /* nodeFontLoader | browserFontLoader() */, rawData /* every string scanned for fonts */);

doc.notice(text, tone)            // full-width bordered banner
doc.panels([{ label, title, lines }])   // Bill to / Ship to / bank details
doc.sectionTitle("Tax summary", keepWithNext, { uppercase })
doc.fields([[label, value]], { columns: 1|2, labelRatio, blank })   // spec grid
doc.table(columns, rows, { size, emptyText })
//   columns: { header, width (relative weight), align, wrap? }  right-aligned = no wrap, shrink-to-fit
//   rows: string[] | { kind: "group" | "subtotal" | "total", cells }
//   header repeats after page breaks; a row taller than a page is split
doc.totals([{ label, value, emphasis }], { width })
doc.amountInWords(numberToWordsINR(x))
doc.paragraph(text) / doc.list(lines)   // list gives hanging indent for "1.", "a)", "-"
doc.signatures(["Prepared by", "Authorised signatory"], { forName: company })
return doc.finish();                    // draws footers (note · IST time · No. · Page x of y), sets metadata
```

Design system: A4, 40 pt margins, embedded Noto Sans, near-monochrome ink/greys, a 1.2 pt rule under the header, 0.9 pt rules on table edges, hairline row rules, filled header and total rows, figures right-aligned with tabular digits, "—" for blanks.

---

## 4. Where I stopped

I had just:
1. Rewritten `report-builder-client.tsx` to use `buildReportBuilderPdf` and passed `companyName`/`preparedBy` from the page (**done, on disk**).
2. Run a combined command that (a) updates `tests/report-builder-practicality.test.mjs` and (b) runs `npx tsc --noEmit`. **The user rejected this command, so neither happened.** The test file is **unchanged** and the typecheck has **not** run.

**Progress of the overall task: about 80%.** All generators are rewritten. Remaining: compile fixes, tests, visual QA of 4 document types, deployment font tracing, and a final review.

---

## 5. Pending work: exact steps for the next engineer

### 5.1 Update the Report Builder source test (required; otherwise `npm test` fails)
`tests/report-builder-practicality.test.mjs`:
- Append the new lib file to the concatenated source:
  ```js
  const component = readFileSync(new URL("../components/modules/report-builder-client.tsx", import.meta.url), "utf8")
    + readFileSync(new URL("../lib/reports/report-builder.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../lib/reports/report-builder-pdf.ts", import.meta.url), "utf8");
  ```
- Replace `assert.match(component, /Grouped by:/);` with
  `assert.match(component, /"Grouped by", grouping \? prettyFieldLabel\(grouping\)/);`
- `let activeGroupValue: string | null = null`, `prettyFieldLabel(grouping)…short(groupValue` and `PDF export failed` already exist in the lib or component.

### 5.2 Typecheck (`npm run typecheck`) and fix likely errors
These are expected tuple-inference errors: arrays returned from `.map` infer as `string[]` instead of `PdfField` (`[string, value]`). Fix each with `as PdfField` (import the type) or an explicit return type:
- `lib/pdf/finance-vouchers.ts`: `doc.details.map(([label, value]) => [label, value || null])`
- `lib/reports/pcda/generator.ts`: `section.fields.map((field) => [field.label, …])`
- `lib/reports/report-builder-pdf.ts`: `criteria.map(([label, value]) => [label || " ", value])`
- Check the `meta` arrays typed as `[string, string | null | undefined][]` (e.g. `["Status", label(...)]`) and the `as const` align literals inside the spread column arrays in `report-builder-pdf.ts`.
- `systems-configurator-pdf.ts` imports `../systems-configurator/output-status.ts` with a `.ts` extension. This is allowed (other files do it), but confirm Next.js builds it.
- The `PdfTableRow` union in `invoice-pdf.ts` and `quote-pdf.ts` (arrays mixed with `{ kind: "total" }` objects) should infer; annotate if not.

### 5.3 Run the full required checks (CLAUDE.md §12)
```bash
npm run lint
npm run typecheck
npm run build
npm test
```
Tests most likely to be affected: `tests/pdf-unicode-text.test.mjs` (base font now Noto Sans; assertions should still hold), `tests/invoice-pdf.test.mjs` (the one-item invoice must still be **1 page**; the HSN summary adds height, so if it spills to 2 pages, tighten spacing rather than change the test), `tests/pcda-reports.test.mjs` and `tests/report-builder-practicality.test.mjs`.

### 5.4 Visual QA still to do
Render and inspect: **die technical sheet** (with and without history rows), **profile technical sheet**, **PCDA `generatePDF`** (one short-value and one long-value template), **Report Builder PDF** (grouped, multi-band with more than 7 fields, multi-currency expenses, empty result). Also re-render the **invoice** after the column re-balance (widths changed after the last render) and a **Unicode-heavy** document (Devanagari, Gujarati and Tamil names).

How to render (PyMuPDF is installed):
```bash
# gen.mjs: import a builder via a relative path, call it with sample data, writeFileSync(out, bytes)
node --no-warnings --experimental-strip-types gen.mjs out.pdf
python -c "import fitz,sys;d=fitz.open('out.pdf');[p.get_pixmap(dpi=110).save(f'out-p{i+1}.png') for i,p in enumerate(d)]"
```
Check: no text past the margins (span `bbox[2] <= 555.28` in portrait, `<= 801.89` in landscape), no orphaned table headers, totals reconcile, footer on every page.

### 5.5 Deployment: font file tracing for server actions (important)
`next.config.ts` traces `public/fonts/pdf/**` only for `"/api/pdf/**/*"`. The die and profile sheets and PCDA `generatePDF` run as **server actions** (`lib/actions/pcda-reports.ts`) inside dashboard pages, and now load fonts through `nodeFontLoader`. The base font falls back to Helvetica, but **Indic script fonts throw** if the file is missing, which would fail the PDF on Vercel. Fix: add the pages that call these actions (e.g. die, profile and PCDA report pages, or a broader glob) to `outputFileTracingIncludes`, or move these generators to `/api/pdf/...` routes. Verify with `npm run build` and check `.next/server/**/*.nft.json`.

### 5.6 Final review
- Confirm `app/api/pdf/quote/[id]/route.ts` still works (it passes `{ company, settings, quote, items }`; `loadFont` is optional).
- Confirm the configurator route still enforces the internal-costing role check (route returns 403; the builder also throws).
- Customer-facing documents (quote, system quote, invoice, credit note) must print no cost, margin or supplier rate. This was verified by code reading only; re-check.
- Update `docs/BUGS_MEGA_PROGRESS_2026-10-19.md` / `BUGS-MEGA.md` if the team tracks PDF items (PDF-01…PDF-07) there.
- Delete the empty legacy file `lib/pdf/quote-pdf-new.ts` (0 bytes, pre-existing) only if the team agrees.
- Commit on a branch, without mixing in other agents' work.

---

## 6. Module status: complete list

| Module / document | Generator | Status | Remaining |
|---|---|---|---|
| Quotation | `lib/pdf/quote-pdf.ts` → `/api/pdf/quote/[id]` | ✅ Rewritten, visually verified | Typecheck and tests |
| Tax invoice | `lib/pdf/invoice-pdf.ts` → `/api/pdf/invoice/[id]` | ✅ Rewritten, verified | Re-render after width change; 1-page test |
| Credit note | `finance-vouchers.ts` → `/api/pdf/credit-note/[id]` | ✅ Verified | Typecheck (`details.map` tuple) |
| Expense voucher | `finance-vouchers.ts` → `/api/pdf/expense/[id]` | ✅ Verified | Same as above |
| Supplier payment voucher | `finance-vouchers.ts` → `/api/pdf/expense-payment/[id]` | ✅ Verified | Same as above |
| System quotation / cutting list / glass list / hardware BOM / internal costing / production sheet / optimisation | `lib/pdf/systems-configurator-pdf.ts` → `/api/pdf/systems-configurator/[id]/[type]` | ✅ Rewritten; 4 of 7 verified | Render `cutting_list`, `glass_list`, `hardware_bom` |
| Die technical sheet | `lib/reports/pcda/die-technical-sheet.ts` (server action) | ✅ Rewritten, ❌ not rendered | Visual QA; font tracing (§5.5) |
| Profile technical sheet | `lib/reports/pcda/profile-technical-sheet.ts` (server action) | ✅ Rewritten, ❌ not rendered | Visual QA; font tracing |
| PCDA reports (all templates in `lib/reports/pcda/templates.ts`) | `lib/reports/pcda/generator.ts` `generatePDF` | ✅ Rewritten, ❌ not rendered | Visual QA; typecheck; font tracing |
| Report Builder PDF export (browser) | `lib/reports/report-builder-pdf.ts` | ✅ Rewritten, ❌ not rendered | Test update (§5.1); visual QA |
| PCDA CSV / Excel exports | `generator.ts` `generateCSV` / `generateExcel` | ⏸ Not touched | Optional: the Excel export is an HTML table saved as `.xls` with no header styling. Consider a header row per section and numeric cells. |
| Report Builder CSV | `recordsToCsv` | ⏸ Not touched | Optional: CSV keeps the "(ID: uuid)" suffixes by design. |

**Not existing (possible follow-ups; not in scope unless requested):** customer payment receipt PDF, delivery challan / packing list / dispatch note PDF (dispatch is currently covered only by the PCDA dispatch report), purchase order PDF, NCR / quality certificate PDF (covered by the PCDA quality template). Building them on the engine takes about 60–120 lines each, following the `finance-vouchers.ts` pattern.

---

## 7. Conventions to keep
- Every PDF goes through `PdfDocumentWriter`. **Never** use `page.drawText` directly or strip non-ASCII characters.
- Pass all printable raw data as the third argument to `create()` so the script fonts get embedded.
- Format values with `lib/pdf/format.ts` only. Money is "INR" plus en-IN grouping; dates are `dd Mon yyyy`, and timestamps are in IST.
- Right-aligned columns are numbers and never wrap. Put the unit in the header ("Amount (INR)", "Qty (kg)") rather than in each cell.
- Use relative `.ts` imports in `lib/pdf/*` and `lib/reports/*` so `node --experimental-strip-types` tests can import them.
- Customer-facing documents: no cost, margin, profit, supplier rate or internal notes (CLAUDE.md §10).

---

## 8. Follow-up session: visual audit, fixes and verification (2026-10-20)

Work done on `codex/v1` in `.worktrees/codex-v1`, on top of `61a1530`.

### 8.1 Visual QA performed
Twenty-eight fixture documents (realistic Indian extrusion data) were rendered with PyMuPDF at 110 dpi and inspected page by page, plus automated checks on every page: no text outside the 40 pt margins, no overlapping spans, footer "Page x of y" present, no "?" replacement glyphs. Covered: tax invoice (intra-state 14 lines / 2 pages, inter-state draft, one-line, Devanagari/Gujarati/Tamil/Bengali/₹/Ł), quotation (full and empty), credit note (issued, reversed), expense voucher (INR, USD), payment voucher (posted, reversed), all 7 configurator outputs plus an empty draft production sheet and the restricted internal-costing refusal, die sheet (with and without history), profile sheet, PCDA dispatch (short values) and quality (long values), Report Builder (grouped multi-band receivables, multi-currency payables, empty). Arithmetic on invoice, quote, credit-note and voucher totals was reconciled by hand. A page-break sweep then rendered about 170 more documents (invoices, quotes and expense vouchers with 1–22 lines, die sheets with 0–14 trials, cutting lists, BOMs and production sheets with 0–40 cuts) and checked each page for margin overflow, overlaps, missing footers, headings stranded at a page bottom and pages holding only signatures.

### 8.2 Defects found and fixed
| # | Defect | Fix |
|---|--------|-----|
| 1 | `±`, `µ`, `²`, `³`, `½`, `≤`, `≥`, `→`, `⌀`, `✓` printed as "?" (the Noto Sans Devanagari Latin subset lacks them; the profile sheet itself prints "µm"). | Base face is now plain **Noto Sans** Latin (full Latin-1, `− ′ ″`); accented names use Noto Sans Latin-Ext; new `symbols` face (Noto Sans Math) for Greek, arrows, math operators, `⌀`, `✓`. New devDependencies `@fontsource/noto-sans`, `@fontsource/noto-sans-math` (OFL). `scripts/sync-pdf-fonts.mjs` copies by package (`PDF_FONT_SOURCES`) and removes unused subsets. |
| 2 | Amount in words was ambiguous: ₹53,100.59 → "…One Hundred and Fifty Nine Paise". Zero rupees printed "Rupees  and … Paise". | `numberToWordsINR` now writes "…One Hundred and Paise Fifty Nine Only" and "Rupees Zero and Paise Fifty Only". |
| 3 | Report Builder PDF lost every group subtotal and printed raw UUIDs in Statement totals when grouped by a linked field (customer, vendor, invoice): totals were computed from raw rows, groups from enriched rows. | `exportPdf` computes totals from the enriched `displayRows`. |
| 4 | Multi-currency grand totals said "(12 rows) · INR" and "(12 rows) · USD" (overall count). | `ReportTotals.countByCurrency`; subtotal, grand-total and statement rows print per-currency counts. |
| 5 | Footer note + timestamp cut off mid-sentence ("…Generated 20") on die/profile sheets. | Footer wraps onto a second line; the timestamp is never dropped. |
| 6 | Column headers and short words split mid-word ("Correctio/n", "Successf/ul"); dates wrapped ("15 Aug / 2026"). | Table cells and headers shrink up to 15% before any hard break; die-sheet date columns are `wrap: false`; die/configurator column weights rebalanced. |
| 7 | `pdfLabel` printed "Neft", "Rtgs", "Ifsc", "Dgu", "Out Of Tolerance". | Acronym list and lower-case joining words. |
| 8 | Report Builder printed raw enums (`partially_paid`, `raw_material`) and browser-locale dates ("30 Sept"; date-only values can shift a day west of UTC). | Enum-like fields (`…status/stage/type/method/category`) print as labels; dates use `pdfDate`. Client label "Vendor Name Snapshot" → "Vendor". |
| 9 | PCDA header "Generated on" used the server-locale date string (UTC on Vercel) and the footer used a different render time. | Both print `metadata.generatedAt` in IST; "Not Captured" references/revision are omitted from the header. |
| 10 | Expense/payment vouchers printed only the street line of the company address; blanks printed as "-". | Routes also select `city, state, pincode`; `joinParts` skips a city/state/PIN already in the street line; blanks print "—". |
| 11 | Signature block left alone on a new page (system quotation, empty production sheet, and in a row-count sweep: invoices with 5–8 lines, quotes, vouchers, die sheets). | Engine `closing(signers)`: from the closing section on, headings and each block's final line/row are placed only where the signature row still fits after them; the last table row travels with the signatures; signatures may use up to 10 pt less space. Called by every builder that signs off. Elevation max height 150 pt (the 3-panel system quote fits on one page). |
| 12 | Handover §5.5: die/profile sheets and PCDA PDFs (server actions) had no font files traced on Vercel. | `next.config.ts` traces `public/fonts/pdf/**` for `/dies/[id]`, `/profiles/[id]`, `/orders/[id]`, `/quotes/[id]`; verified in `.next/server/**/page.js.nft.json` (23 font files each). |
| 13 | PCDA Excel export (§6, optional): plain unstyled table; Excel turned 12-digit e-way bill numbers into 3.41E+11 and dropped leading zeros; booleans printed true/false. | Section title bands, Field/Value header row, column widths, long digit strings kept as text; CSV and Excel print Yes/No. |
| 14 | Quotation for a customer with no company name printed "Attn: <same name>" under the name. | Attn line only when a contact person differs from the company name. |

### 8.3 Tests
- New `tests/pdf-document-quality.test.mjs`: symbol coverage, label casing, address de-duplication, footer completeness and no mid-word splits (die sheet), Report Builder linked-group subtotals without UUIDs, per-currency counts, enum and date formatting.
- `tests/business-logic-regressions.test.mjs`: amount-in-words wording.
- `tests/report-builder-practicality.test.mjs`: source assertions follow the new group-label code and pin totals to `displayRows`.

### 8.4 Engine additions (for future documents)
- Section headings are held by `sectionTitle()` and drawn by the next block where it actually lands, so a heading never stays behind at a page bottom.
- `doc.closing(signers, { forName })` before the closing section, then `doc.signatures(signers, …)`; `doc.signatureHeight()` measures the row.
- `table(…, { keepWithNext })` keeps the last row with the following content.
- Table headers and wrapped cells shrink up to 15% before a word is split; use `wrap: false` for dates and codes that must stay on one line.

### 8.5 Still open (not changed here)
- Invoice supplier snapshot: candidate migration `supabase/migrations/20261020120000_invoice_supplier_snapshot_contact.sql` (new invoices also store city, state, PIN, phone and e-mail; PGlite test `tests/invoice-supplier-snapshot-contact.test.mjs` 7/7). **Not applied to the hosted database**; existing invoices keep their original snapshot. `sql/astra-integrity.sql` still holds the older reference copy of the function.
- The empty legacy `lib/pdf/quote-pdf-new.ts` was deleted (nothing referenced it).
- Report Builder CSV keeps the (ID: uuid) suffixes by design (§6).

---

## 9. Company logo and quotation fixes (2026-10-20, follow-up request)

### 9.1 Logo on every generated PDF
- Engine: `DocumentIdentity.logo` (PNG/JPEG bytes) is drawn above the issuer block on page 1 (max 170 × 36 pt) and small beside the company name on every continuation page. An unreadable image is left out; it never fails a document.
- Source: each tenant's `companies.logo_url` (Settings → Branding). `lib/pdf/logo.ts` accepts only `/brand/<file>.png|jpg` (shipped in `public/brand`) or this project's public Supabase Storage URLs (https, same host), PNG/JPEG magic bytes, ≤ 2 MB, 5 s timeout, no redirects, so a logo URL cannot make the server fetch other hosts.
- Wired into: quotation, tax invoice, credit note, expense voucher, supplier payment voucher, all 7 configurator outputs (`/api/pdf/*`), die and profile technical sheets and PCDA reports (server actions in `lib/actions/pcda-reports.ts`), and the browser Report Builder export (`loadLogoInBrowser`). `next.config.ts` traces `public/brand/**` with the fonts.
- Omalco: `public/brand/omalco-logo.png` (cropped from the supplied artwork, transparent, 1000 × 226). With the user's approval the live company row was updated: `logo_url = '/brand/omalco-logo.png'`, `legal_name` "Arnav Jain" → "Omalco Extrusions Pvt. Ltd.", `billing_address` "B-4 Pushpa Timber Complex\nPaharganj, New Del" → "B-4 Pushpa Timber Complex, Paharganj". The image is served by the app, so it appears on the hosted site once this branch is deployed.

### 9.2 Quotation PDF (checked against the live Omalco quotes)
| Problem | Fix |
|---|---|
| Heading printed the stored legal name (a person) with "Trade name:" underneath. | Every document heads with the trading name (`issuerName`); tax documents add "Legal name: …" only when it differs; quotations print no legal-name line. |
| Rate × billing weight did not equal the line amount (e.g. 4,069.8 kg × 398.15 ≠ 16,20,392.48), because `price_per_kg` is the line amount ÷ weight rounded to paise. | Column "Rate* (INR)" with a footnote stating that line amounts are exact and rates are rounded averages; the Total row adds the printed line amounts, and a red notice appears if they differ from the stored subtotal. |
| Quotes Q-2026-0013…0016 have totals but no line items. | The route refuses such quotes (409, "has no line items"). |
| Description repeated the profile code ("1098 - Profile Section 1098 …" beside the "1098" column). | Leading "<code> - " is dropped from the description. |
| Draft quotations looked final. | "Draft" stamp and a notice for status `draft` (route now selects `status`). |
| Bank details printed raw "a \| b \| c". | One account per line with the document's middle-dot separator. |

### 9.3 Still for the user
- GSTIN `24AABCS1234F1ZP` starts with 24 (Gujarat) while the address and state are Delhi; the state is stored as "Delhi NCR". Confirm the GSTIN and state in Settings; the invoice place-of-supply logic depends on them.
- The PCDA Excel/CSV exports carry no logo (spreadsheet formats).
