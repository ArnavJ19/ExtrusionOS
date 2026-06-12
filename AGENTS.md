# AGENTS.md — ExtrusionOS AI Coding Agent Instructions

This file is the primary project-level instruction document for AI coding agents working on **ExtrusionOS**.

Use this file before making any change to the repository. These rules apply to Cursor, Claude Code, Codex, Lovable, Bolt, Replit Agent, or any other AI-assisted coding tool.

---

## 1. Project Identity

**Project name:** ExtrusionOS  
**Product type:** Vertical SaaS for aluminium extrusion MSMEs and aluminium systems businesses in India.  
**Primary users:** aluminium extrusion owners, sales teams, production supervisors, dispatch teams, inventory teams, accounts teams, quality teams, fabricators, dealers, and customer/portal users.

ExtrusionOS helps aluminium businesses move from Excel, WhatsApp, Tally-only workflows, manual registers, and scattered files into a structured SaaS operating system.

The product should feel like serious industrial software, not a generic CRUD dashboard.

---

## 2. Core Product Scope

ExtrusionOS may include these modules:

- Authentication and company onboarding
- Multi-tenant company management
- Role-based access control
- Dashboard / command center
- Customers
- Aluminium profiles
- Dies
- Quotations
- Quote items and quote revisions
- Orders
- Order stage history
- Production jobs
- Machines
- Dispatches
- Inventory
- Billet batches
- Profile stock batches
- Scrap and yield tracking
- Finishing jobs
- Quality tests
- NCRs and customer complaints
- Invoices and payments
- Vendors and purchase orders
- Reports
- Alerts and tasks
- Audit logs
- Supabase Storage file uploads
- PDF/report generation
- Customer/dealer portal where enabled
- Aluminium door/window system configurator where enabled

Do not add unrelated generic ERP modules unless explicitly requested.

---

## 3. Primary Business Problems to Solve

Every feature should address one or more of these real business problems:

1. Wrong quotation costing
2. Poor die tracking
3. Poor production visibility
4. Delayed dispatches
5. Stock/inventory confusion
6. Scrap and yield loss
7. Poor customer follow-up
8. Overdue receivables
9. Weak quality documentation
10. Lack of owner-level visibility
11. Manual WhatsApp/Excel dependency
12. Poor traceability across quote → order → production → dispatch → payment

If a feature does not clearly solve one of these problems, do not add it without approval.

---

## 4. Tech Stack

Use the existing stack unless explicitly instructed otherwise:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Row Level Security
- React Hook Form
- Zod
- PDF generation library already present or approved
- Vercel deployment

Avoid unnecessary infrastructure:

- Do not introduce microservices unless explicitly required.
- Do not add a second backend unless explicitly required.
- Do not add a different database unless explicitly required.
- Do not add heavy dependencies for small problems.

---

## 5. Non-Negotiable Engineering Rules

### 5.1 Do not rewrite the project casually

Do not rewrite large parts of the codebase unless the user explicitly asks for a redesign or the current implementation is irreparably broken.

Prefer safe, incremental patches.

### 5.2 Do not break existing features

Before changing a module, understand what currently works. Preserve working flows.

### 5.3 Do not delete production data

Database migrations must be safe and additive by default.

Avoid:

- Dropping tables
- Dropping columns
- Renaming columns without migration/backfill strategy
- Changing enum/check values destructively
- Removing historical records

### 5.4 Do not bypass RLS

Supabase RLS is the final protection layer. Never disable it to “make something work.”

### 5.5 Do not expose service role keys

`SUPABASE_SERVICE_ROLE_KEY` must never be imported into client components or browser-executed code.

### 5.6 Do not trust frontend `company_id`

Company ID must be derived from the authenticated user on the server or through secure Supabase policies.

Bad:

```ts
company_id: values.company_id
```

Good:

```ts
company_id: currentUser.company_id
```

### 5.7 Do not duplicate business logic

Important logic belongs in `/lib`, not scattered across React components.

Examples:

