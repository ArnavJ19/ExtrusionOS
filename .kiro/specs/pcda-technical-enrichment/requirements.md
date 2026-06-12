# Requirements Document

## Introduction

ExtrusionOS is a mature, multi-tenant vertical SaaS for aluminium extrusion MSMEs in India. This feature, **PCDA Technical Enrichment**, transforms ExtrusionOS from a competent CRUD-style ERP into a data-rich, factory-grade, report-driven manufacturing system comparable in technical depth to a reviewed competitor ERP referred to as "PCDA", while keeping the existing ExtrusionOS UI design language and never copying the competitor's interface.

The goal is to make every section, profile, quote line, order line, production batch, and dispatch carry deep, real, technical and commercial data — entered by users, imported, calculated from real records, or derived from linked modules. No screen, report, chart, or field may display invented, mock, hardcoded, or placeholder data. When data is absent, the system displays explicit empty-state labels such as "Not Captured", "Missing Cost", "Pending Approval", "No Drawing Uploaded", or "No Active Die Linked" instead of fabricating values.

The feature spans three layers:

1. A reusable **PCDA-style technical-commercial data structure** (master tables plus a shared line-item structure) usable across Profile Master, Configurator, AI Quotes, Manual Quotes, Orders, Production Planning, Dispatch, Invoices, Technical Reports, and customer approval sheets.
2. A **technical report generator** that produces dense PCDA-style documents (PDF/print/download, with optional CSV/Excel) across all enriched modules.
3. **Module-by-module data enrichment** plus **data-driven workflow rules** (auto-routing), **validation rules**, **versioning/audit**, and a **no-mock-data** mandate, all enforced server-side under multi-tenant RLS and RBAC.

This document is intentionally large and is structured so requirements can later be split into independent implementation phases. Requirements are grouped by capability area. Phase hints are noted in each group heading. All requirements follow EARS patterns and INCOSE quality rules. All new behaviour must respect the constraints already defined in `AGENTS.md`, `DATABASE_AND_RLS.md`, `BUSINESS_LOGIC_AND_CALCULATIONS.md`, `REPORTS_AND_PDFS.md`, and `UI_UX_GUIDELINES.md`.

## Glossary

### Platform And System Actors

- **ExtrusionOS**: The multi-tenant SaaS platform described in this document.
- **PCDA_Data_Model**: The reusable technical-commercial data structure (master tables plus shared line-item structure) introduced by this feature.
- **Technical_Line_Item**: A single enriched line-item record holding section/alloy details, basic price, charges, and technical calculations, shared across quotes, orders, production, dispatch, and invoices.
- **Calculation_Library**: The centralized calculation code located under `/lib` (for example `/lib/calculations`), which contains all PCDA technical and commercial formulas; no business calculation is duplicated inside React components.
- **Master_Data_Service**: The component that manages reusable catalog tables (alloy standards, alloys, tempers, UOMs, packing modes, and similar).
- **Profile_Master**: The aluminium profile / section master module (existing `aluminium_profiles`).
- **Die_Intelligence_Module**: The die tracking and analytics module (existing `dies` plus die-intelligence views).
- **Quote_Module**: The manual quotation module (existing `quotes` and `quote_items`).
- **AI_Quote_Module**: The AI quotation assistant module.
- **Configurator_Module**: The aluminium door/window systems configurator module.
- **Order_Module**: The customer order module (existing `orders`).
- **Production_Module**: The production planning and execution module (existing production jobs).
- **Dispatch_Module**: The dispatch and packing module (existing `dispatches`).
- **Invoice_Module**: The invoicing and payments module.
- **Quality_Module**: The quality tests, NCR, and complaints module.
- **CRM_Module**: The customer relationship management module (existing `customers`).
- **Document_Module**: The document storage and intelligence module (existing `documents`).
- **Energy_Module**: The energy consumption tracking module.
- **Maintenance_Module**: The machine maintenance module.
- **Tender_Module**: The tender/bid management module.
- **Export_Module**: The export documentation module.
- **Compliance_Module**: The compliance and certification module.
- **Profitability_Module**: The cost-and-margin analysis module.
- **Report_Generator**: The technical report generation component that produces PCDA-style PDF/print/CSV/Excel documents.
- **Workflow_Engine**: The server-side rules component that performs data-driven auto-routing and gating across modules.
- **Validation_Service**: The server-side input and business-rule validation component built on Zod schemas and database constraints.
- **Audit_Service**: The audit logging component (existing `audit_logs`).
- **Version_Service**: The component that records revision/version history for enriched entities.
- **Access_Control_Service**: The RBAC and RLS authorization component.

### Roles

- **Owner_Admin**: Owner or Administrator role with full company access.
- **Factory_Manager**: Role managing factory operations.
- **Sales_User**: Internal sales role.
- **Dealer_Admin**: Dealer organization administrator with dealer-scoped access.
- **Dealer_Employee**: Dealer staff with dealer-scoped access.
- **Production_Manager**: Role managing production planning and execution.
- **Quality_Manager**: Role managing quality inspection and results.
- **Maintenance_Manager**: Role managing machine maintenance.
- **Finance_User**: Role managing costing, invoices, and payments.
- **Dispatch_User**: Role managing dispatch and packing.
- **Compliance_User**: Role managing compliance and certifications.
- **Viewer**: Read-only role.

### Aluminium And Manufacturing Terms

