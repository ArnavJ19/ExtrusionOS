# Business Logic and Calculations — ExtrusionOS

This document defines calculation rules and workflow logic that must remain centralized and testable.

## 1. Core Rule

Do not duplicate business calculations inside React components.

Put calculation logic in `/lib/calculations` or relevant `/lib/<module>` files.

Every important calculation should have unit tests where practical.

---

## 2. Quote Calculation Logic

Inputs may include:

- Quantity pieces
- Length per piece in meters
- Section weight kg/m
- Billet/material rate per kg
- Conversion charge per kg
- Finishing charge
- Finishing charge type
- Die charge
- Packing charge
- Transport charge
- Other charges
- Margin %
- GST %
- Scrap/wastage allowance % if enabled
- Minimum billing weight if enabled

### Standard Formulas

```text
total_meters = quantity_pieces * length_per_piece_m

total_weight_kg = total_meters * section_weight_kg_per_m

effective_weight_kg = total_weight_kg * (1 + scrap_allowance_percent / 100)

billing_weight_kg = max(effective_weight_kg, minimum_billing_weight_kg)

raw_material_cost = billing_weight_kg * billet_rate_per_kg

conversion_cost = billing_weight_kg * conversion_charge_per_kg
```

Finishing:

```text
if finishing_charge_type = per_kg:
  finishing_cost = billing_weight_kg * finishing_charge

if finishing_charge_type = per_meter:
  finishing_cost = total_meters * finishing_charge

if finishing_charge_type = fixed:
  finishing_cost = finishing_charge
```

Base cost:

```text
base_cost = raw_material_cost
          + conversion_cost
          + finishing_cost
          + die_charge
          + packing_charge
          + transport_charge
          + other_charges
```

Margin:

```text
margin_amount = base_cost * margin_percent / 100
line_total_before_gst = base_cost + margin_amount
```

GST:

```text
gst_amount = line_total_before_gst * gst_percent / 100
grand_total = line_total_before_gst + gst_amount
```

Pricing:

```text
price_per_kg = line_total_before_gst / billing_weight_kg
price_per_meter = line_total_before_gst / total_meters
```

### Edge Cases

Must handle:

- zero quantity
- zero length
- zero section weight
- missing rates
- negative values
- invalid GST
- invalid margin
- manual override below cost
- low margin
- expired quote
- dead/inactive die

Never divide by zero.

---

## 3. Quote Workflow Logic

Possible quote statuses:

- draft
- internal_review
- approved_for_sending
- sent
- customer_approved
- customer_rejected
- expired
- converted_to_order

Rules:

- Draft quotes can be edited.
- Sent quote edits should create revision where supported.
- Customer-approved quote can be converted to order.
- Converted quote should not convert twice.
- Low-margin quotes may require owner/admin approval.
- Customer-facing quote PDF must hide internal margin/cost.

---

## 4. Order Workflow Logic

Possible order stages:

- order_confirmed
- die_ready
- billet_ready
- extrusion_planned
- extruded
- aging
- finishing
- packing
- dispatched
- delivered
- payment_pending
- closed
- cancelled

Rules:

- Every stage change should create `order_stage_history`.
- Delayed order = expected dispatch date is past and stage is not dispatched/delivered/closed/cancelled.
- Cancelled/closed orders should not appear in active production board.
- Dispatch creation may move order to dispatched.
- Delivery confirmation may move order to delivered.

---

## 5. Inventory Logic

Inventory movements should drive stock.

Movement types may include:

- purchase_in
- production_in
- production_issue
- dispatch_out
- scrap_in
- scrap_out
- adjustment_in
- adjustment_out
- return_in

Rules:

- Stock-in increases current stock.
- Stock-out decreases current stock.
- Negative stock should be blocked unless explicitly allowed.
- Every movement should be auditable.
- Critical stock adjustments should require permission.
- Inventory unit must be consistent.

---

## 6. Billet Logic

Billet batch should track:

- total weight
- available weight
- alloy
- temper
- rate/kg
- heat number
- COA document

Rules:

- Issuing billet to production reduces available weight.
- Available weight cannot go below zero unless explicitly allowed.
- Billet issue should create inventory movement.
- COA document should be linked to batch.

---

## 7. Production Logic

Production job should track:

- order
- machine
- die
- profile
- planned date
- shift
- planned kg/meters
- actual kg/meters
- rejection kg
- scrap kg
- status

Rules:

- Completion should capture actual output.
- Completion may update inventory.
- Completion may update die total production.
- Completion may create scrap records.
- Completion may update order stage.
- All major production changes should be audited.

---

## 8. Scrap and Yield Logic

Definitions:

```text
input_weight_kg = billet/material issued
accepted_output_kg = good production output
scrap_weight_kg = total scrap/rejection
```

Recovery:

```text
recovery_percent = accepted_output_kg / input_weight_kg * 100
```

Scrap percentage:

```text
scrap_percent = scrap_weight_kg / input_weight_kg * 100
```

Edge cases:

- If input weight is zero, do not divide.
- If scrap is negative, reject.
- If accepted output + scrap exceeds input by unreasonable amount, warn.

---

## 9. Dispatch Logic

Dispatch should track:

- order
- dispatch date
- bundle count
- total weight
- transporter
- vehicle number
- e-way bill
- LR number
- delivery status
- proof of delivery

Rules:

- Dispatch should be linked to order.
- Dispatch creation may update order stage.
- Delivered status may update order stage to delivered.
- Proof of delivery should be stored securely.
- Dispatch with zero bundles or weight should warn.

---

## 10. Payment Logic

Invoice fields:

- subtotal
- GST
- grand total
- amount paid
- balance due
- due date
- status

Payment balance:

```text
balance_due = grand_total - amount_paid
```

Status logic:

```text
if amount_paid = 0:
  status = sent or overdue depending due date

if amount_paid > 0 and amount_paid < grand_total:
  status = partially_paid

if amount_paid >= grand_total:
  status = paid

if due_date < today and balance_due > 0:
  status = overdue
```

Handle overpayment intentionally:

- Either block overpayment
- Or record as advance/credit if module supports it

Do not silently corrupt invoice balance.

---

## 11. Quality Logic

Quality tests should track:

- test type
- result status
- measured values
- certificate
- order/job/profile/batch links

Result statuses:

- pass
- fail
- conditional_pass
- pending

NCR workflow:

- open
- investigating
- corrective_action_pending
- closed

Customer complaints should track:

- customer
- order
- complaint type
- severity
- resolution
- status

Customer-facing quality documents must hide internal root-cause notes if required.

---

## 12. System Configurator Logic, If Enabled

Configurator engines should be centralized.

Separate:

- formula engine
- preview geometry
- profile cut engine
- glass engine
- beading engine
- hardware BOM engine
- material summary engine
- costing engine
- optimization engine

Do not put cutting formulas inside React UI components.

The selected system type must affect:

- preview renderer
- cutting logic
- glass logic
- hardware BOM
- warnings
- output labels

Changing from sliding to casement/fixed/door must visibly change preview and outputs.

---

## 13. Formatting Rules

Currency:

```text
₹1,25,000.00
```

Weight:

```text
520.345 kg
```

Meters:

```text
1,250.50 m
```

Date:

```text
DD MMM YYYY
```

Percent:

```text
18%
```

---

## 14. Testing Requirements

At minimum, test:

- Quote calculations
- GST calculations
- Margin calculations
- Inventory movements
- Payment balance
- Overdue logic
- Order delay logic
- Yield calculation
- Permission helper
- Public data sanitization
- Configurator calculations if enabled

Tests should include edge cases, not just happy paths.