- Quote calculation
- GST calculation
- Margin calculation
- Inventory stock movement
- Payment balance
- Yield/recovery calculation
- Door/window cutting list calculation
- Glass-size calculation
- Hardware BOM calculation

### 5.8 Do not create fake features

If a button says “Generate PDF,” “Export,” “Approve,” “Send,” or “Convert to Order,” it must either work or be disabled with a clear explanation.

Do not create UI-only fake flows.

---

## 6. Multi-Tenancy Rule

ExtrusionOS is a multi-tenant SaaS product.

Every company-specific business table must include:

- `company_id`
- RLS policies
- indexes involving `company_id`
- safe select/insert/update/delete policies

Users from Company A must never access Company B data.

This applies to:

- Database records
- API routes
- Server actions
- Storage files
- PDFs
- Public share links
- Customer portal pages
- Reports
- Search results

---

## 7. UI/UX Rule

The UI must be clean and non-overwhelming.

Do not show large forms and large record tables on the same page.

Each major module should follow this structure:

```text
/module                 Overview page
/module/database        Full database/list page
/module/new             Create page
/module/[id]            Detail page
/module/[id]/edit       Edit page
```

Overview pages answer:

> What needs my attention right now?

Database pages answer:

> Show me all records and let me search/sort/filter.

Create/edit pages answer:

> Let me enter or update data without distraction.

Detail pages answer:

> Show everything important about one record.

---

## 8. Database Page Rule

Every database/list page should:

- Show 10 rows by default
- Use server-side pagination
- Use Supabase `.range()` or equivalent server-side limit/offset
- Include search
- Include relevant filters
- Include sortable columns
- Include loading, empty, and error states
- Allow row click to detail page

Do not fetch all rows and paginate only on the client.

---

## 9. Status Board Rule

Modules with workflow statuses should use status-grouped boards/cards on overview pages.

Examples:

- Orders grouped by current stage
- Quotes grouped by quote status
- Dispatches grouped by delivery status
- Production jobs grouped by job status
- Dies grouped by die status
- Inventory grouped by stock status/category
- Payments grouped by invoice/payment status
- Quality/NCR grouped by status

Limit each status section to a small number of records, usually 10.

Provide a “View Database” button for full paginated tables.

---

## 10. Security Rule

Before completing any feature, verify:

- Authentication is required where appropriate
- Authorization is enforced server-side
- RLS policies exist and are safe
- Storage files are company-scoped
- Public/customer views expose only safe fields
- API routes validate inputs
- Server actions validate inputs
- No sensitive data is returned to unauthorized users

Customer-facing views must never expose:

- Internal cost
- Margin
- Profit
- Supplier rates
- Internal notes
- Other customers’ data
- Other companies’ data

---

## 11. Industry Context Rules

Use aluminium-industry terminology consistently:

- Profile
- Die
- Billet
- Alloy
- Temper
- Section weight kg/m
- Powder coating
- Anodizing
- Mill finish
- Bundle
- E-way bill
- LR number
- Transporter
- Dispatch
- Recovery percentage
- Scrap
- Cut length
- Stock length
- Beading
- Interlock
- Mullion
- Transom
- Sash/shutter
- Hardware BOM
- Glass list
- Cutting list

Indian business context should support:

- INR
- GST
- Indian phone numbers
- WhatsApp-friendly summaries
- Dealer/fabricator workflow
- Project/site references
- MSME practicality

---

## 12. Required Checks Before Final Response

Run available checks after code changes:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

If a command does not exist, state that it does not exist.

Fix errors related to your changes.

---

## 13. Standard Completion Report

After making changes, report:

1. What changed
2. Why it changed
3. Files created
4. Files modified
5. Database migrations added, if any
6. RLS/security changes, if any
7. Tests added or updated
8. Commands run and results
9. Manual testing checklist
10. Known limitations or follow-up work

---

## 14. When Unsure

When unsure, do not guess silently.

Do this:

1. Inspect the codebase.
2. Identify the current pattern.
3. Follow existing architecture if it is safe.
4. Make the smallest correct change.
5. Report assumptions.

Do not add new architecture just because it seems interesting.