- **Section**: A specific extruded aluminium cross-section; used interchangeably with profile in PCDA context.
- **Profile**: An aluminium extrusion product defined by a unique profile/section code within a company.
- **Alloy**: The aluminium alloy grade (for example 6063, 6061, 6082).
- **Alloy_Standard**: The standard governing the alloy (for example IS 733, EN AW, ASTM B221).
- **Temper**: The heat-treatment condition (for example T5, T6, O, H112).
- **Die**: The extrusion tool that forms a profile.
- **Billet**: A cast aluminium cylinder used as extrusion raw material.
- **Section_Weight_kg_per_m**: The theoretical mass of one metre of the profile, in kilograms per metre.
- **C_L**: Cut Length — the finished cut length of a section.
- **UOM**: Unit of Measure (for example meter, kg, piece, bundle, box, set).
- **Standard_Length**: The default mill/stock length of a profile.
- **Bundle**: A packed group of sections for dispatch.
- **Packing_Mode**: The packing method (for example loose, bundled, boxed, palletized, shrink-wrapped).
- **Quantity_Calculation_Method**: The rule used to derive billable quantity in kilograms (for example from length and weight per metre, from theoretical weight, or from actual weighed weight).
- **Theoretical_Weight**: Weight calculated from length and section weight per metre.
- **Actual_Weight**: Physically weighed output weight.
- **Weight_Variance**: The difference between actual weight and theoretical weight.
- **Weight_Tolerance**: The permitted plus/minus deviation on section weight per metre.
- **Recovery_Percent**: Accepted good output weight divided by input billet weight, as a percentage.
- **Scrap_Percent**: Scrap weight divided by input weight, as a percentage.
- **Recovery**: The general concept of usable output relative to input material.
- **Conversion_Charge**: The processing charge per kilogram for converting billet into extruded profile.
- **Alloy_Surcharge**: An additional per-kilogram charge tied to a specific alloy.
- **Re_Cutting_Charge**: A per-kilogram charge for re-cutting sections.
- **Testing_Service_Charge**: A per-kilogram charge for testing services.
- **Die_Service_Charge**: A charge for die-related services.
- **Basic_Price**: The base price of a line before taxes, discounts, and certain optional charges.
- **Net_Rate**: The final per-unit rate after charges, discounts, and margin, before tax where applicable.
- **Contribution_Margin**: Net revenue of a line minus its variable cost.
- **GST**: Goods and Services Tax (Indian indirect tax).
- **Finish**: The surface treatment of a profile (for example mill finish, powder coating, anodizing, wood finish, PVDF).
- **Surface_Treatment**: A category of finishing process applied to sections.
- **Nitriding**: A die surface-hardening maintenance process.
- **NCR**: Non-Conformance Report.
- **COA**: Certificate of Analysis for a billet batch.
- **Drawing_Revision**: The revision identifier of a profile/section technical drawing.
- **Drawing_Approval_Status**: The approval state of a drawing (for example draft, submitted, approved, rejected, superseded).
- **Production_Route**: The ordered sequence of production stages a profile must pass through, derived from its finish and attributes.
- **Quality_Plan**: The set of quality parameters and checks required for a profile, order, or batch.
- **Compliance_Checklist**: The set of certificates and documents required for a customer or export destination.

### PCDA Report Terms

- **PCDA_Line_Report**: A dense PCDA-style report for a single quote line or order line, structured as Section and Alloy Details, Basic Price, Charges, Calculated Summary, Options, and Bottom Summary Line.
- **Record_Number**: The human-readable identifier of the record a report is generated for (for example quote number, order number).
- **Revision_Number**: The revision counter for a record or report.
- **Not_Captured_Label**: The standard empty-state label set ("Not Captured", "Missing Cost", "Pending Approval", "No Drawing Uploaded", "No Active Die Linked") shown when source data is absent.

---

## Requirements

### Capability Area A — Reusable PCDA Data Structure (Phase 1)

#### Requirement 1: Shared Technical Line-Item Structure

**User Story:** As an Owner_Admin, I want a single reusable technical-commercial line-item structure shared across quotes, orders, production, dispatch, and invoices, so that section data is entered once and reused without re-keying.

#### Acceptance Criteria

1. THE ExtrusionOS SHALL provide a Technical_Line_Item structure that stores section/alloy details, basic-price details, charges, and technical calculations for a single section line.
2. WHERE a Technical_Line_Item is created in the Quote_Module, Order_Module, Production_Module, Dispatch_Module, or Invoice_Module, THE PCDA_Data_Model SHALL persist the identical defined Technical_Line_Item field set for that line, with no field added or omitted between modules.
3. WHEN a Technical_Line_Item is reused from an upstream record by a downstream module, THE ExtrusionOS SHALL copy the value of every field in the defined Technical_Line_Item field set into the corresponding downstream field, and SHALL preserve the not-captured state of any source field that has no captured value.
4. WHEN a Technical_Line_Item is reused from an upstream record, THE ExtrusionOS SHALL record on the downstream line a reference that identifies both the source record identifier and the source line identifier.
5. WHEN a downstream Technical_Line_Item is edited after reuse, THE ExtrusionOS SHALL persist the edited values only on the downstream line and SHALL leave the upstream source line and all of its field values unchanged.
6. IF a reuse is attempted where the source record does not exist, THEN THE ExtrusionOS SHALL block creation of the downstream line, make no change to stored data, and return a not-found error indication to the caller.
7. THE PCDA_Data_Model SHALL store every Technical_Line_Item with a `company_id` column that references `companies(id)`.
8. IF a request attempts to read or write a Technical_Line_Item whose `company_id` differs from the authenticated user's company, THEN THE Access_Control_Service SHALL deny the request, leave any stored line unchanged, and return an authorization error to the caller.
9. WHEN a Technical_Line_Item field that has no captured value is displayed, THE ExtrusionOS SHALL show the applicable Not_Captured_Label for that field and SHALL NOT display a numeric, default, or fabricated value in its place.
10. IF a reuse is attempted where the source record exists but its `company_id` differs from the authenticated user's company, THEN THE ExtrusionOS SHALL block creation of the downstream line, make no change to stored data, and return an authorization error indication to the caller.

