# Implementation Plan: PCDA Technical Enrichment

## Overview

This implementation plan transforms ExtrusionOS from a CRUD-style ERP into a data-rich, report-driven manufacturing system. The work is organized into phases: Core Data Model & Calculations (Phase 1), Master Data & Validation (Phase 1), Report Generator (Phase 2), Module Enrichment (Phase 3), and Workflow/Audit/Security (Phase 4).

All tasks follow the AGENTS.md engineering rules: business logic in `/lib`, server-side validation, RLS enforcement, no mock data, and additive migrations only.

---

## Phase 1: Core Data Model & Calculations

- [x] 1. Set up PCDA core types and interfaces
  - [x] 1.1 Create `/lib/pcda/types.ts` with `TechnicalLineItem` interface
    - Define the full `TechnicalLineItem` interface matching the design document field set
    - Include identity fields, Basic tab fields, Technical tab fields, Commercial tab fields, Costing tab fields
    - Add `QtyMethod` type alias for quantity calculation methods
    - Add `SourceRef` interface for line reuse tracking
    - _Requirements: 1.1, 1.2, 2.1–2.8, 3.1–3.4, 4.5_

  - [x] 1.2 Create field set constant and tab assignment map
    - Export `TECHNICAL_LINE_ITEM_FIELDS` as readonly array of field keys
    - Export `FIELD_TAB` map assigning each field to one of 8 tabs (Basic, Technical, Commercial, Costing, Quality, Documents, Reports, Audit)
    - Ensure the partition covers the full field set
    - _Requirements: 1.2, 5.3, 5.4_

  - [x] 1.3 Write property test for field set and tab partition identity
    - **Property 13: The Technical_Line_Item field set and tab partition are identical everywhere**
    - **Validates: Requirements 1.2, 5.1, 5.2, 5.3, 5.4**

- [x] 2. Implement Calculation Library core
  - [x] 2.1 Create `/lib/calculations/pcda/sentinel.ts`
    - Export `NOT_CAPTURED` symbol and `CalcResult` type (`number | typeof NOT_CAPTURED`)
    - Export `isCaptured` type guard function
    - _Requirements: 4.8, 4.12_

  - [x] 2.2 Create `/lib/calculations/pcda/rounding.ts`
    - Implement `roundWeight(value: number): number` (3 decimal places, half-up)
    - Implement `roundQuantity(value: number): number` (3 decimal places, half-up)
    - Implement `roundPercent(value: number): number` (2 decimal places, half-up)
    - Implement `roundMoney(value: number): number` (2 decimal places, half-up)
    - _Requirements: 4.11_

  - [x] 2.3 Write property test for rounding idempotence and precision
    - **Property 6: Rounding is half-up to the field's precision and idempotent**
    - **Validates: Requirements 4.11**

  - [x] 2.4 Create `/lib/calculations/pcda/weight.ts`
    - Implement `theoreticalWeight(lengthM, weightPerM, qty): CalcResult`
    - Implement `quantityKg(input): CalcResult` using the selected `QtyMethod`
    - Implement `weightVariance(actual, theoretical): CalcResult` (may be negative)
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.5 Write property tests for weight calculations
    - **Property 1: Quantity-in-kg uses exactly the selected method**
    - **Property 2: Weight variance is actual minus theoretical and may be negative**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 2.6 Create `/lib/calculations/pcda/recovery.ts`
    - Implement `recoveryPercent(outputGoodKg, inputBilletKg): CalcResult` (uncapped)
    - Implement `scrapPercent(scrapKg, inputBilletKg): CalcResult` (uncapped)
    - _Requirements: 4.4_

  - [x] 2.7 Write property test for recovery and scrap percentages
    - **Property 3: Recovery and scrap percentages are uncapped quotients**
    - **Validates: Requirements 4.4**

  - [x] 2.8 Create `/lib/calculations/pcda/cost.ts`
    - Implement `costPerKg(totalCost, qtyKg): CalcResult`
    - Implement `costPerMeter(totalCost, totalMeters): CalcResult`
    - Implement `costPerPiece(totalCost, pieces): CalcResult`
    - Implement `contributionMargin(netRevenue, variableCost): CalcResult`
    - Implement `basicPrice(parts: BasicPriceParts): number` with packing flag handling
    - Implement `netRateAndLineValue(input: PricingInput)` returning net rate and line value
    - _Requirements: 3.6, 3.7, 4.6, 4.7, 12.3_

  - [x] 2.9 Write property tests for cost calculations and packing flag
    - **Property 4: Cost ratios and contribution margin follow their formulas**
    - **Property 7: Packing charge is included exactly once when its flag is set**
    - **Validates: Requirements 3.6, 3.7, 4.6, 4.7**

  - [x] 2.10 Write property test for sentinel behavior
    - **Property 5: Absent, zero-divisor, or negative inputs yield the NOT_CAPTURED sentinel**
    - **Validates: Requirements 4.8, 4.12**

