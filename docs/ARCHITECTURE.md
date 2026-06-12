# Architecture Guidelines — ExtrusionOS

## 1. Stack

ExtrusionOS uses:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Row Level Security
- React Hook Form
- Zod
- PDF generation
- Vercel deployment

Do not introduce a new backend, database, auth provider, or state-management framework unless explicitly requested.

---

## 2. Recommended Folder Structure

```text
/app
  /(auth)
    /login
    /signup
    /onboarding
  /(dashboard)
    /dashboard
    /customers
    /profiles
    /dies
    /quotes
    /orders
    /production
    /dispatches
    /inventory
    /payments
    /quality
    /vendors
    /reports
    /settings
  /api

/components
  /layout
  /ui
  /forms
  /tables
  /dashboard
  /customers
  /profiles
  /dies
  /quotes
  /orders
  /production
  /dispatches
  /inventory
  /payments
  /quality
  /vendors
  /reports
  /settings
  /systems-configurator

/lib
  /supabase
  /queries
  /actions
  /validations
  /calculations
  /permissions
  /formatters
  /pdf
  /storage
  /audit
  /alerts
  /utils

/types
  database.ts
  app.ts
  permissions.ts

/supabase
  /migrations
  /seed
  schema.sql
  rls.sql

/docs
```

Follow existing project structure if it differs but is consistent and safe.

---

## 3. Architecture Principles

### 3.1 Keep business logic out of React components

React components should handle display, user interaction, and rendering.

Business logic belongs in `/lib`.

Examples:

```text
/lib/calculations/quote-calculations.ts
/lib/calculations/inventory-calculations.ts
/lib/calculations/payment-calculations.ts
/lib/calculations/yield-calculations.ts
/lib/permissions/permissions.ts
/lib/formatters/currency.ts
```

Bad:

```tsx
const total = weight * rate + gst - margin; // repeated inside multiple components
```

Good:

```ts
import { calculateQuoteTotals } from '@/lib/calculations/quote-calculations';
```

### 3.2 Centralize Supabase queries

Avoid scattering raw Supabase query logic across every component.

Prefer query modules:

```text
/lib/queries/customers.ts
/lib/queries/profiles.ts
/lib/queries/dies.ts
/lib/queries/quotes.ts
/lib/queries/orders.ts
/lib/queries/inventory.ts
```

### 3.3 Use server-side checks for sensitive actions

Sensitive actions must check auth and authorization server-side.

Examples:

- Quote approval
- Low-margin approval
- Order stage update
- Payment recording
- Inventory adjustment
- User role update
- Settings change
- Data export

Do not rely only on hiding UI buttons.

### 3.4 Use Zod for validation

Each major form and action should have a validation schema:

```text
/lib/validations/customer.ts
/lib/validations/profile.ts
/lib/validations/die.ts
/lib/validations/quote.ts
/lib/validations/order.ts
/lib/validations/inventory.ts
/lib/validations/payment.ts
```

### 3.5 Use reusable components

Create reusable components for:

- PageHeader
- MetricCard
- StatusBadge
- PriorityBadge
- DataTable
- DataTablePagination
- SortableColumnHeader
- StatusBoard
- EmptyState
- LoadingSkeleton
- ErrorState
- ConfirmDialog
- FileUpload
- DateRangeFilter
- SearchInput

Avoid duplicating table, form, and badge logic across modules.

---

## 4. Page Architecture

Major modules should follow:

```text
/module                 Overview page
/module/database        Full list/database page
/module/new             Create page
/module/[id]            Detail page
/module/[id]/edit       Edit page
```

Example:

```text
/orders
/orders/database
/orders/new
/orders/[id]
/orders/[id]/edit
```

Overview pages should not show full database tables.

Create/edit pages should not show full record lists.

---

## 5. Data Flow

Typical secure data flow:

1. User logs in through Supabase Auth.
2. App fetches auth user.
3. App fetches app user/profile record.
4. App derives `company_id` and role.
5. Query functions fetch only company-scoped records.
6. RLS enforces database-level protection.
7. UI renders data based on role permissions.
8. Sensitive actions run server-side validation and role checks.

---

## 6. Client vs Server Rules

### Client components may handle:

- Form interactions
- Local UI state
- View toggles
- Client-side display formatting
- Non-sensitive UI state

### Server actions/API routes should handle:

- Sensitive mutations
- Authorization checks
- File processing
- PDF generation when sensitive
- Data exports
- Actions requiring service role key
- Public token validation

### Never put these in client components:

- Service role key usage
- Admin-only queries
- Server-only secrets
- Cross-company operations
- Sensitive internal-cost export logic

---

## 7. State Management

Prefer:

- React Hook Form for forms
- URL search params for filters/pagination where useful
- Local state for simple UI
- Server-derived data for company/role
- Centralized calculation functions

Avoid:

- Duplicating form state in many places
- Storing derived values unnecessarily
- Setting state during render
- Infinite useEffect loops
- Hidden stale state bugs

---

## 8. Performance Rules

- Use server-side pagination.
- Use Supabase `.range()`.
- Select only needed columns.
- Add indexes for common filters.
- Debounce search.
- Avoid N+1 queries.
- Avoid fetching all rows to the client.
- Use SQL views/RPC only when useful and secure.
- Do not generate huge PDFs on the main UI thread if it freezes the page.

---

## 9. Error Handling

All data actions should handle:

- Loading
- Success
- Validation errors
- Supabase errors
- Permission errors
- Empty states
- Unexpected errors

Do not expose raw stack traces to end users.

Good error copy:

```text
Could not load orders. Please retry.
```

Bad error copy:

```text
TypeError: Cannot read properties of undefined
```

---

## 10. Audit Logs

Sensitive actions should create audit logs.

Examples:

- Quote approved
- Quote converted to order
- Order stage changed
- Dispatch created
- Payment recorded
- Inventory adjusted
- User role changed
- Settings updated
- Data exported

Audit logs should include:

- company_id
- user_id
- action
- entity_type
- entity_id
- old_values_json where useful
- new_values_json where useful
- created_at

---

## 11. Feature Flags

If a module is optional or experimental, control it with feature flags.

Examples:

- systems_configurator
- advanced_inventory
- quality_compliance
- customer_portal
- payments
- production_planning
- reports

Do not show enabled-looking UI for disabled modules.

---

## 12. PDF Architecture

PDF logic should be centralized:

```text
/lib/pdf/quote-pdf.ts
/lib/pdf/order-pdf.ts
/lib/pdf/dispatch-pdf.ts
/lib/pdf/quality-pdf.ts
/lib/pdf/cutting-list-pdf.ts
```

Customer-facing PDFs must hide internal costing and margins.

Internal PDFs may show full breakdown only to authorized roles.