#### Requirement 2: Section And Alloy Details Fields

**User Story:** As a Sales_User, I want to capture full section and alloy details on a line item, so that quotes and orders reflect exact manufacturing specifications.

#### Acceptance Criteria

1. THE PCDA_Data_Model SHALL store, for each Technical_Line_Item, the section number, section code, section name, customer component code, and component description.
2. THE PCDA_Data_Model SHALL store a drawing link, Drawing_Revision, and Drawing_Approval_Status for each Technical_Line_Item.
3. THE PCDA_Data_Model SHALL store the Alloy_Standard, Alloy, and Temper for each Technical_Line_Item.
4. THE PCDA_Data_Model SHALL store the C_L UOM, C_L per UOM, and C_L meter values for each Technical_Line_Item.
5. THE PCDA_Data_Model SHALL store the order UOM, order quantity, and quantity in kilograms for each Technical_Line_Item.
6. THE PCDA_Data_Model SHALL store Section_Weight_kg_per_m, minimum weight, maximum weight, and Weight_Tolerance for each Technical_Line_Item.
7. THE PCDA_Data_Model SHALL store the Quantity_Calculation_Method, Packing_Mode, invoice calculation UOM, Standard_Length, cut length, bundle quantity, and pieces-per-meter-per-kg-per-bundle values for each Technical_Line_Item.
8. THE PCDA_Data_Model SHALL store a packing instruction and a customer-specific packing requirement for each Technical_Line_Item.
9. IF a component description exceeding 500 characters is submitted, THEN THE Validation_Service SHALL reject the save, return an error indicating the description length violation, and leave any stored value unchanged.
10. WHEN the Alloy or Temper of a Technical_Line_Item references a master record, THE Master_Data_Service SHALL resolve the human-readable name from the master table rather than from free text.
11. WHEN Section_Weight_kg_per_m, minimum weight, maximum weight, order quantity, or quantity in kilograms is submitted, THE Validation_Service SHALL require each value to be numeric, greater than zero, and no greater than 999,999,999.99, and SHALL require Weight_Tolerance to be numeric and greater than or equal to zero.
12. IF minimum weight exceeds maximum weight on submission, THEN THE Validation_Service SHALL reject the save, return an error indicating the weight-range violation, and leave any stored values unchanged.
13. WHEN C_L per UOM, C_L meter, Standard_Length, cut length, bundle quantity, or any pieces-per-meter-per-kg-per-bundle value is submitted, THE Validation_Service SHALL require each value to be numeric, greater than zero, and no greater than 999,999,999.99.
14. WHEN a Drawing_Approval_Status is set, THE PCDA_Data_Model SHALL restrict it to one of Pending, Approved, or Rejected, and IF any other value is submitted THEN THE Validation_Service SHALL reject the save, return an error indicating the invalid status, and leave any stored value unchanged.
15. IF the section name or customer component code exceeds 200 characters, or the packing instruction or customer-specific packing requirement exceeds 500 characters, THEN THE Validation_Service SHALL reject the save, return an error indicating the offending field and length limit, and leave any stored value unchanged.

#### Requirement 3: Basic Price And Charges Fields

**User Story:** As a Finance_User, I want complete pricing and charge fields on each line, so that commercial calculations are accurate and auditable.

#### Acceptance Criteria

1. THE PCDA_Data_Model SHALL store, for each Technical_Line_Item, the material price, value-added service price, other charges, Basic_Price, packing charge, and freight charge.
2. THE PCDA_Data_Model SHALL store the Alloy_Surcharge per kilogram, Re_Cutting_Charge per kilogram, Testing_Service_Charge per kilogram, die cost, and Die_Service_Charge for each Technical_Line_Item.
3. THE PCDA_Data_Model SHALL store the packing-charge-included-in-conversion flag and the include-packing-in-basic flag as booleans defaulting to false for each Technical_Line_Item.
4. THE PCDA_Data_Model SHALL store the applicable GST percentage, discount, margin, Net_Rate, and final line value for each Technical_Line_Item.
5. WHEN any monetary or rate field other than margin is stored, THE Validation_Service SHALL require the value to be numeric, with at most two decimal places, bounded between 0.00 and 999,999,999.99 inclusive.
6. WHERE the include-packing-in-basic flag is enabled for a Technical_Line_Item, THE Calculation_Library SHALL include the packing charge within the Basic_Price computation exactly once for that line.
7. WHERE the packing-charge-included-in-conversion flag is enabled for a Technical_Line_Item, THE Calculation_Library SHALL include the packing charge within the conversion charge computation exactly once for that line.
8. IF a monetary or rate field is submitted with a non-numeric value, a value with more than two decimal places, or a value outside its defined range, THEN THE Validation_Service SHALL reject the save, return an error indicating the offending field and the violated rule, and leave all previously stored values for that Technical_Line_Item unchanged.
9. WHEN a GST percentage is submitted, THE Validation_Service SHALL require the value to be numeric, with at most two decimal places, bounded between 0 and 100 inclusive.
10. WHEN the margin field is stored, THE Validation_Service SHALL require the value to be numeric, with at most two decimal places, bounded between -999,999,999.99 and 999,999,999.99 inclusive.
11. IF both the include-packing-in-basic flag and the packing-charge-included-in-conversion flag are enabled for the same Technical_Line_Item, THEN THE Validation_Service SHALL reject the save, return an error indicating the conflicting packing-charge flags, and leave all previously stored values for that Technical_Line_Item unchanged.