- [x] 3. Implement line reuse/copy utilities
  - [x] 3.1 Create `/lib/pcda/line-item.ts`
    - Implement `copyLineForReuse(source: TechnicalLineItem, ref: SourceRef): TechnicalLineItem`
    - Copy every defined field, preserve null/not-captured state, stamp source reference
    - Ensure downstream edits leave source unchanged (pure function)
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 3.2 Write property test for line reuse
    - **Property 12: Line reuse copies the full field set, preserves not-captured state, and is non-destructive**
    - **Validates: Requirements 1.3, 1.4, 1.5**

- [x] 4. Create not-captured label utilities
  - [x] 4.1 Create `/lib/pcda/labels.ts`
    - Export `Not_Captured_Label` constants ("Not Captured", "Missing Cost", "Pending Approval", "No Drawing Uploaded", "No Active Die Linked")
    - Export `mapCalcResultToDisplay(result: CalcResult, label?: string): string | number`
    - _Requirements: 1.9, 4.8, 4.9, 13.3, 24.1, 24.2_

  - [x] 4.2 Write property test for no-fabrication display
    - **Property 14: Absent values render a Not_Captured_Label and never a fabricated value**
    - **Validates: Requirements 1.9, 4.9, 7.4, 13.3, 14.4, 15.3, 18.2, 21.5, 24.1, 24.2**

- [x] 5. Checkpoint - Core calculation library complete
  - Ensure all property tests pass, ask the user if questions arise.

---

## Phase 1: Master Data & Validation

- [x] 6. Create database migrations for master data tables
  - [x] 6.1 Create migration for PCDA master catalog tables
    - Create `pcda_master_alloy_standards`, `pcda_master_alloys`, `pcda_master_tempers`
    - Create `pcda_master_uoms`, `pcda_master_packing_modes`, `pcda_master_qty_methods`
    - Create `pcda_master_profile_categories`, `pcda_master_die_types`, `pcda_master_finish_types`
    - Create `pcda_master_surface_treatments`, `pcda_master_defect_types`
    - Create `pcda_master_quality_parameters`, `pcda_master_cost_components`
    - Create `pcda_master_document_types`, `pcda_master_compliance_types`
    - Create `pcda_master_machine_types`, `pcda_master_production_stages`
    - Each table: `company_id NOT NULL REFERENCES companies(id)`, RLS enabled, policies scoped to `get_current_user_company_id()`, `company_id`-leading index, `is_active` boolean
    - _Requirements: 6.1, 6.2, 25.1, 25.2, 25.4_

  - [x] 6.2 Create RLS policies for master tables
    - SELECT policy using `company_id = get_current_user_company_id()`
    - INSERT/UPDATE/DELETE policy using same company scoping
    - _Requirements: 6.2, 25.2_

- [x] 7. Implement Master Data Service
  - [x] 7.1 Create `/lib/master-data/service.ts`
    - Implement `searchMaster(table, query, companyId)` with active filter, company scope, value-contains match, ≤50 results
    - Implement `deactivateMaster(table, id, companyId)` setting `is_active = false`
    - Implement `assertReferencesExist(alloyId, temperId, alloyStandardId, companyId)` validating against active masters
    - Implement deletion guard checking for existing references before allowing delete
    - Implement duplicate active value rejection
    - _Requirements: 6.3, 6.4, 6.6, 6.7, 6.8, 6.9_

  - [x] 7.2 Write property test for master search and selection
    - **Property 15: Master search and selection lists return only active, company-scoped, matching records**
    - **Validates: Requirements 6.4, 6.6, 6.8**

  - [x] 7.3 Write property test for master reference and duplicate enforcement
    - **Property 16: Master references and active-duplicate rules are enforced**
    - **Validates: Requirements 6.7, 6.9, 20.6**

