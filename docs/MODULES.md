# Modules — ExtrusionOS

This document defines the major product modules and expected responsibilities.

## 1. Dashboard / Command Center

Purpose:

Owner-level and team-level visibility.

Should show:

- Quotes this month
- Quote value
- Order value
- Orders in production
- Pending dispatches
- Delayed orders
- Receivables
- Overdue payments
- Low inventory
- Scrap/recovery
- Open complaints
- Open NCRs
- Alerts
- Tasks

Dashboard should answer:

> What needs attention today?

Do not make the dashboard a generic chart gallery.

---

## 2. Customers

Purpose:

Manage customer database.

Important fields:

- Customer name
- Company name
- Customer type
- Contact person
- Phone
- WhatsApp number
- Email
- GST number
- Billing address
- Shipping address
- City/state/pincode
- Payment terms
- Notes
- Active/inactive status

Related data:

- Quotes
- Orders
- Dispatches
- Invoices
- Payments
- Complaints
- Communication logs

Customer types:

- Fabricator
- Dealer
- Architect
- Industrial
- Solar
- Government
- Export
- Contractor
- Other

---

## 3. Aluminium Profiles

Purpose:

Manage profile master data.

Important fields:

- Profile code
- Profile name
- Application category
- Section weight kg/m
- Alloy
- Temper
- Finish options
- Standard length
- Drawing/image
- Notes
- Active/inactive status

Used by:

- Quotes
- Dies
- Inventory
- Production
- Door/window configurator
- Reports

Profile code should be unique within a company.

---

## 4. Dies

Purpose:

Track extrusion dies.

Important fields:

- Die number
- Linked profile
- Customer-owned or company-owned
- Customer if customer-owned
- Die status
- Rack/location
- Total production kg
- Total runs
- Last used date
- Die manufacturer
- Die cost
- Purchase date
- Correction history
- Drawing
- Notes

Statuses:

- Active
- Trial
- Correction
- Nitriding
- Inactive
- Dead

Die module should help answer:

- Where is this die?
- Is it active?
- Who owns it?
- Which profile does it make?
- How much production has it done?
- Is it causing rejection?
- When was it last corrected?

---

## 5. Quotes

Purpose:

Create accurate professional quotations.

Quote flow:

1. Draft
2. Internal review if required
3. Approved for sending
4. Sent
5. Customer approved/rejected
6. Converted to order
7. Expired/cancelled if applicable

Quote calculations should include:

- Quantity
- Length
- Total meters
- Section weight kg/m
- Total weight
- Billet/material rate
- Conversion charge
- Finishing charge
- Die charge
- Packing charge
- Transport charge
- Other charges
- Margin
- GST
- Grand total

Important rules:

- Calculations must be centralized.
- Customer-facing PDF must not show internal margin/cost.
- Low-margin quotes may require approval.
- Sent quote edits should create revision where supported.
- Converted quote should not convert twice.

---

## 6. Orders

Purpose:

Track confirmed customer orders.

Important fields:

- Order number
- Customer
- Linked quote
- Order date
- Expected dispatch date
- Priority
- Current stage
- Order value
- Notes

Stages:

- Order Confirmed
- Die Ready
- Billet Ready
- Extrusion Planned
- Extruded
- Aging
- Finishing
- Packing
- Dispatched
- Delivered
- Payment Pending
- Closed
- Cancelled

Order stage changes should create history records.

Orders overview should group by stage, not show one giant table.

---

## 7. Production

Purpose:

Plan and track factory production.

Should support:

- Production jobs
- Machine/press assignment
- Planned date
- Shift
- Die assignment
- Profile assignment
- Planned kg/meters
- Actual kg/meters
- Rejection kg
- Scrap kg
- Operator
- Status
- Remarks

Statuses:

- Planned
- Ready
- In Progress
- Completed
- On Hold
- Cancelled

Production completion may update:

- Order stage
- Inventory movement
- Scrap records
- Die production totals

Critical production actions should be audited.

---

## 8. Dispatches

Purpose:

Track outgoing material.

Important fields:

- Dispatch number
- Order
- Customer
- Dispatch date
- Number of bundles
- Total weight kg
- Transporter name
- Vehicle number
- Driver name
- Driver phone
- E-way bill number
- LR number
- Proof of delivery
- Packing list
- Delivery status
- Remarks