#### Requirement 4: Technical Calculations

**User Story:** As a Production_Manager, I want technical weight, recovery, and cost calculations derived from real line data, so that I can trust factory and costing figures.

#### Acceptance Criteria

1. WHEN length expressed in meters, quantity, Section_Weight_kg_per_m, and a Quantity_Calculation_Method are present on a Technical_Line_Item, THE Calculation_Library SHALL compute quantity in kilograms using exactly the selected Quantity_Calculation_Method, where the method is one of: (a) length multiplied by Section_Weight_kg_per_m multiplied by quantity, (b) the recorded Theoretical_Weight value, or (c) the recorded Actual_Weight value.
2. THE Calculation_Library SHALL compute Theoretical_Weight as length expressed in meters multiplied by Section_Weight_kg_per_m multiplied by quantity for each Technical_Line_Item.
3. WHEN an Actual_Weight is recorded for a Technical_Line_Item, THE Calculation_Library SHALL compute Weight_Variance as Actual_Weight minus Theoretical_Weight, permitting negative results.
4. WHEN input billet weight and output good weight are present, THE Calculation_Library SHALL compute Recovery_Percent as output good weight divided by input billet weight multiplied by 100, and Scrap_Percent as scrap weight divided by input billet weight multiplied by 100, returning the computed values without capping at 100.
5. THE Calculation_Library SHALL store input billet weight, output good weight, rejected weight, rework weight, packing weight, and freight weight where these values are captured.
6. WHEN captured cost and quantity values are present, THE Calculation_Library SHALL compute cost per kilogram as total cost divided by quantity in kilograms, cost per meter as total cost divided by total meters, and cost per piece as total cost divided by piece quantity.
7. WHEN net revenue and variable cost are present, THE Calculation_Library SHALL compute Contribution_Margin as net revenue minus variable cost for each Technical_Line_Item.
8. IF a divisor used in any technical or commercial calculation is zero or absent, or the Quantity_Calculation_Method is absent, THEN THE Calculation_Library SHALL return a defined non-numeric sentinel and the ExtrusionOS SHALL display the applicable Not_Captured_Label rather than a computed number.
9. IF any cost component required for profitability is absent on a Technical_Line_Item, THEN THE Profitability_Module SHALL display a "Missing Cost" warning for that line instead of a profit figure.
10. THE Calculation_Library SHALL reside under `/lib` and SHALL NOT be duplicated inside React components.
11. THE Calculation_Library SHALL apply half-up rounding to the final returned value only, rounding weight and quantity outputs to three decimal places, percentage outputs to two decimal places, and monetary outputs to two decimal places.
12. IF length, quantity, Section_Weight_kg_per_m, or any captured weight or cost value used in a technical or commercial calculation is negative, THEN THE Calculation_Library SHALL return a defined non-numeric sentinel and the ExtrusionOS SHALL display the applicable Not_Captured_Label rather than a computed number.

#### Requirement 5: PCDA Structure Availability Across Modules

**User Story:** As an Owner_Admin, I want the PCDA structure available in every relevant module, so that the system feels uniformly technical end to end.

#### Acceptance Criteria

1. THE ExtrusionOS SHALL expose the Technical_Line_Item structure, using the same defined field set, for read and display in Profile_Master, Configurator_Module, AI_Quote_Module, Quote_Module, Order_Module, Production_Module, Dispatch_Module, Invoice_Module, the Report_Generator, and customer approval sheets.
2. WHERE a listed module supports Technical_Line_Item data entry, THE ExtrusionOS SHALL allow creation and update of the same defined Technical_Line_Item field set within that module.
3. WHERE a module presents a Technical_Line_Item for data entry, THE ExtrusionOS SHALL organize all defined fields under the progressive-disclosure tabs Basic, Technical, Commercial, Costing, Quality, Documents, Reports, and Audit, rendered in that left-to-right order, with each defined field assigned to exactly one tab.
4. THE ExtrusionOS SHALL apply the same field-to-tab assignment for the Technical_Line_Item structure across every listed module that supports data entry.
5. WHEN a customer approval sheet renders a Technical_Line_Item, THE ExtrusionOS SHALL omit the internal cost, margin, profit, supplier rate, and internal note fields entirely from that sheet.

### Capability Area B — Master Data Catalog (Phase 1)

#### Requirement 6: Master Data Tables

**User Story:** As an Owner_Admin, I want governed master tables for technical catalog values, so that line items use consistent, validated reference data instead of free text.

#### Acceptance Criteria

1. THE Master_Data_Service SHALL provide master tables for alloy standards, alloys, tempers, UOMs, packing modes, quantity calculation methods, profile categories, die types, finish types, surface treatment types, defect types, quality parameters, cost components, document types, compliance types, machine types, and production stages.
2. THE Master_Data_Service SHALL store every company-specific master table with a `company_id` column referencing `companies(id)`, RLS policies scoped to the authenticated user's company, indexes including `company_id`, and an active/inactive status flag.
3. IF deletion of a master record is attempted while one or more references to it exist, THEN THE Master_Data_Service SHALL reject the deletion, retain the record and all referencing records unchanged, and return a reference-conflict error indicating that referencing records prevent deletion.
4. WHEN a master record is marked inactive, THE Master_Data_Service SHALL set its status flag to inactive, retain the record so existing references remain resolvable, and exclude it from new-entry selection lists.
5. WHERE a master table supports global seed values, THE Master_Data_Service SHALL store seed values only through isolated development seed files and SHALL NOT inject seed values into production company data automatically.
6. WHEN a user types at least one character into a master value selection field, THE ExtrusionOS SHALL display a searchable dropdown that lists only active, company-scoped records whose values contain the typed text, returns updated results within 2 seconds, and limits the displayed list to a maximum of 50 matching records.
7. IF a Technical_Line_Item references an Alloy, Temper, or Alloy_Standard value that does not exist as an active record in the corresponding company-scoped master table, THEN THE Validation_Service SHALL reject the save with no partial persistence and return an error identifying the unrecognized field and value.
8. IF no active, company-scoped record matches the text typed into a master value selection field, THEN THE ExtrusionOS SHALL display an empty-result indication and SHALL NOT permit selection of a value that has no corresponding active master record.
9. IF a new master record is saved with a value that duplicates an existing active record within the same company and master table, THEN THE Master_Data_Service SHALL reject the save, retain existing records unchanged, and return a duplicate-value error identifying the conflicting value.

