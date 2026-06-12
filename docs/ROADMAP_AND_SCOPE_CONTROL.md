# Roadmap and Scope Control — ExtrusionOS

## 1. Product Strategy

ExtrusionOS should grow from a focused operating system into a strong vertical SaaS platform.

Do not add everything at once.

Build in layers:

1. Quote-to-order core
2. Die/profile/customer foundation
3. Production and dispatch visibility
4. Inventory and payments
5. Quality and reporting
6. Advanced configurator and portals
7. Integrations and automation

## 2. MVP Core

The core sellable MVP should include:

- Customers
- Profiles
- Dies
- Quotations
- Quote PDFs
- Orders
- Order stages
- Dispatches
- Basic inventory
- Dashboard
- Settings

If these are unstable, do not prioritize advanced features.

## 3. High-Value Next Features

Prioritize features by:

1. Customer pain severity
2. Willingness to pay
3. Demo impact
4. Implementation difficulty
5. Defensibility
6. Operational importance

High-value features:

- Quote accuracy and revisions
- Die management
- Order stage board
- Dispatch tracking
- Inventory movements
- Payment outstanding
- Owner dashboard
- PDF quality
- System configurator if target customer sells doors/windows

## 4. Avoid Feature Bloat

Avoid adding these too early:

- Full accounting replacement
- Payroll
- HR
- Complex BI dashboards
- AI chatbot
- Machine IoT
- CNC integration
- Tender management
- Export documentation
- Complex workflow builder

These can come later if the core system is stable.

## 5. Feature Acceptance Questions

Before adding a feature, ask:

1. Which user needs this?
2. What business pain does it solve?
3. Will an MSME owner understand it quickly?
4. Does it improve quote/order/production/dispatch/payment visibility?
5. Does it create recurring value?
6. Is it safer to add after the core is stable?
7. Does it require new RLS/security work?
8. Does it expose sensitive data?
9. Does it require migrations?
10. Can it be tested?

## 6. Roadmap Phases

### Phase 1: Foundation

- Auth
- Company onboarding
- Customers
- Profiles
- Dies
- Quotes
- Orders
- Dispatches
- Settings
- RLS/security

### Phase 2: Operational Depth

- Inventory
- Billet batches
- Production jobs
- Scrap/yield
- Payments
- Quality
- Reports

### Phase 3: Professionalization

- Better PDFs
- Audit logs
- Alerts/tasks
- Role permissions
- Customer portal-lite
- Database pages
- Status boards
- Search/sort/pagination

### Phase 4: Advanced Vertical Features

- Door/window system configurator
- Cutting lists
- Glass lists
- Hardware BOM
- Production sheets
- Dealer workflows

### Phase 5: Enterprise/Integrations

- Tally/Busy/Zoho integration readiness
- WhatsApp Business API readiness
- Advanced analytics
- Multi-branch
- Maintenance
- Energy monitoring
- Tender/export modules

## 7. What Must Always Remain True

No matter how advanced the roadmap gets:

- RLS must remain safe.
- Company data must remain isolated.
- UI must remain clean.
- Core flows must not break.
- Customer-facing outputs must hide internal costs.
- Business calculations must be centralized.
- Features must be real, not fake.

## 8. Demo Priority

For demos, prioritize flows that show immediate business value:

1. Create customer
2. Create profile
3. Create die
4. Create quote
5. Generate quote PDF
6. Convert quote to order
7. Move order through stages
8. Create dispatch
9. Record payment
10. Show dashboard

Advanced modules should support the demo, not distract from it.