Statuses:

- Pending
- Dispatched
- In Transit
- Delivered
- Delayed
- Damaged
- Returned

Dispatch creation may update order stage.

Delivered status may update order to delivered.

---

## 9. Inventory

Purpose:

Track materials and stock.

Categories:

- Billets
- Extruded profiles
- Hardware
- Powder coating material
- Packing material
- Scrap
- Finished goods

Inventory should support:

- Purchase in
- Production issue
- Production output
- Dispatch out
- Scrap in/out
- Adjustments
- Reservations
- Low stock alerts
- Movement history

Units:

- kg
- meter
- piece
- bundle
- box
- liter
- set

Negative stock should be blocked or explicitly controlled.

---

## 10. Billets

Purpose:

Track raw aluminium billet batches.

Fields:

- Batch number
- Supplier
- Alloy
- Temper
- Diameter
- Length
- Total weight
- Available weight
- Rate/kg
- Heat number
- COA document
- Received date
- Status

Billet issue to production should reduce available weight and create inventory movement.

---

## 11. Scrap and Yield

Purpose:

Track loss, rejection, and recovery.

Scrap types:

- Butt scrap
- Process scrap
- Rejection
- Cutting waste
- Coating rejection
- Anodizing rejection
- Packing damage
- Customer return
- Remelt scrap
- Other

Metrics:

- Input weight
- Good output weight
- Scrap weight
- Recovery %
- Scrap %
- Scrap value

Reports should identify:

- Worst dies
- Worst profiles
- Worst machines
- Worst operators/processes if tracked
- Scrap trend

---

## 12. Quality

Purpose:

Manage quality tests and compliance documentation.

Includes:

- Quality tests
- Test certificates
- NCRs
- Customer complaints
- Corrective actions
- Preventive actions
- Calibration records if enabled
- Compliance documents if enabled

Quality test examples:

- Chemical composition
- Tensile strength
- Hardness
- Dimensional check
- Surface finish
- Coating thickness
- Visual inspection
- Final inspection

---

## 13. Payments and Invoices

Purpose:

Light receivables tracking.

Track:

- Invoice number
- Customer
- Order
- Invoice date
- Due date
- Subtotal
- GST
- Grand total
- Amount paid
- Balance due
- Status

Statuses:

- Draft
- Sent
- Partially Paid
- Paid
- Overdue
- Cancelled

This is not a full accounting replacement unless explicitly expanded.

---

## 14. Vendors and Purchases

Purpose:

Track suppliers and purchase orders.

Vendor types:

- Billet supplier
- Die maker
- Powder coating vendor
- Anodizing vendor
- Hardware supplier
- Transporter
- Packing supplier
- Maintenance vendor
- Other

Purchase orders should support:

- Vendor
- Items
- Quantity
- Rate
- GST
- Status
- Expected delivery
- Goods receipt where enabled

---

## 15. Reports

Purpose:

Generate operational and business reports.

Reports may include:

- Quote report
- Order report
- Dispatch report
- Customer outstanding report
- Inventory report
- Scrap/yield report
- Die performance report
- Production job report
- Quality report
- Vendor purchase report

Reports should support:

- Date range
- Filters
- Summary totals
- CSV export
- PDF export where useful

Sensitive reports must be role-restricted.

---

## 16. Alerts and Tasks

Purpose:

Help users act on important issues.

Alert examples:

- Quote expiring
- Low-margin quote
- Order delayed
- Dispatch delayed
- Payment overdue
- Low inventory
- Die high rejection
- Quality failure
- Complaint open

Task examples:

- Follow up quote
- Call customer
- Check die correction
- Confirm dispatch
- Collect payment
- Resolve complaint

---

## 17. Audit Logs

Purpose:

Track important actions.

Log:

- Quote created/approved/sent/converted
- Order created/stage changed
- Dispatch created/status changed
- Payment recorded
- Inventory adjusted
- User role changed
- Settings updated
- Data exported
- File uploaded/deleted

Audit logs should be owner/admin visible only.

---

## 18. Settings

Purpose:

Configure company and system defaults.

Settings may include:

- Company profile
- Logo
- GST number
- Address
- Quote terms
- Default margin
- Default GST
- Default conversion charge
- Number prefixes
- PDF branding
- Bank details
- User roles
- Feature flags
- Storage settings

Settings changes should be audited.