### Capability Area C — Technical Report Generator (Phase 2)

#### Requirement 7: PCDA-Style Report Generation

**User Story:** As a Factory_Manager, I want to generate dense PCDA-style technical reports from real records, so that internal teams and customers receive professional, accurate documents.

#### Acceptance Criteria

1. WHEN a user requests a technical report for a supported record, THE Report_Generator SHALL produce a document containing a company header, module name, report title, Record_Number, references, Revision_Number, generated date, generated-by user, and approval status.
2. THE Report_Generator SHALL include, where applicable to the report template, sections for technical details, commercial details, costing details, quality details, linked documents, notes, and signature.
3. THE Report_Generator SHALL support output as PDF and print, SHALL support download, and SHALL support optional CSV and Excel output where defined for the template.
4. WHEN the Report_Generator builds any report, THE Report_Generator SHALL populate every field from real persisted records or linked-module data and SHALL render the applicable Not_Captured_Label for absent values.
5. IF a customer-facing report is generated, THEN THE Report_Generator SHALL exclude internal cost, margin, profit, supplier rates, and internal notes from the output.
6. WHEN a report is generated, THE Report_Generator SHALL store the generated file in Supabase Storage under a company-scoped path and SHALL record report metadata in the document or report table.
7. IF required fields for a report are missing or critical totals fail validation, THEN THE Report_Generator SHALL block generation and SHALL return a descriptive error identifying the missing data.

#### Requirement 8: Required Report Templates

**User Story:** As an Owner_Admin, I want a defined set of report templates covering the full operation, so that every key entity can be documented.

#### Acceptance Criteria

1. THE Report_Generator SHALL provide templates for quote line, order line, profile technical sheet, die technical sheet, die trial report, production batch report, quality inspection report, packing report, dispatch report, export report, compliance report, and profitability report.
2. WHEN the Report_Generator produces a PCDA_Line_Report for a quote line or order line, THE Report_Generator SHALL structure the document with the sections Section and Alloy Details, Basic Price, Charges, Calculated Summary, Options, and Bottom Summary Line in that order.
3. WHERE a report template is restricted to specific roles, THE Access_Control_Service SHALL deny report generation and download to roles outside the permitted set.
4. WHEN a profitability report is requested, THE Access_Control_Service SHALL restrict access to Owner_Admin and Finance_User roles.

### Capability Area D — Module Data Enrichment (Phase 3)

#### Requirement 9: CRM Enrichment

**User Story:** As a Sales_User, I want richer customer technical and commercial data, so that customer-specific requirements drive downstream documents.

#### Acceptance Criteria

1. THE CRM_Module SHALL store, per customer, default packing requirements, required certificates, default Alloy_Standard preferences, and credit/commercial terms in addition to existing contact fields.
2. WHEN a customer has required certificates defined, THE Workflow_Engine SHALL include those certificates in the Compliance_Checklist for that customer's orders.
3. WHERE a user is a Dealer_Admin or Dealer_Employee, THE Access_Control_Service SHALL restrict CRM data visibility to dealer-scoped customers only.
4. THE CRM_Module SHALL provide a customer technical-and-commercial summary report through the Report_Generator.

#### Requirement 10: Profile And Section Master Enrichment

**User Story:** As a Production_Manager, I want the Profile_Master to hold full PCDA technical fields, so that every profile carries factory-grade specifications.

#### Acceptance Criteria

1. THE Profile_Master SHALL store, per profile, the section number, Alloy_Standard, Alloy, Temper, Section_Weight_kg_per_m, minimum weight, maximum weight, Weight_Tolerance, Standard_Length, finish options, Surface_Treatment types, and drawing reference with Drawing_Revision and Drawing_Approval_Status.
2. THE Validation_Service SHALL enforce uniqueness of the section number within a company.
3. WHEN a profile drawing is updated, THE Version_Service SHALL record the previous Drawing_Revision and the change in version history.
4. THE Profile_Master SHALL provide a profile technical sheet report through the Report_Generator.
5. IF a profile is marked approved but has no uploaded drawing, THEN THE Validation_Service SHALL block the approval unless an Owner_Admin override is supplied.

#### Requirement 11: Die Intelligence Enrichment

**User Story:** As a Factory_Manager, I want enriched die technical and trial data, so that die readiness and performance are fully documented.

#### Acceptance Criteria

1. THE Die_Intelligence_Module SHALL store, per die, die type, cavity count, correction history, nitriding history, trial records, and linked profile technical references in addition to existing die fields.
2. THE Die_Intelligence_Module SHALL provide a die technical sheet report and a die trial report through the Report_Generator.
3. WHEN a die status changes, THE Audit_Service SHALL record the previous status, new status, actor, and timestamp.
4. WHEN nitriding is recorded for a die, THE Workflow_Engine SHALL create a maintenance alert in the Maintenance_Module for that die.