- [x] 8. Implement Validation Service (shared Zod schemas)
  - [x] 8.1 Create `/lib/validations/pcda/line-item.ts`
    - Create Zod schema for `TechnicalLineItem` matching the interface
    - Numeric fields: `numeric, > 0, ≤ 999,999,999.99`, at most 2 decimal places for monetary/rate
    - GST: `0 ≤ value ≤ 100`, at most 2 decimals
    - Margin: signed range `−999,999,999.99 ≤ value ≤ 999,999,999.99`, at most 2 decimals
    - Weight tolerance: `≥ 0`
    - Text fields: section name/customer component code ≤200 chars, descriptions ≤500 chars
    - `Drawing_Approval_Status`: enum {Pending, Approved, Rejected}
    - _Requirements: 2.9, 2.11, 2.12, 2.13, 2.14, 2.15, 3.5, 3.9, 3.10, 20.1, 20.2, 20.3, 20.4_

  - [x] 8.2 Add packing flag conflict validation
    - Add refinement rejecting when both `include_packing_in_basic` and `packing_in_conversion` are true
    - _Requirements: 3.11_

  - [x] 8.3 Add min/max weight range validation
    - Add refinement rejecting when `min_weight > max_weight`
    - _Requirements: 2.12, 20.3_

  - [x] 8.4 Write property tests for numeric field validation
    - **Property 8: Numeric field validation accepts a value iff it satisfies that field's rule**
    - **Property 9: Weight range validation accepts iff minimum does not exceed maximum**
    - **Property 10: Text length and enum/flag rules are enforced exactly**
    - **Validates: Requirements 2.9, 2.11, 2.12, 2.13, 2.14, 2.15, 3.5, 3.9, 3.10, 3.11, 20.1–20.4**

- [x] 9. Add PCDA columns to existing line tables
  - [x] 9.1 Create migration to add PCDA columns to `quote_items`
    - Add all `TechnicalLineItem` fields as nullable columns
    - Add `source_record_id`, `source_line_id` for reuse tracking
    - Add `revision_number` defaulting to 1
    - Preserve existing columns, additive only
    - _Requirements: 1.2, 5.1, 12.1_

  - [x] 9.2 Create migration to add PCDA columns to `order_items`
    - Same column additions as quote_items
    - _Requirements: 1.2, 5.1_

  - [x] 9.3 Create migrations for production and dispatch line tables
    - Add PCDA columns to production batch/dispatch line tables as applicable
    - _Requirements: 1.2, 5.1_

  - [x] 9.4 Create `invoice_items` table if not exists
    - Full PCDA column set with company_id, RLS, indexes
    - _Requirements: 1.2, 5.1_

- [x] 10. Checkpoint - Phase 1 infrastructure complete
  - Ensure all migrations run cleanly, all property tests pass, ask the user if questions arise.

---

## Phase 2: Technical Report Generator

- [x] 11. Create report infrastructure
  - [x] 11.1 Create `technical_reports` table migration
    - `id`, `company_id`, `template_key`, `record_type`, `record_id`, `record_number`, `revision_number`, `storage_path`, `generated_by`, `generated_at`
    - RLS policies scoped to company_id
    - _Requirements: 7.6, 25.1, 25.2_

  - [x] 11.2 Create `/lib/reports/pcda/templates.ts`
    - Define template metadata for each report type: quote_line, order_line, profile_technical, die_technical, die_trial, production_batch, quality_inspection, packing, dispatch, export, compliance, profitability
    - Define section order for PCDA_Line_Report: [Section and Alloy Details, Basic Price, Charges, Calculated Summary, Options, Bottom Summary Line]
    - _Requirements: 8.1, 8.2_

  - [x] 11.3 Create `/lib/reports/pcda/builder.ts`
    - Implement `buildReportModel(templateKey, recordId, companyId)` populating from real persisted records
    - Include required header fields: company header, module name, report title, Record_Number, references, Revision_Number, generated date, generated-by user, approval status
    - Map absent fields to `Not_Captured_Label`
    - _Requirements: 7.1, 7.4, 8.2, 22.3_

  - [x] 11.4 Create `/lib/reports/pcda/generator.ts`
    - Implement `generatePDF(reportModel)` using `pdf-lib`
    - Implement `generateCSV(reportModel)` for templates supporting CSV
    - Implement `generateExcel(reportModel)` for templates supporting Excel
    - Implement `storeReport(file, storagePath)` writing to Supabase Storage under `<company_id>/reports/...`
    - _Requirements: 7.3, 7.6, 25.7_

  - [x] 11.5 Create `/lib/reports/pcda/readiness.ts`
    - Implement `checkReportReadiness(templateKey, recordId)` gating generation
    - Return `{ ready: boolean, missingFields: string[] }` for required fields and critical totals
    - _Requirements: 7.7_

