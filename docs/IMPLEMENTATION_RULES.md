# Implementation Rules — ExtrusionOS

These rules apply to all coding work in this project.

## 1. Do Not Overbuild

ExtrusionOS should be powerful but not bloated.

Do not add unrelated modules unless requested.

Every feature must serve a real aluminium business workflow.

## 2. Make Small, Safe Changes

Before making large changes:

1. Audit the current implementation.
2. Identify root cause.
3. Propose safe fix.
4. Modify only needed files.
5. Run checks.

## 3. Preserve Existing Data

Do not delete or destructively alter tables/columns unless explicitly approved.

Use safe migrations.

Prefer additive changes.

## 4. Follow Route Patterns

Major modules should follow:

```text
/module
/module/database
/module/new
/module/[id]
/module/[id]/edit
```

Do not cram all workflows into one page.

## 5. Database Pages Must Be Paginated

Every database page should:

- Show 10 rows by default
- Use Supabase `.range()`
- Support search
- Support sorting
- Support filters
- Use server-side pagination

## 6. Status Workflows Use Boards

Modules with statuses should use grouped cards/boards on overview pages.

Examples:

- Orders by stage
- Quotes by status
- Dispatches by delivery status
- Production by job status
- Dies by die status
- Inventory by stock status

## 7. Use Centralized Calculations

Centralize:

- Quote calculations
- GST calculations
- Margin/profit calculations
- Inventory stock calculations
- Payment balance calculations
- Yield/recovery calculations
- Cutting list calculations
- Glass-size calculations
- Hardware BOM calculations

## 8. Never Trust Frontend Company ID

Bad:

```ts
company_id: values.company_id
```

Good:

```ts
company_id: currentUser.company_id
```

Company ID must come from authenticated user context.

## 9. Validate Inputs

Use Zod for:

- Forms
- API routes
- Server actions
- Public endpoints
- File upload metadata
- Calculation inputs

## 10. Customer-Facing Data Must Be Sanitized

Customer-facing views and PDFs must not expose:

- Internal cost
- Profit
- Margin
- Supplier rates
- Internal notes
- Other customer records
- Other company records

## 11. Add Audit Logs for Sensitive Actions

Audit these actions:

- Quote approval
- Low-margin approval
- Quote converted to order
- Order stage changed
- Dispatch created
- Payment recorded
- Inventory adjusted
- User role changed
- Company settings changed
- Data exported
- File uploaded/deleted

## 12. Do Not Create Fake Features

If a button exists, it should work or be clearly disabled with explanation.

Do not create fake “Export,” “Send,” “Generate,” or “Approve” buttons.

## 13. UI Must Stay Simple

The target users are MSME owners and factory employees.

Avoid:

- Too much data at once
- Confusing forms
- Tiny buttons
- Generic admin design
- Heavy jargon without context

Use:

- Clear cards
- Clear statuses
- Clear actions
- Helpful empty states
- Simple forms
- Guided workflows

## 14. Run Checks

Before completing work, run available checks:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

If commands do not exist, document that.

## 15. Report Changes Clearly

After work, report:

1. What changed
2. Why
3. Files created
4. Files modified
5. Database migrations
6. RLS/security changes
7. Tests
8. Commands run
9. Manual testing checklist
10. Known limitations

## 16. Fix Order

When fixing bugs/security issues, prioritize:

1. Cross-company data leakage
2. RLS vulnerabilities
3. Auth bypasses
4. Service role key exposure
5. Public route data leaks
6. Build/type errors
7. Broken database/schema mismatches
8. Broken Supabase queries
9. Broken calculations
10. File upload/storage vulnerabilities
11. UI bugs
12. Cleanup

## 17. Migration Rules

For migrations:

- Add new migration files.
- Do not edit old migrations unless project is local/unreleased.
- Add RLS with new tables.
- Add indexes with new high-volume tables.
- Add constraints carefully.
- Backfill before NOT NULL constraints.
- Preserve existing data.

## 18. Completion Definition

A feature is not complete unless:

- UI exists
- Database exists if needed
- RLS exists if company data
- Validation exists
- Server-side permission checks exist for sensitive actions
- Loading/empty/error states exist
- Tests exist where practical
- Manual test path is documented
- No fake buttons remain
