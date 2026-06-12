# Database and RLS Guidelines — ExtrusionOS

## 1. Database Provider

ExtrusionOS uses Supabase PostgreSQL.

All schema changes should be made through migrations.

---

## 2. Multi-Tenant Database Rule

ExtrusionOS is multi-tenant.

Every company-specific table must include:

```sql
company_id uuid not null references companies(id)
```

Every company-specific table must have RLS enabled.

Every company-specific query must be company-scoped.

---

## 3. Standard Table Columns

Most company-specific tables should include:

```sql
id uuid primary key default gen_random_uuid(),
company_id uuid not null references companies(id),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
created_by uuid references auth.users(id)
```

Use `updated_at` triggers for mutable tables.

---

## 4. Core Tables

Expected core tables may include:

- companies
- app_users / profiles
- customers
- aluminium_profiles
- dies
- quotes
- quote_items
- quote_revisions
- orders
- order_stage_history
- dispatches
- company_settings
- documents
- inventory_items
- inventory_movements
- billet_batches
- profile_stock_batches
- machines
- production_jobs
- scrap_records
- quality_tests
- non_conformance_reports
- customer_complaints
- finishing_jobs
- invoices
- payments
- vendors
- purchase_orders
- purchase_order_items
- tasks
- alerts
- audit_logs
- public_share_links
- message_templates
- communication_logs
- feature_flags

Optional system configurator tables may include:

- system_series
- system_profiles
- hardware_items
- glass_items
- finish_options
- system_templates
- system_configurations
- system_profile_cuts
- system_glass_cuts
- system_hardware_bom
- system_reports

---

## 5. RLS Requirements

For every company-specific table:

1. RLS must be enabled.
2. SELECT policies must restrict records to the user’s company.
3. INSERT policies must only allow rows for the user’s company.
4. UPDATE policies must only allow rows for the user’s company.
5. DELETE policies must only allow authorized roles.
6. Policies must not allow unrestricted authenticated access.
7. Public access must only be used for explicitly safe public share views.

---

## 6. RLS Helper Functions

Use helper functions such as:

```sql
get_current_user_company_id()
get_current_user_role()
is_company_member(target_company_id uuid)
has_permission(action text, resource text)
```

If using `SECURITY DEFINER`, always:

- Set a safe `search_path`
- Use `auth.uid()` carefully
- Avoid recursion through RLS policies
- Avoid privilege escalation

Example pattern:

```sql
create or replace function public.get_current_user_company_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select company_id
  from public.app_users
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;
```

Review actual project schema before applying this exact function.

---

## 7. RLS Anti-Patterns

Do not use broad policies like:

```sql
using (auth.role() = 'authenticated')
```

This may allow any logged-in user to access all company records.

Do not allow users to update:

- their own `company_id`
- their own `role`
- another user’s role unless authorized
- another company’s records

Do not rely only on frontend filtering.

---

## 8. Insert and Update Rules

Bad:

```ts
await supabase.from('orders').insert({
  company_id: values.company_id,
  ...values
});
```

Good:

```ts
const companyId = await getCurrentUserCompanyId();
await supabase.from('orders').insert({
  company_id: companyId,
  ...validatedValues
});
```

For updates, always check:

- User is authenticated
- User belongs to same company
- User has permission
- Record exists
- Record belongs to company

---

## 9. Indexing Rules

Add indexes for common filters and joins.

Recommended indexes:

```sql
create index if not exists idx_customers_company_id on customers(company_id);
create index if not exists idx_quotes_company_status on quotes(company_id, status);
create index if not exists idx_orders_company_stage on orders(company_id, current_stage);
create index if not exists idx_dispatches_company_status on dispatches(company_id, delivery_status);
create index if not exists idx_inventory_company_category on inventory_items(company_id, item_category);
create index if not exists idx_dies_company_status on dies(company_id, die_status);
```

Add composite indexes for frequent patterns.

Examples:

- `(company_id, created_at)`
- `(company_id, customer_id)`
- `(company_id, status)`
- `(company_id, current_stage)`
- `(company_id, expected_dispatch_date)`

---

## 10. Unique Constraints

Use company-scoped uniqueness.

Examples:

```sql
unique(company_id, quote_number)
unique(company_id, order_number)
unique(company_id, dispatch_number)
unique(company_id, die_number)
unique(company_id, profile_code)
```

Avoid global uniqueness unless a value is truly global.

---

## 11. Check Constraints and Enums

Use check constraints for controlled statuses.

Example:

```sql
check (status in ('draft', 'sent', 'approved', 'rejected'))
```

If frontend status values change, update database constraints and TypeScript types together.

Always check for mismatches between:

- Form dropdown values
- Zod enums
- TypeScript types
- Database check constraints
- Existing seed data

---

## 12. Migrations

Safe migration rules:

- Prefer additive migrations.
- Do not drop columns without approval.
- Do not drop tables without approval.
- Backfill before adding NOT NULL constraints.
- Add indexes for new high-traffic columns.
- Add RLS policies for new tables in the same migration or immediately after.
- Update TypeScript database types after schema changes.

For local-only unreleased prototypes, editing old migrations may be acceptable. For production-like projects, add new migrations.

---

## 13. Database Views and RPC

Use SQL views or RPC functions when they improve:

- Dashboard performance
- Report aggregation
- Complex workflow transactions
- Inventory movement consistency
- Payment balance consistency

RPC functions must:

- Validate company scope
- Use auth context safely
- Avoid exposing cross-company data
- Avoid privilege escalation

---

## 14. Storage Policies

Storage files must be company-scoped.

Recommended path pattern:

```text
company_id/entity_type/entity_id/file_name
```

Examples:

```text
<company_id>/quotes/<quote_id>/quotation.pdf
<company_id>/dies/<die_id>/drawing.pdf
<company_id>/dispatches/<dispatch_id>/pod.jpg
```

Users must not upload, read, update, or delete another company’s files.

Sensitive buckets should be private.

Use signed URLs where needed.

---

## 15. Public Share Links

Public share links must:

- Use unguessable tokens
- Support expiration
- Support revocation
- Expose only safe customer-facing fields
- Never expose cost, margin, supplier rates, or internal notes

Public share pages must not query broad internal tables directly.

Use a safe server-side function or sanitized API route.

---

## 16. Database Audit Checklist

Before completing schema work, verify:

- [ ] Table exists
- [ ] `company_id` exists where required
- [ ] Primary key exists
- [ ] Foreign keys exist
- [ ] RLS enabled
- [ ] SELECT policy safe
- [ ] INSERT policy safe
- [ ] UPDATE policy safe
- [ ] DELETE policy safe
- [ ] Indexes added
- [ ] Check constraints align with frontend
- [ ] TypeScript types updated
- [ ] Zod schemas updated
- [ ] Queries updated
- [ ] Tests or manual checks added