#### Requirement 12: AI Quote And Manual Quote Enrichment

**User Story:** As a Sales_User, I want AI and manual quotes to use the full PCDA line structure, so that quotes are technically complete and consistent.

#### Acceptance Criteria

1. THE AI_Quote_Module and the Quote_Module SHALL build each quote line as a Technical_Line_Item using the PCDA_Data_Model.
2. WHEN the AI_Quote_Module proposes a quote line, THE AI_Quote_Module SHALL populate technical fields only from real Profile_Master, Die_Intelligence_Module, and Master_Data_Service records, and SHALL display the applicable Not_Captured_Label for values it cannot source.
3. WHEN a quote line is priced, THE Calculation_Library SHALL compute Basic_Price, charges, margin, Net_Rate, GST, and final line value.
4. WHERE a quote PDF is customer-facing, THE Report_Generator SHALL exclude internal cost, margin, profit, supplier rates, and internal notes.
5. WHEN a quote line's section has a drawing whose Drawing_Approval_Status is not approved, THE Workflow_Engine SHALL flag the quote line as drawing-approval-pending.

#### Requirement 13: Configurator Enrichment

**User Story:** As a Sales_User, I want the Configurator_Module to emit PCDA line items, so that configured systems flow into quotes and production with full technical data.

#### Acceptance Criteria

1. WHEN the Configurator_Module generates a cutting list, glass list, or hardware BOM, THE Configurator_Module SHALL emit each resulting section as a Technical_Line_Item using the PCDA_Data_Model.
2. THE Configurator_Module SHALL derive Section_Weight_kg_per_m, Alloy, and Temper for each configured section from linked Profile_Master records.
3. IF a configured section has no linked Profile_Master record, THEN THE Configurator_Module SHALL display "No Active Die Linked" or "Not Captured" for the dependent technical values rather than fabricating them.

#### Requirement 14: WhatsApp, QR Generation, Scanner, And Mobile Enrichment

**User Story:** As a Factory_Manager, I want communications, QR, scanner, and mobile surfaces to carry real technical references, so that field operations stay traceable.

#### Acceptance Criteria

1. WHEN a WhatsApp summary is generated for a record, THE ExtrusionOS SHALL include only real persisted values and SHALL exclude internal cost, margin, profit, supplier rates, and internal notes.
2. WHEN a QR code is generated for a bundle, die, profile, or dispatch, THE ExtrusionOS SHALL encode a reference to a real persisted record scoped to the company.
3. WHEN a QR code is scanned, THE Scanner SHALL resolve and display only data the scanning user's role and company are authorized to view.
4. WHERE the mobile surface displays technical line data, THE ExtrusionOS SHALL render the same Not_Captured_Label behaviour as the desktop surface for absent values.

#### Requirement 15: Documents And Energy Enrichment

**User Story:** As an Owner_Admin, I want documents and energy data linked to technical records, so that traceability and profitability use real linked data.

#### Acceptance Criteria

1. THE Document_Module SHALL associate each stored document with a document type from the Master_Data_Service and a real related entity scoped to the company.
2. WHEN energy consumption is recorded for a production batch, THE Energy_Module SHALL link the record to the real production batch and SHALL make the value available to the Profitability_Module.
3. IF a profitability calculation requires energy cost that has not been captured, THEN THE Profitability_Module SHALL display "Missing Cost" for the energy component rather than assuming a value.

#### Requirement 16: Maintenance And Quality Enrichment

**User Story:** As a Quality_Manager, I want enriched maintenance and quality data linked to dies, machines, and batches, so that quality outcomes affect production and profitability accurately.

#### Acceptance Criteria

1. THE Maintenance_Module SHALL store, per maintenance record, machine type, maintenance type, downtime duration, and linked machine or die references from the Master_Data_Service and real records.
2. THE Quality_Module SHALL store, per inspection, the applied Quality_Plan parameters, measured values, defect types, and result status, all referencing Master_Data_Service catalogs.
3. WHEN a quality inspection records a rejection, THE Calculation_Library SHALL update the related batch's rejected weight and recompute Recovery_Percent and Scrap_Percent.
4. WHEN machine downtime is recorded, THE Profitability_Module SHALL include the downtime's cost impact in the affected production batch's cost where downtime cost is captured.
5. THE Quality_Module SHALL provide a quality inspection report through the Report_Generator.

#### Requirement 17: Tenders, Exports, And Compliance Enrichment

**User Story:** As a Compliance_User, I want tender, export, and compliance data driven by real checklists, so that submissions and shipments meet requirements.

#### Acceptance Criteria

1. THE Tender_Module SHALL store, per tender, a technical specification checklist and required document list referencing the Master_Data_Service.
2. WHEN an export shipment specifies a destination country, THE Workflow_Engine SHALL derive the applicable Compliance_Checklist for that country.
3. THE Export_Module SHALL provide an export report and THE Compliance_Module SHALL provide a compliance report through the Report_Generator.
4. IF a tender's required document checklist is incomplete, THEN THE Workflow_Engine SHALL block tender submission until the checklist is satisfied or an Owner_Admin override is supplied.

#### Requirement 18: Profitability And Automation Enrichment

**User Story:** As a Finance_User, I want profitability computed from real linked costs and automation driven by real events, so that margin reporting is trustworthy.

#### Acceptance Criteria

1. THE Profitability_Module SHALL compute line, order, and batch profitability from real captured cost components, energy data, maintenance impact, and quality outcomes.
2. IF any required cost component is absent, THEN THE Profitability_Module SHALL display the applicable Not_Captured_Label for that component and SHALL exclude it from the computed profit rather than substituting a default.
3. WHEN an automation rule triggers, THE Workflow_Engine SHALL evaluate the rule against real persisted records and SHALL record the triggering event and outcome.
4. THE Profitability_Module SHALL provide a profitability report restricted to Owner_Admin and Finance_User roles through the Report_Generator.