- [x] 12. Implement customer sanitization
  - [x] 12.1 Create `/lib/pcda/sanitize.ts`
    - Implement `sanitizeForCustomer(line: TechnicalLineItem): SanitizedLineItem`
    - Omit fields: `internal_cost`, `supplier_rate`, `margin`, profit, `internal_note`
    - Omit entirely rather than masking inline
    - _Requirements: 5.5, 7.5, 12.4, 28.1, 28.3_

  - [x] 12.2 Write property test for customer sanitization
    - **Property 23: Customer-facing projections omit all restricted fields**
    - **Validates: Requirements 5.5, 7.5, 12.4, 14.1, 28.1, 28.2, 28.3_

  - [x] 12.3 Create `/lib/reports/pcda/customer-report.ts`
    - Wrap `buildReportModel` with `sanitizeForCustomer` for customer-facing templates
    - Apply to quote PDFs, order approval sheets, public share links
    - _Requirements: 7.5, 28.1_

  - [x] 12.4 Write property test for report model completeness
    - **Property 24: Report models contain all required header fields and gate on completeness**
    - **Validates: Requirements 7.1, 7.7, 8.2, 22.3**

- [x] 13. Create report server actions
  - [x] 13.1 Create `/app/actions/pcda-reports.ts`
    - Implement `generateReport(templateKey, recordId)` server action
    - Derive `company_id` from authenticated session
    - Check RBAC permissions for template
    - Call `checkReportReadiness`, return error if not ready
    - Generate PDF, store in Storage, create `technical_reports` row
    - Return download URL
    - _Requirements: 7.1–7.7, 8.3, 8.4, 25.3_

  - [x] 13.2 Implement profitability report access control
    - Restrict profitability report template to Owner_Admin and Finance_User roles
    - _Requirements: 8.4, 18.4, 29.3_

- [x] 14. Checkpoint - Report generator complete
  - Ensure report generation works for at least one template, all property tests pass, ask the user if questions arise.

---

## Phase 3: Module Data Enrichment

- [x] 15. Enrich Profile Master (aluminium_profiles)
  - [x] 15.1 Create migration adding PCDA columns to `aluminium_profiles`
    - Add: section_number, alloy_standard_id, alloy_id, temper_id, section_weight_kg_per_m, min_weight, max_weight, weight_tolerance, standard_length, finish_options, surface_treatment_ids, drawing_document_id, drawing_revision, drawing_approval_status
    - _Requirements: 10.1_

  - [x] 15.2 Create `entity_revisions` table for versioning
    - `id`, `company_id`, `entity_type`, `entity_id`, `revision_number`, `prior_state`, `actor_id`, `created_at`
    - Unique constraint on `(company_id, entity_type, entity_id, revision_number)`
    - RLS policies scoped to company_id
    - _Requirements: 22.1, 22.2_

  - [x] 15.3 Implement profile versioning in server actions
    - On profile update, create revision entry with prior state, increment `revision_number`
    - _Requirements: 10.3, 20.8, 22.1, 22.2_

  - [x] 15.4 Implement profile drawing approval gate
    - Block approval if no drawing uploaded unless Owner_Admin override supplied
    - _Requirements: 10.5, 21.1_

  - [x] 15.5 Write property test for versioning
    - **Property 20: Tracked changes record prior state and increment the revision number by one**
    - **Validates: Requirements 10.3, 20.8, 22.1, 22.2**

