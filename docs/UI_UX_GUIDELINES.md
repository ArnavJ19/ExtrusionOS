# UI/UX Guidelines — ExtrusionOS

## 1. Design Goal

ExtrusionOS should feel like a premium industrial SaaS product for Indian aluminium MSMEs.

The UI must be:

- Clean
- Practical
- Fast
- Non-overwhelming
- Professional
- Mobile-friendly
- Easy for factory staff
- Easy for owners
- Easy to demo

The product should not feel like a generic admin panel.

---

## 2. Visual Style

Use:

- White main workspace
- Charcoal sidebar
- Aluminium/silver cards
- Orange accent color
- Dark graphite text
- Subtle borders
- Soft shadows
- Rounded cards
- Clean typography
- Professional status badges
- Consistent spacing

Avoid:

- Too many colors
- Giant unstructured forms
- Large tables mixed with forms
- Cramped layouts
- Tiny buttons
- Excessive icons
- Unclear action labels
- Generic dashboard clutter

---

## 3. Core Page Pattern

Each major module should have:

```text
/module                 Overview page
/module/database        Database/list page
/module/new             Create page
/module/[id]            Detail page
/module/[id]/edit       Edit page
```

### 3.1 Overview Page

Purpose:

> Show what needs attention right now.

Should include:

- Page title
- Short description
- Primary action button
- Secondary “View Database” button
- Summary metric cards
- Status/category cards
- Recent or important records only
- Alerts or warnings where useful

Should not include:

- Full database table
- Huge inline create form
- Too many filters
- Too much raw data

### 3.2 Database Page

Purpose:

> Show all records and allow search/sort/filter.

Should include:

- Search
- Filters
- Sortable columns
- 10-row pagination by default
- Next/Previous controls
- Row click to detail
- Loading state
- Empty state
- Error state

### 3.3 Create/Edit Page

Purpose:

> Data entry only.

Should include:

- Clear sections
- Validation
- Save/cancel actions
- Helper text
- No full record table

### 3.4 Detail Page

Purpose:

> Inspect one record deeply.

Should include:

- Header
- Status badge
- Key summary cards
- Main details
- Related records
- Timeline/activity
- Documents
- Actions

Use tabs if needed.

---

## 4. Database Tables

Database tables should be:

- Paginated
- Searchable
- Sortable
- Filterable
- Dense but readable
- Clear in action hierarchy

Default page size:

```text
10 rows
```

Use server-side pagination.

Do not load thousands of rows into the frontend.

---

## 5. Status Boards

Modules with statuses should use boards or grouped cards on overview pages.

### Orders

Group by:

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

Sort within each group:

1. Urgent
2. High
3. Normal
4. Low
5. Expected dispatch date

### Quotes

Group by:

- Draft
- Internal Review
- Approved
- Sent
- Customer Approved
- Rejected
- Expired
- Converted to Order

### Dispatches

Group by:

- Pending
- Dispatched
- In Transit
- Delivered
- Delayed
- Damaged
- Returned

### Dies

Group by:

- Active
- Trial
- Correction
- Nitriding
- Inactive
- Dead

### Inventory

Group by:

- Low Stock
- Out of Stock
- Billets
- Profiles
- Hardware
- Packing Material
- Scrap
- Finished Goods

---

## 6. Forms

Forms should:

- Use clear section headers
- Use helper text
- Use unit suffixes such as mm, kg, kg/m, %, ₹
- Show validation near the field
- Use searchable dropdowns for large lists
- Use collapsible advanced settings
- Use one-column layout on mobile
- Avoid showing too many fields at once

Bad button labels:

- Submit
- OK
- Process

Good button labels:

- Create Quote
- Save Die
- Generate PDF
- Move to Dispatch
- Record Payment

---

## 7. Empty States

Every page should have useful empty states.

Examples:

### Dies

```text
No dies found.
Add your first die to start tracking die status, ownership, and production history.
```

### Orders

```text
No orders in this stage.
Orders will appear here as they move through production.
```

### Quotes

```text
No quotes found.
Create your first quotation to start tracking customer pricing and approvals.
```

Include relevant action buttons.

---

## 8. Loading States

Use skeletons instead of blank screens.

Loading states should match the layout that will appear.

Examples:

- Card skeletons for overview pages
- Table row skeletons for database pages
- Form skeletons for edit/detail pages

---

## 9. Error States

Errors should be user-friendly.

Bad:

```text
TypeError: Cannot read properties of undefined
```

Good:

```text
Could not load dispatches. Please retry.
```

Include retry buttons where practical.

---

## 10. Mobile Rules

On mobile:

- Use stacked cards
- Keep forms single-column
- Avoid wide tables where possible
- Allow horizontal scroll only when necessary
- Use large touch targets
- Keep primary actions visible
- Avoid tiny text
- Avoid cramped status boards

Factory users may use low-end Android phones.

Keep mobile screens fast and practical.

---

## 11. Status Badges

Use consistent badge colors:

- Green: active, completed, delivered, paid
- Blue: draft, planned, normal
- Orange: pending, warning, correction
- Red: urgent, overdue, failed, dead
- Gray: inactive, closed, cancelled
- Purple: review, special workflow

Do not invent new colors randomly.

---

## 12. Navigation

Sidebar should include major modules only:

- Dashboard
- Quotes
- Orders
- Production
- Dispatches
- Inventory
- Dies
- Customers
- Profiles
- Payments
- Quality
- Reports
- Settings

Do not put every database page as a top-level sidebar item.

Use module-level buttons:

- Add New
- View Database
- Reports

---

## 13. Industry-Specific UI

Use labels aluminium businesses understand.

Examples:

- Section Weight kg/m
- Die Status
- Billet Ready
- Extruded
- Aging
- Finishing
- Packing
- Dispatch
- E-way Bill
- LR Number
- Transporter
- Bundle Count
- Recovery %
- Scrap kg

Avoid vague generic labels when industry-specific labels are better.

---

## 14. Customer vs Internal Views

Customer-facing pages/PDFs should be clean and simplified.

Do not show:

- Internal cost
- Margin
- Profit
- Supplier rates
- Internal notes
- Audit logs
- Other customers’ data

Internal pages may show detailed cost/profit only to authorized roles.

---

## 15. UI Completion Checklist

Before finishing UI work:

- [ ] Page has one clear purpose
- [ ] No huge form + huge table on same page
- [ ] Loading state exists
- [ ] Empty state exists
- [ ] Error state exists
- [ ] Mobile layout works
- [ ] Primary action is obvious
- [ ] Status badges are consistent
- [ ] Data tables paginate by 10
- [ ] Search/filter/sort work where relevant
- [ ] Sensitive fields hidden from unauthorized roles