### Capability Area E — Data-Driven Workflow Rules (Phase 4)

#### Requirement 19: Server-Side Auto-Routing And Gating

**User Story:** As a Production_Manager, I want the system to route and gate work based on real data, so that invalid operations are prevented rather than merely warned against.

#### Acceptance Criteria

1. WHEN a profile's finish is set, THE Workflow_Engine SHALL derive the Production_Route for that profile from its finish and attributes.
2. IF a die's status is blocked, retired, correction, or otherwise non-usable, THEN THE Workflow_Engine SHALL prevent production on that die unless an Owner_Admin override is supplied.
3. IF a section's Drawing_Approval_Status is not approved, THEN THE Workflow_Engine SHALL prevent conversion of the related quote to an order and SHALL prevent order confirmation unless an Owner_Admin override is supplied.
4. WHEN a line's Alloy and Temper are set, THE Workflow_Engine SHALL derive the billet requirement for that line.
5. WHEN Section_Weight_kg_per_m is set, THE Calculation_Library SHALL use it to drive quantity-in-kilograms and costing calculations.
6. WHEN a Packing_Mode is set, THE Workflow_Engine SHALL drive packing and dispatch handling from that Packing_Mode.
7. WHEN a Quality_Plan is assigned, THE Workflow_Engine SHALL generate the inspection checklist from that plan.
8. IF a production batch's Production_Route is incomplete, THEN THE Workflow_Engine SHALL prevent the batch from advancing past the incomplete stage.
9. IF a dispatch is attempted while the related order's quality approval is pending, THEN THE Workflow_Engine SHALL block the dispatch unless an Owner_Admin override is supplied.
10. THE Workflow_Engine SHALL enforce all routing and gating rules server-side and SHALL NOT rely solely on client-side warnings.
11. WHERE nitriding usage is recorded, THE Workflow_Engine SHALL trigger a maintenance alert.
12. WHEN quality rejection is recorded, THE Workflow_Engine SHALL update recovery and profitability for the affected batch.

### Capability Area F — Validation Rules (Phase 4)

#### Requirement 20: Numeric And Technical Validation

**User Story:** As an Owner_Admin, I want strict validation of technical and commercial fields, so that bad data cannot enter the system.

#### Acceptance Criteria

1. WHEN a numeric field is submitted, THE Validation_Service SHALL require the value to be numeric and, where defined, positive.
2. WHEN Section_Weight_kg_per_m is submitted, THE Validation_Service SHALL require the value to be greater than zero.
3. WHEN minimum and maximum weight are submitted, THE Validation_Service SHALL require minimum weight to be less than or equal to maximum weight.
4. WHEN order quantity is submitted, THE Validation_Service SHALL require the value to be greater than zero.
5. WHEN quantity in kilograms is submitted, THE Validation_Service SHALL require the value to match the result of the line's Quantity_Calculation_Method within the configured tolerance.
6. WHEN an Alloy or Temper is submitted, THE Validation_Service SHALL require the value to exist in the corresponding master table.
7. WHEN a profile section number is submitted, THE Validation_Service SHALL enforce company-scoped uniqueness.
8. WHEN a drawing is updated, THE Version_Service SHALL record the Drawing_Revision change.

#### Requirement 21: Approval And Scope Validation

**User Story:** As a Compliance_User, I want approval gates and scope checks enforced, so that overrides are explicit and access stays correct.

#### Acceptance Criteria

1. IF a profile is approved without an uploaded drawing, THEN THE Validation_Service SHALL block the approval unless an Owner_Admin override is supplied.
2. IF a die whose status is blocked, retired, or correction is selected for production, THEN THE Validation_Service SHALL block the selection unless an Owner_Admin override is supplied.
3. IF a production batch's Production_Route is incomplete, THEN THE Validation_Service SHALL block production start.
4. IF a dispatch is attempted while quality approval is pending, THEN THE Validation_Service SHALL block the dispatch.
5. WHEN profitability is displayed and a required cost is missing, THE Profitability_Module SHALL display a missing-cost warning.
6. WHEN a Dealer_Admin or Dealer_Employee submits a request, THE Access_Control_Service SHALL enforce dealer-scoped data access for that request.
7. WHEN an Owner_Admin override is applied to any gated action, THE Audit_Service SHALL record the override actor, reason, and timestamp.

### Capability Area G — Versioning And Audit (Phase 4)

#### Requirement 22: Versioning And Revision History

**User Story:** As an Owner_Admin, I want revision history on enriched entities, so that technical and commercial changes are traceable over time.

#### Acceptance Criteria

1. WHEN a Technical_Line_Item, profile, die, drawing, quote, or order is modified, THE Version_Service SHALL record a revision entry capturing the prior state, actor, and timestamp.
2. THE Version_Service SHALL increment a Revision_Number for each tracked entity when a tracked change is committed.
3. WHEN a report is generated, THE Report_Generator SHALL include the current Revision_Number of the source record.
4. WHERE a revision history is requested, THE ExtrusionOS SHALL present it under the Audit tab of the entity's detail page.

#### Requirement 23: Audit Logging Of Sensitive Actions

**User Story:** As an Owner_Admin, I want sensitive actions audited, so that critical changes are accountable.

#### Acceptance Criteria

