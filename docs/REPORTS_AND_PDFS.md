# Reports and PDFs — ExtrusionOS

## 1. Purpose

ExtrusionOS should generate professional business documents for customers and internal teams.

Reports and PDFs must be accurate, clean, and role-aware.

## 2. Customer-Facing vs Internal PDFs

### Customer-facing PDFs may include:

- Company branding
- Customer details
- Quote/order details
- Product description
- Quantity
- Size/dimensions
- Total price
- GST
- Terms and conditions
- Delivery information
- Authorized signature

### Customer-facing PDFs must not include:

- Internal cost
- Margin
- Profit
- Supplier rates
- Scrap/wastage assumptions unless intended
- Internal notes
- Approval comments
- Other customers’ data

### Internal PDFs may include:

- Cost breakdown
- Margin
- Profit
- Wastage
- Supplier rates
- Production assumptions
- Internal notes

Internal PDFs must be permission-restricted.

## 3. Common PDFs

### 3.1 Quotation PDF

Should include:

- Company logo
- Company name
- GST number
- Address
- Quote number
- Quote date
- Valid until
- Customer details
- Item table
- Subtotal
- GST
- Grand total
- Terms
- Signature

### 3.2 Order Confirmation PDF

Should include:

- Order number
- Customer
- Linked quote
- Order date
- Expected dispatch date
- Items
- Value
- Terms

### 3.3 Dispatch Note PDF

Should include:

- Dispatch number
- Order number
- Customer
- Dispatch date
- Bundles
- Total weight
- Transporter
- Vehicle number
- E-way bill
- LR number

### 3.4 Packing List PDF

Should include:

- Bundle details
- Profile/items
- Weight
- Quantity
- Customer/order reference

### 3.5 Quality Certificate PDF

Should include:

- Customer/order reference
- Product/profile
- Test type
- Result
- Certificate details
- Authorized signatory

### 3.6 Cutting List PDF, If Configurator Enabled

Should include:

- Design reference
- Profile code
- Component
- Cut length
- Quantity
- Angle
- Remarks

### 3.7 Glass List PDF, If Configurator Enabled

Should include:

- Design reference
- Panel
- Width
- Height
- Quantity
- Glass type
- Thickness
- Area

### 3.8 Hardware BOM PDF, If Configurator Enabled

Should include:

- Item code
- Item name
- Category
- Quantity
- Unit

## 4. PDF Design Rules

Use:

- Clean white background
- Charcoal text
- Orange accents
- Clear tables
- Proper spacing
- Page numbers if multi-page
- Company branding
- Consistent headers/footers

Avoid:

- Tiny unreadable text
- Overcrowded tables
- Random colors
- Missing company/customer details
- Internal data in customer PDFs

## 5. Data Accuracy Rules

Before generating PDF:

- Validate required fields
- Validate customer/company data
- Validate totals
- Validate GST
- Validate status where needed
- Block generation if critical errors exist

## 6. PDF Storage

Store generated PDFs in Supabase Storage.

Use company-scoped paths:

```text
<company_id>/<entity_type>/<entity_id>/<filename>.pdf
```

Save metadata in `documents` or relevant PDF/report table.

## 7. Report Pages

Report pages should include:

- Date range filters
- Status filters
- Customer filters where useful
- Summary totals
- Export CSV
- Export PDF where useful
- Role restrictions

## 8. Sensitive Reports

Restrict reports that expose:

- Margin
- Profit
- Internal cost
- Customer outstanding
- Payment history
- Supplier rates
- Scrap loss value

Owner/admin should control access.

## 9. PDF Testing Checklist

- [ ] PDF generates successfully
- [ ] Totals match UI
- [ ] GST matches calculation
- [ ] Customer data correct
- [ ] Company data correct
- [ ] Internal cost hidden from customer PDF
- [ ] File stored securely
- [ ] Link/download works
- [ ] PDF layout readable on mobile and desktop
- [ ] Multi-page tables do not break badly