- [x] 16. Enrich Die Intelligence (dies)
  - [x] 16.1 Create migrations for die enrichment tables
    - Add columns to `dies`: die_type_id, cavity_count, correction_history (jsonb), linked_profile_id
    - Create `die_trials` table: id, company_id, die_id, trial_date, trial_data, result, created_by
    - Create `die_nitriding_history` table: id, company_id, die_id, nitriding_date, details, created_by
    - All with RLS and company_id indexes
    - _Requirements: 11.1_

  - [x] 16.2 Implement die status change audit
    - Record previous status, new status, actor, timestamp on status change
    - _Requirements: 11.3_

  - [x] 16.3 Implement nitriding maintenance alert trigger
    - On nitriding record, create maintenance alert via Workflow_Engine
    - _Requirements: 11.4, 19.11_

  - [x] 16.4 Implement die usability gate for production
    - Block production on blocked/retired/correction dies unless Owner_Admin override
    - _Requirements: 19.2, 21.2_

  - [x] 16.5 Write property test for gating with override
    - **Property 17: Gated actions are allowed iff their precondition holds or an Owner_Admin override is supplied**
    - **Validates: Requirements 10.5, 17.4, 19.2, 19.3, 19.8, 19.9, 21.1–21.4**

- [x] 17. Enrich CRM (customers)
  - [x] 17.1 Create migration adding PCDA columns to `customers`
    - Add: default_packing_requirements, required_certificates (array), default_alloy_standard_id, credit_terms, commercial_terms
    - _Requirements: 9.1_

  - [x] 17.2 Create `customer_compliance_requirements` table
    - Link required certificates to customers for Compliance_Checklist generation
    - _Requirements: 9.2_

  - [x] 17.3 Implement Compliance_Checklist derivation
    - When order created for customer, include customer's required certificates
    - _Requirements: 9.2, 19.7_

  - [x] 17.4 Write property test for derivations
    - **Property 18: Derivations are deterministic and derived checklists contain all source items**
    - **Validates: Requirements 9.2, 19.1, 19.4, 19.7**

- [x] 18. Enrich Quote Module
  - [x] 18.1 Update quote item server actions to use PCDA structure
    - Accept full `TechnicalLineItem` payload in create/update
    - Validate with shared Zod schema
    - Store to enriched `quote_items` table
    - _Requirements: 12.1_

  - [x] 18.2 Implement quote line drawing-pending flag
    - Set flag if section's `Drawing_Approval_Status !== "Approved"`
    - _Requirements: 12.5_

  - [x] 18.3 Write property test for drawing-pending flag
    - **Property 19: The quote-line drawing-pending flag is set iff the drawing is not approved**
    - **Validates: Requirements 12.5_

  - [x] 18.4 Implement quote-to-order conversion gate
    - Block conversion if drawing not approved unless Owner_Admin override
    - _Requirements: 19.3_

  - [x] 18.5 Apply customer sanitization to quote PDFs
    - Use `sanitizeForCustomer` for customer-facing quote outputs
    - _Requirements: 12.4_

- [x] 19. Enrich Order Module
  - [x] 19.1 Update order item creation to reuse PCDA quote lines
    - Copy every PCDA field from source quote line while preserving missing-data state
    - Stamp `source_record_id` and `source_line_id`
    - _Requirements: 1.3, 1.4, 1.5, 12.1_

  - [x] 19.2 Add order confirmation technical gates
    - Block confirmation when drawing approval is pending unless Owner_Admin override is supplied
    - Audit every override with actor, reason, and timestamp
    - _Requirements: 19.3, 21.7, 23.1_

  - [x] 19.3 Add PCDA order line report action
    - Generate dense technical-commercial report from persisted order line data
    - Show Not_Captured_Label values for absent fields
    - _Requirements: 7.1, 7.4, 8.1, 8.2_

- [x] 20. Enrich Configurator Module
  - [x] 20.1 Connect configurator section selection to Profile Master
    - Resolve frame, sash, mullion, beading, and accessory profile data from real profile records
    - _Requirements: 13.1, 13.2, 24.1_

  - [x] 20.2 Emit configured sections as PCDA line items
    - Generate cutting-list and BOM line outputs using the canonical TechnicalLineItem field set
    - _Requirements: 1.2, 13.1_

  - [x] 20.3 Replace configurator placeholder values
    - Display Not_Captured_Label values wherever master data is missing
    - _Requirements: 13.3, 24.2, 24.3_