1. WHEN a create, edit, delete, approve, reject, or override action occurs on an enriched entity, THE Audit_Service SHALL record the action type, actor, entity, and timestamp.
2. WHEN a price change, drawing change, die-status change, profile-weight change, alloy/temper change, costing change, dispatch-status change, or quality-result change occurs, THE Audit_Service SHALL record the change with prior and new values.
3. THE Access_Control_Service SHALL restrict audit log visibility to Owner_Admin.
4. THE Audit_Service SHALL store every audit record with the `company_id` of the acting user's company.

### Capability Area H — No Mock Data Mandate (Cross-Phase)

#### Requirement 24: Elimination Of Mock And Placeholder Data

**User Story:** As an Owner_Admin, I want guaranteed real data everywhere, so that the system is trustworthy as a factory record of truth.

#### Acceptance Criteria

1. THE ExtrusionOS SHALL populate every production-facing technical field from user entry, import, calculation from real records, or data derived from linked modules.
2. IF a production-facing field has no real source value, THEN THE ExtrusionOS SHALL display the applicable Not_Captured_Label and SHALL NOT display a fabricated, hardcoded, or placeholder value.
3. THE ExtrusionOS SHALL NOT render mock charts, placeholder dashboards, or sample numeric values on any production-facing screen or report.
4. WHERE demo or seed data is required, THE ExtrusionOS SHALL confine it to isolated development seed files and SHALL NOT load it into production company tenants.
5. WHEN an existing production-facing screen or report contains mock, hardcoded, or placeholder data, THE ExtrusionOS SHALL replace it with a real query result or a real empty state.

### Capability Area I — Non-Functional And Constraint Requirements (Cross-Phase)

#### Requirement 25: Multi-Tenancy And Security

**User Story:** As an Owner_Admin, I want every new table and surface to enforce tenant isolation, so that no company can access another company's data.

#### Acceptance Criteria

1. THE ExtrusionOS SHALL include a `company_id` column referencing `companies(id)` on every new company-specific table introduced by this feature.
2. THE ExtrusionOS SHALL enable RLS on every new company-specific table and SHALL define safe SELECT, INSERT, UPDATE, and DELETE policies scoped to the user's company.
3. THE Access_Control_Service SHALL derive `company_id` from the authenticated user server-side and SHALL NOT trust a `company_id` supplied by the frontend.
4. THE ExtrusionOS SHALL add indexes that include `company_id` for every new company-specific table.
5. WHERE a user is a Dealer_Admin or Dealer_Employee, THE Access_Control_Service SHALL restrict all reads and writes to dealer-scoped data.
6. THE ExtrusionOS SHALL NOT expose the Supabase service role key to any client component or browser-executed code.
7. WHERE storage files are produced by this feature, THE ExtrusionOS SHALL store them under company-scoped paths and SHALL serve them through authorized, company-scoped access.

#### Requirement 26: Safe Additive Migrations

**User Story:** As an Owner_Admin, I want all schema changes to be safe and additive, so that existing production data is never lost.

#### Acceptance Criteria

1. THE ExtrusionOS SHALL implement all schema changes for this feature as additive migrations.
2. THE ExtrusionOS SHALL NOT drop tables, drop columns, or rename columns without an explicit approval and a backfill strategy.
3. WHEN a new table is added, THE ExtrusionOS SHALL add its RLS policies and indexes in the same migration or immediately afterward.
4. WHEN a NOT NULL column is added to an existing populated table, THE ExtrusionOS SHALL backfill existing rows before enforcing the constraint.

#### Requirement 27: Performance And Pagination

**User Story:** As a Factory_Manager, I want list and report screens to stay fast, so that the dense data does not slow the system.

#### Acceptance Criteria

1. WHEN a database/list page renders enriched records, THE ExtrusionOS SHALL use server-side pagination with a default page size of 10 rows.
2. WHEN a status board renders on an overview page, THE ExtrusionOS SHALL limit each status group to a small record count and SHALL provide a "View Database" action for the full paginated list.
3. WHEN a list query is executed, THE ExtrusionOS SHALL apply company-scoped filters and indexed columns to constrain the result set server-side.
4. THE ExtrusionOS SHALL NOT fetch entire tables into the frontend for client-side-only pagination.

#### Requirement 28: Customer Data Sanitization

**User Story:** As a Sales_User, I want customer-facing outputs sanitized, so that internal commercial data is never leaked.

#### Acceptance Criteria

1. WHEN a customer-facing view, PDF, public share link, or approval sheet is produced, THE ExtrusionOS SHALL exclude internal cost, margin, profit, supplier rates, and internal notes.
2. WHEN a public share link is created, THE ExtrusionOS SHALL use an unguessable token and SHALL expose only safe customer-facing fields.
3. IF a customer-facing output would otherwise include a restricted field, THEN THE ExtrusionOS SHALL omit the field rather than masking it inline with internal context.

#### Requirement 29: RBAC Enforcement

**User Story:** As an Owner_Admin, I want role-based access enforced across enriched features, so that each role sees and does only what is permitted.

#### Acceptance Criteria

1. THE Access_Control_Service SHALL recognize the roles Owner_Admin, Factory_Manager, Sales_User, Dealer_Admin, Dealer_Employee, Production_Manager, Quality_Manager, Maintenance_Manager, Finance_User, Dispatch_User, Compliance_User, and Viewer.
2. WHEN any sensitive create, edit, delete, approve, reject, or override action is attempted, THE Access_Control_Service SHALL authorize it server-side against the actor's role.
3. WHERE a feature exposes costing, margin, or profitability data, THE Access_Control_Service SHALL restrict access to Owner_Admin and Finance_User roles.
4. WHEN a Viewer accesses any enriched surface, THE Access_Control_Service SHALL permit read-only operations and SHALL deny create, edit, delete, approve, reject, and override operations.
