# Coding Standards — ExtrusionOS

## 1. TypeScript

Use TypeScript strictly.

Avoid `any` unless there is a strong reason.

Prefer explicit types for:

- Props
- Server action inputs
- Query outputs
- Calculation inputs/outputs
- Permission objects
- PDF data objects

Use shared types from `/types` or `/lib/*/types.ts`.

## 2. Component Standards

Components should be:

- Small enough to understand
- Named clearly
- Typed with props interfaces
- Reusable where practical
- Free of business calculation logic

Bad:

```tsx
export default function Component() { ... }
```

Good:

```tsx
interface OrderStageCardProps {
  order: OrderSummary;
  onOpen: (id: string) => void;
}

export function OrderStageCard({ order, onOpen }: OrderStageCardProps) { ... }
```

## 3. Naming Conventions

Use clear names:

- `CustomerForm`
- `QuoteSummaryCard`
- `OrderStageBoard`
- `DispatchDatabaseTable`
- `InventoryMovementForm`
- `calculateQuoteTotals`
- `formatINR`
- `getCurrentUserCompanyId`

Avoid vague names:

- `Thing`
- `DataBox`
- `MainComp`
- `handleStuff`

## 4. Form Standards

Use React Hook Form and Zod.

Each form should have:

- Default values
- Validation schema
- Loading state
- Submit disabled while saving
- Field-level errors
- Toast or visible success/error state
- Cancel/back action

Do not allow duplicate submissions.

## 5. Query Standards

Prefer query modules:

```text
/lib/queries/customers.ts
/lib/queries/orders.ts
```

Queries should:

- Select only needed columns
- Use company scope
- Use pagination where needed
- Return typed results
- Handle Supabase errors

## 6. Server Actions and API Routes

Every sensitive server action/API route should:

1. Authenticate user
2. Fetch user company/role
3. Validate input with Zod
4. Check permission
5. Perform action
6. Return sanitized result
7. Log audit event if sensitive

## 7. Error Handling

Do not swallow errors silently.

Do not expose stack traces to users.

Use friendly messages:

- “Could not create quote.”
- “You do not have permission to approve this quote.”
- “This record was not found.”

Log technical details server-side if logging exists.

## 8. Formatting Utilities

Centralize formatting:

```text
/lib/formatters/currency.ts
/lib/formatters/date.ts
/lib/formatters/number.ts
/lib/formatters/weight.ts
```

Use:

- INR formatting
- Indian number grouping
- kg, kg/m, meters
- DD MMM YYYY date style

## 9. Calculation Utilities

Centralize calculations:

```text
/lib/calculations/quote-calculations.ts
/lib/calculations/inventory-calculations.ts
/lib/calculations/payment-calculations.ts
/lib/calculations/yield-calculations.ts
```

Every calculation utility should:

- Validate inputs or safely handle invalid values
- Avoid divide-by-zero
- Avoid NaN output
- Return warnings/errors where useful
- Be unit tested

## 10. UI Components

Reusable UI components should avoid product-specific business logic.

Examples:

- `DataTable`
- `StatusBadge`
- `EmptyState`
- `LoadingSkeleton`
- `ConfirmDialog`

Business components may compose these:

- `QuoteStatusBoard`
- `OrderStageBoard`
- `DieStatusCard`

## 11. Comments

Use comments to explain non-obvious logic.

Do not comment obvious code.

Good comments explain why, not just what.

## 12. Testing

At minimum, unit test:

- Quote calculations
- Payment balance
- Inventory movement
- Permission helper
- Status transition helpers
- Configurator engines if enabled

Do not skip tests for calculation-heavy logic.

## 13. Imports

Use consistent import aliases if configured.

Prefer:

```ts
import { formatINR } from '@/lib/formatters/currency';
```

Avoid long relative paths when aliases exist.

## 14. Accessibility

UI should include:

- Labels for inputs
- Focus states
- Button text or aria-labels
- Sufficient contrast
- Keyboard-friendly controls
- Non-color-only status indicators where practical

## 15. Code Review Checklist

Before finishing:

- [ ] No `any` added unnecessarily
- [ ] No service role key in client code
- [ ] No business logic duplicated in components
- [ ] Inputs validated
- [ ] Permissions checked
- [ ] RLS preserved
- [ ] Loading/empty/error states present
- [ ] Build/typecheck/lint considered