- [x] 21. Enrich Production Planning
  - [x] 21.1 Add PCDA fields to production line/batch records
    - Store linked profile, die, alloy, temper, calculated quantity kg, billet input, output good, rejection, rework, and scrap values
    - _Requirements: 1.2, 4.1, 4.4, 16.3_

  - [x] 21.2 Implement production route derivation
    - Derive production route from profile finish and attributes using server-side Workflow_Engine
    - _Requirements: 19.1, 19.8, 19.10_

  - [x] 21.3 Add die and route readiness gates
    - Block production when die is blocked/retired/correction or route is incomplete unless allowed override exists
    - _Requirements: 19.2, 19.8, 21.2, 21.3_

  - [x] 21.4 Add production batch report
    - Generate production report with input/output/recovery/scrap and linked technical data
    - _Requirements: 7.1, 8.1, 16.3_

- [x] 22. Enrich Dispatch And Packing
  - [x] 22.1 Add PCDA fields to dispatch package/line records
    - Store packing mode, bundle quantity, pieces per bundle, kg per bundle, packing instructions, freight weight, and linked order line
    - _Requirements: 1.2, 2.7, 2.8_

  - [x] 22.2 Add dispatch quality gate
    - Block dispatch while related order quality approval is pending unless Owner_Admin override is supplied
    - _Requirements: 19.9, 21.4_

  - [x] 22.3 Add packing and dispatch reports
    - Generate reports from persisted package, order, quality, and transporter data
    - _Requirements: 7.1, 8.1, 24.1_

- [x] 23. Enrich Documents Module
  - [x] 23.1 Create document type master linkage
    - Link stored documents to `pcda_master_document_types` and real scoped entities
    - _Requirements: 15.1, 25.1_

  - [x] 23.2 Add document control metadata
    - Capture revision, version, approval status, expiry, certificate number, access level, and download history
    - _Requirements: 15.1, 22.1, 23.1_

  - [x] 23.3 Add document register reports
    - Generate document register, missing document, expiring certificate, and drawing revision reports
    - _Requirements: 7.1, 8.1, 15.1_

- [x] 24. Enrich Quality Module
  - [x] 24.1 Create quality inspection records and result lines
    - Link inspections to profile, die, order, production batch, quality plan, defect type, and inspector
    - _Requirements: 16.2, 25.1_

  - [x] 24.2 Update recovery from quality rejections
    - Recompute rejected weight, Recovery_Percent, Scrap_Percent, and profitability impacts from real quality results
    - _Requirements: 16.3, 19.12_

  - [x] 24.3 Add quality inspection report
    - Include measured values, defects, accepted/rejected/rework/scrap quantities, approval status, and certificate data
    - _Requirements: 8.1, 16.5_

- [x] 25. Enrich Energy And Maintenance
  - [x] 25.1 Link energy records to production batches
    - Capture meter/fuel usage, machine/press, shift, kg produced, cost per unit, and energy cost per kg
    - _Requirements: 15.2, 18.1_

  - [x] 25.2 Add maintenance technical records
    - Capture machine/die references, downtime, root cause, spares, technician, cost, photos/documents, and approval status
    - _Requirements: 16.1, 16.4_

  - [x] 25.3 Trigger die nitriding maintenance alerts
    - Create alert/workflow event when nitriding history is recorded
    - _Requirements: 11.4, 19.11_

- [x] 26. Enrich Tenders, Exports, And Compliance
  - [x] 26.1 Add tender checklist and required document records
    - Store technical eligibility, financial eligibility, required documents, profile requirements, costing, and approval workflow
    - _Requirements: 17.1, 17.4_

  - [x] 26.2 Add export shipment technical/compliance data
    - Capture HS code, packing list, container, ports, incoterms, certificates, gross/net weight, currency, and profitability
    - _Requirements: 17.2, 17.3_

  - [x] 26.3 Add compliance register
    - Capture certificate number, issuing authority, issue/expiry dates, linked product/order/customer, status, and renewal reminder
    - _Requirements: 17.2, 17.3_

  - [x] 26.4 Generate tender/export/compliance reports
    - Generate reports and readiness checklists from real stored records
    - _Requirements: 7.1, 8.1, 17.3_

- [x] 27. Enrich Profitability And Automation
  - [x] 27.1 Implement profitability calculation helpers
    - Compute material, billet, conversion, energy, labour, machine, maintenance, die, finishing, packing, freight, testing, rework, scrap, commission, discount, tax, gross margin, and contribution margin from real linked costs
    - _Requirements: 18.1, 18.2_

  - [x] 27.2 Add profitability access controls
    - Restrict profitability records and reports to Owner_Admin and Finance_User roles
    - _Requirements: 18.4, 29.3_

  - [x] 27.3 Add automation rule evaluation events
    - Evaluate rules against persisted records and record run status, failure reason, retry count, and audit metadata
    - _Requirements: 18.3, 19.10, 23.1_

- [x] 28. Enrich WhatsApp, QR, Scanner, And Mobile
  - [x] 28.1 Sanitize WhatsApp summaries
    - Include only real persisted customer-safe fields and exclude restricted internal commercial fields
    - _Requirements: 14.1, 28.1_

  - [x] 28.2 Generate QR payloads for real scoped entities
    - Encode entity type, entity id, and company scope for profile, die, billet batch, inventory batch, order, production batch, dispatch package, certificate, machine, maintenance, and document records
    - _Requirements: 14.2_

  - [x] 28.3 Resolve scanner payloads with authorization
    - Show only data the scanning user's company and role can access
    - _Requirements: 14.3, 25.5_

  - [x] 28.4 Write property test for QR payload round-trip
    - **Property 25: QR payloads round-trip to the same company-scoped record reference**
    - **Validates: Requirements 14.2**

- [x] 29. Implement Workflow, RBAC, Audit, And Versioning Core
  - [x] 29.1 Create Workflow_Engine decision helpers
    - Implement pure gate decisions for profile approval, die usability, quote-to-order conversion, route completeness, dispatch quality approval, and tender submission
    - _Requirements: 19.2, 19.3, 19.8, 19.9, 21.1, 21.2_

  - [x] 29.2 Extend RBAC permission matrix
    - Add Owner_Admin, Factory_Manager, Sales_User, Dealer_Admin, Dealer_Employee, Production_Manager, Quality_Manager, Maintenance_Manager, Finance_User, Dispatch_User, Compliance_User, and Viewer
    - _Requirements: 29.1, 29.2, 29.3, 29.4_

  - [x] 29.3 Implement audit decision helpers
    - Capture sensitive actions, tracked field changes, old/new values, actor, company_id, entity, action, reason, and timestamp
    - _Requirements: 23.1, 23.2, 23.4_

  - [x] 29.4 Implement versioning helpers
    - Create prior-state revision entries and increment revision numbers exactly once per tracked change
    - _Requirements: 22.1, 22.2_

  - [x] 29.5 Write property tests for workflow, RBAC, audit, and versioning
    - **Property 17: Gated actions are allowed iff their precondition holds or an Owner_Admin override is supplied**
    - **Property 20: Tracked changes record prior state and increment the revision number by one**
    - **Property 21: Sensitive actions and tracked-field changes are audited with full context**
    - **Property 22: RBAC decisions match the permission matrix and deny by default**

- [x] 30. Remove production-facing mock and placeholder data
  - [x] 30.1 Audit mock data usage
    - Search for `mockData`, `dummyData`, `sampleData`, fake records, placeholder charts, hardcoded KPIs, and static module records
    - _Requirements: 24.3, 24.5_

  - [x] 30.2 Replace production screens with real queries or empty states
    - Use real API/database data, real empty states, and Not_Captured_Label mapping
    - _Requirements: 24.1, 24.2, 24.5_

  - [x] 30.3 Keep seed/demo records isolated
    - Confine demo data to explicit development seed files only
    - _Requirements: 24.4_

- [x] 31. Final verification and rollout checklist
  - [x] 31.1 Run required checks
    - Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`; report commands that do not exist
    - _Requirements: AGENTS §12_

  - [x] 31.2 Verify security and tenancy
    - Confirm new tables have `company_id`, RLS policies, company-leading indexes, and no client service-role exposure
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.6_

  - [x] 31.3 Verify report and customer-output safety
    - Confirm customer-facing reports, WhatsApp summaries, public links, and approval sheets omit restricted internal fields
    - _Requirements: 28.1, 28.3_

  - [x] 31.4 Prepare completion report
    - Include audited modules, fields added, DB/model/API/frontend/report/workflow/RBAC/audit/mock-data changes, commands run, remaining gaps, files changed, and setup steps
    - _Requirements: AGENTS §13_

