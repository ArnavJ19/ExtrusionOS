# UI, UX and Operator Audit

MFA-009 reproduces camera denial under the configured global header in Chromium. The route renders an Open camera button and a typed-code fallback. Test artifacts also exercise mounted controls at phone and desktop widths. The isolated keypad test passed at 375 px after localhost access was available. Mounted fixtures represent their supplied role and data state. Actual signed-in persistence, tablets, devices and factory observation are separate acceptance work.

| Scenario | Evidence | Remaining acceptance |
|---|---|---|
| Stock overview | Reservation overstatement and malformed-response zeros reproduced | Verify owner/stores totals during partial holds and late QC |
| Camera QR | Synthetic camera works under control policy and fails under the configured header | Test deployed mobile camera, permission denial, light/damage, scan routing and physical bundle identity |
| Workstation entry | Actual React keypad fixture executed at phone width | Test tablets, shared devices, keyboard/large text, interrupted network and an approved shift |
| Shared record pages | November tests exercise search, pagination, stale selection, read errors, numeric display and double submissions | Per-route desktop/tablet/phone acceptance and committed ledger effects |
| Documents | PDF and print-related routes inventoried and fixture tests executed | Check representative customer identities, page breaks, fonts, ownership and signed link expiry in staging |
| Onboarding | Built local signup redirected to login. Latest production deployment source still contains signup | Verify invitation and suspension journeys in the final bound environment |
| Signed-out deep links | Built `/scan` redirected to Account Unavailable for the SDK's ordinary missing-session response. Login layout fit 375, 768 and 1280 px | Restore the normal sign-in and return journey while preserving actual service-failure handling. MFA-016 |

The later order-to-cash capture adds `/orders/credit`, `/production/drafts`, `/invoices/drafts`, `/invoices/tax-rules`, `/payments/bank`, `/payments/reminders` and `/settings/data/duplicates`. Its mounted browser checks cover credit, job drafts, invoice drafts, GST, matching and reminders at 375 and 1280 px. The expired-quote positive path used an incomplete fixture. This is a separate result from the primary route index. [Later capture](evidence/later-checkpoint.json) · [Focused suite](evidence/later-candidate-focused.log)

## Route Index

Every captured route is listed below. “Indexed” records source discovery. “Traced” records specific audit work described above. Browser fixture coverage is recorded by case, and the index gives no blanket per-route interaction pass.

| Route | Surface | Handler or page | Scope |
|---|---|---|---|
| `/accept-invite` | auth | `app/(auth)/accept-invite/page.tsx` | Indexed |
| `/access-suspended` | auth | `app/(auth)/access-suspended/page.tsx` | Indexed |
| `/account-unavailable` | auth | `app/(auth)/account-unavailable/page.tsx` | Indexed |
| `/login` | auth | `app/(auth)/login/page.tsx` | Indexed |
| `/onboarding` | auth | `app/(auth)/onboarding/page.tsx` | Traced |
| `/signup` | auth | `app/(auth)/signup/page.tsx` | Traced |
| `/ai/quotation-assistant` | app | `app/(dashboard)/ai/quotation-assistant/page.tsx` | Indexed |
| `/analytics` | app | `app/(dashboard)/analytics/page.tsx` | Indexed |
| `/audit-logs` | app | `app/(dashboard)/audit-logs/page.tsx` | Indexed |
| `/automation/first-automation` | app | `app/(dashboard)/automation/first-automation/page.tsx` | Indexed |
| `/automation` | app | `app/(dashboard)/automation/page.tsx` | Indexed |
| `/barcode` | app | `app/(dashboard)/barcode/page.tsx` | Indexed |
| `/command-center` | app | `app/(dashboard)/command-center/page.tsx` | Indexed |
| `/communications/whatsapp` | app | `app/(dashboard)/communications/whatsapp/page.tsx` | Indexed |
| `/compliance` | app | `app/(dashboard)/compliance/page.tsx` | Indexed |
| `/crm` | app | `app/(dashboard)/crm/page.tsx` | Indexed |
| `/customers/[id]/edit` | app | `app/(dashboard)/customers/[id]/edit/page.tsx` | Indexed |
| `/customers/[id]` | app | `app/(dashboard)/customers/[id]/page.tsx` | Indexed |
| `/customers/[id]/requirements/new` | app | `app/(dashboard)/customers/[id]/requirements/new/page.tsx` | Indexed |
| `/customers/[id]/requirements` | app | `app/(dashboard)/customers/[id]/requirements/page.tsx` | Indexed |
| `/customers/[id]/work` | app | `app/(dashboard)/customers/[id]/work/page.tsx` | Indexed |
| `/customers/database` | app | `app/(dashboard)/customers/database/page.tsx` | Indexed |
| `/customers/new` | app | `app/(dashboard)/customers/new/page.tsx` | Indexed |
| `/customers` | app | `app/(dashboard)/customers/page.tsx` | Indexed |
| `/customers/portal-responses` | app | `app/(dashboard)/customers/portal-responses/page.tsx` | Indexed |
| `/customers/projects/[id]/edit` | app | `app/(dashboard)/customers/projects/[id]/edit/page.tsx` | Indexed |
| `/customers/projects/[id]` | app | `app/(dashboard)/customers/projects/[id]/page.tsx` | Indexed |
| `/customers/projects/new` | app | `app/(dashboard)/customers/projects/new/page.tsx` | Indexed |
| `/customers/projects` | app | `app/(dashboard)/customers/projects/page.tsx` | Indexed |
| `/dashboard` | app | `app/(dashboard)/dashboard/page.tsx` | Traced |
| `/dealer-inventory` | app | `app/(dashboard)/dealer-inventory/page.tsx` | Indexed |
| `/dealer-orders/[id]` | app | `app/(dashboard)/dealer-orders/[id]/page.tsx` | Indexed |
| `/dealer-orders/database` | app | `app/(dashboard)/dealer-orders/database/page.tsx` | Indexed |
| `/dealer-orders/new` | app | `app/(dashboard)/dealer-orders/new/page.tsx` | Indexed |
| `/dealer-orders` | app | `app/(dashboard)/dealer-orders/page.tsx` | Traced |
| `/dealer-orders/quote-orders/[id]` | app | `app/(dashboard)/dealer-orders/quote-orders/[id]/page.tsx` | Indexed |
| `/die-intelligence` | app | `app/(dashboard)/die-intelligence/page.tsx` | Indexed |
| `/dies/[id]/edit` | app | `app/(dashboard)/dies/[id]/edit/page.tsx` | Indexed |
| `/dies/[id]` | app | `app/(dashboard)/dies/[id]/page.tsx` | Indexed |
| `/dies/[id]/work` | app | `app/(dashboard)/dies/[id]/work/page.tsx` | Indexed |
| `/dies/database` | app | `app/(dashboard)/dies/database/page.tsx` | Indexed |
| `/dies/new` | app | `app/(dashboard)/dies/new/page.tsx` | Indexed |
| `/dies` | app | `app/(dashboard)/dies/page.tsx` | Indexed |
| `/discrepancies` | app | `app/(dashboard)/discrepancies/page.tsx` | Indexed |
| `/dispatches/[id]/edit` | app | `app/(dashboard)/dispatches/[id]/edit/page.tsx` | Indexed |
| `/dispatches/[id]` | app | `app/(dashboard)/dispatches/[id]/page.tsx` | Indexed |
| `/dispatches/[id]/returns` | app | `app/(dashboard)/dispatches/[id]/returns/page.tsx` | Indexed |
| `/dispatches/[id]/work` | app | `app/(dashboard)/dispatches/[id]/work/page.tsx` | Indexed |
| `/dispatches/bundles/new` | app | `app/(dashboard)/dispatches/bundles/new/page.tsx` | Indexed |
| `/dispatches/database` | app | `app/(dashboard)/dispatches/database/page.tsx` | Indexed |
| `/dispatches/loads` | app | `app/(dashboard)/dispatches/loads/page.tsx` | Indexed |
| `/dispatches/new` | app | `app/(dashboard)/dispatches/new/page.tsx` | Indexed |
| `/dispatches` | app | `app/(dashboard)/dispatches/page.tsx` | Indexed |
| `/dispatches/work` | app | `app/(dashboard)/dispatches/work/page.tsx` | Indexed |
| `/documents/intelligence` | app | `app/(dashboard)/documents/intelligence/page.tsx` | Indexed |
| `/documents` | app | `app/(dashboard)/documents/page.tsx` | Indexed |
| `/energy` | app | `app/(dashboard)/energy/page.tsx` | Indexed |
| `/expenses/[id]/edit` | app | `app/(dashboard)/expenses/[id]/edit/page.tsx` | Indexed |
| `/expenses/[id]` | app | `app/(dashboard)/expenses/[id]/page.tsx` | Indexed |
| `/expenses/database` | app | `app/(dashboard)/expenses/database/page.tsx` | Indexed |
| `/expenses/new` | app | `app/(dashboard)/expenses/new/page.tsx` | Indexed |
| `/expenses` | app | `app/(dashboard)/expenses/page.tsx` | Indexed |
| `/expenses/payments/[id]/edit` | app | `app/(dashboard)/expenses/payments/[id]/edit/page.tsx` | Indexed |
| `/expenses/payments/[id]` | app | `app/(dashboard)/expenses/payments/[id]/page.tsx` | Indexed |
| `/expenses/payments/database` | app | `app/(dashboard)/expenses/payments/database/page.tsx` | Indexed |
| `/expenses/payments/new` | app | `app/(dashboard)/expenses/payments/new/page.tsx` | Indexed |
| `/expenses/payments` | app | `app/(dashboard)/expenses/payments/page.tsx` | Indexed |
| `/expenses/pending-approvals` | app | `app/(dashboard)/expenses/pending-approvals/page.tsx` | Indexed |
| `/exports` | app | `app/(dashboard)/exports/page.tsx` | Indexed |
| `/foundry/[id]/edit` | app | `app/(dashboard)/foundry/[id]/edit/page.tsx` | Indexed |
| `/foundry/[id]` | app | `app/(dashboard)/foundry/[id]/page.tsx` | Indexed |
| `/foundry/billets/[id]/edit` | app | `app/(dashboard)/foundry/billets/[id]/edit/page.tsx` | Indexed |
| `/foundry/billets/[id]` | app | `app/(dashboard)/foundry/billets/[id]/page.tsx` | Indexed |
| `/foundry/billets/database` | app | `app/(dashboard)/foundry/billets/database/page.tsx` | Indexed |
| `/foundry/billets` | app | `app/(dashboard)/foundry/billets/page.tsx` | Indexed |
| `/foundry/database` | app | `app/(dashboard)/foundry/database/page.tsx` | Indexed |
| `/foundry/external-sources/[id]/edit` | app | `app/(dashboard)/foundry/external-sources/[id]/edit/page.tsx` | Indexed |
| `/foundry/external-sources/[id]` | app | `app/(dashboard)/foundry/external-sources/[id]/page.tsx` | Indexed |
| `/foundry/external-sources/database` | app | `app/(dashboard)/foundry/external-sources/database/page.tsx` | Indexed |
| `/foundry/external-sources/new` | app | `app/(dashboard)/foundry/external-sources/new/page.tsx` | Indexed |
| `/foundry/external-sources` | app | `app/(dashboard)/foundry/external-sources/page.tsx` | Indexed |
| `/foundry/new` | app | `app/(dashboard)/foundry/new/page.tsx` | Indexed |
| `/foundry/outsourced-billets/[id]/edit` | app | `app/(dashboard)/foundry/outsourced-billets/[id]/edit/page.tsx` | Indexed |
| `/foundry/outsourced-billets/[id]` | app | `app/(dashboard)/foundry/outsourced-billets/[id]/page.tsx` | Indexed |
| `/foundry/outsourced-billets/database` | app | `app/(dashboard)/foundry/outsourced-billets/database/page.tsx` | Indexed |
| `/foundry/outsourced-billets` | app | `app/(dashboard)/foundry/outsourced-billets/page.tsx` | Indexed |
| `/foundry` | app | `app/(dashboard)/foundry/page.tsx` | Indexed |
| `/foundry/scrap/[id]/edit` | app | `app/(dashboard)/foundry/scrap/[id]/edit/page.tsx` | Indexed |
| `/foundry/scrap/[id]` | app | `app/(dashboard)/foundry/scrap/[id]/page.tsx` | Indexed |
| `/foundry/scrap/database` | app | `app/(dashboard)/foundry/scrap/database/page.tsx` | Indexed |
| `/foundry/scrap/new` | app | `app/(dashboard)/foundry/scrap/new/page.tsx` | Indexed |
| `/foundry/scrap` | app | `app/(dashboard)/foundry/scrap/page.tsx` | Indexed |
| `/inventory/[id]/edit` | app | `app/(dashboard)/inventory/[id]/edit/page.tsx` | Indexed |
| `/inventory/[id]` | app | `app/(dashboard)/inventory/[id]/page.tsx` | Indexed |
| `/inventory/database` | app | `app/(dashboard)/inventory/database/page.tsx` | Indexed |
| `/inventory/new` | app | `app/(dashboard)/inventory/new/page.tsx` | Indexed |
| `/inventory` | app | `app/(dashboard)/inventory/page.tsx` | Indexed |
| `/inventory/reservations` | app | `app/(dashboard)/inventory/reservations/page.tsx` | Indexed |
| `/inventory/stock-balances/[id]` | app | `app/(dashboard)/inventory/stock-balances/[id]/page.tsx` | Indexed |
| `/inventory/stock-balances` | app | `app/(dashboard)/inventory/stock-balances/page.tsx` | Indexed |
| `/inventory/work` | app | `app/(dashboard)/inventory/work/page.tsx` | Indexed |
| `/invoices/[id]/edit` | app | `app/(dashboard)/invoices/[id]/edit/page.tsx` | Indexed |
| `/invoices/[id]` | app | `app/(dashboard)/invoices/[id]/page.tsx` | Indexed |
| `/invoices/[id]/work` | app | `app/(dashboard)/invoices/[id]/work/page.tsx` | Indexed |
| `/invoices/database` | app | `app/(dashboard)/invoices/database/page.tsx` | Indexed |
| `/invoices/eligibility` | app | `app/(dashboard)/invoices/eligibility/page.tsx` | Indexed |
| `/invoices/new` | app | `app/(dashboard)/invoices/new/page.tsx` | Indexed |
| `/invoices/numbering` | app | `app/(dashboard)/invoices/numbering/page.tsx` | Indexed |
| `/invoices` | app | `app/(dashboard)/invoices/page.tsx` | Indexed |
| `/invoices/periods` | app | `app/(dashboard)/invoices/periods/page.tsx` | Indexed |
| `/invoices/work` | app | `app/(dashboard)/invoices/work/page.tsx` | Indexed |
| `/machines/[id]/edit` | app | `app/(dashboard)/machines/[id]/edit/page.tsx` | Indexed |
| `/machines/[id]` | app | `app/(dashboard)/machines/[id]/page.tsx` | Indexed |
| `/machines/[id]/work` | app | `app/(dashboard)/machines/[id]/work/page.tsx` | Indexed |
| `/machines/database` | app | `app/(dashboard)/machines/database/page.tsx` | Indexed |
| `/machines/new` | app | `app/(dashboard)/machines/new/page.tsx` | Indexed |
| `/machines` | app | `app/(dashboard)/machines/page.tsx` | Indexed |
| `/maintenance` | app | `app/(dashboard)/maintenance/page.tsx` | Indexed |
| `/mobile/dispatch/bundles` | app | `app/(dashboard)/mobile/dispatch/bundles/page.tsx` | Indexed |
| `/mobile/dispatch` | app | `app/(dashboard)/mobile/dispatch/page.tsx` | Indexed |
| `/mobile/jobs` | app | `app/(dashboard)/mobile/jobs/page.tsx` | Indexed |
| `/mobile` | app | `app/(dashboard)/mobile/page.tsx` | Indexed |
| `/mobile/quality/[id]` | app | `app/(dashboard)/mobile/quality/[id]/page.tsx` | Indexed |
| `/mobile/quality` | app | `app/(dashboard)/mobile/quality/page.tsx` | Indexed |
| `/mobile/scan` | app | `app/(dashboard)/mobile/scan/page.tsx` | Traced |
| `/mobile/tasks` | app | `app/(dashboard)/mobile/tasks/page.tsx` | Indexed |
| `/notifications/following` | app | `app/(dashboard)/notifications/following/page.tsx` | Indexed |
| `/notifications` | app | `app/(dashboard)/notifications/page.tsx` | Indexed |
| `/notifications/requests` | app | `app/(dashboard)/notifications/requests/page.tsx` | Indexed |
| `/orders/[id]/cutting` | app | `app/(dashboard)/orders/[id]/cutting/page.tsx` | Indexed |
| `/orders/[id]/edit` | app | `app/(dashboard)/orders/[id]/edit/page.tsx` | Indexed |
| `/orders/[id]` | app | `app/(dashboard)/orders/[id]/page.tsx` | Indexed |
| `/orders/[id]/requirements` | app | `app/(dashboard)/orders/[id]/requirements/page.tsx` | Indexed |
| `/orders/[id]/stock-plan` | app | `app/(dashboard)/orders/[id]/stock-plan/page.tsx` | Indexed |
| `/orders/[id]/work` | app | `app/(dashboard)/orders/[id]/work/page.tsx` | Indexed |
| `/orders/database` | app | `app/(dashboard)/orders/database/page.tsx` | Indexed |
| `/orders/new` | app | `app/(dashboard)/orders/new/page.tsx` | Indexed |
| `/orders` | app | `app/(dashboard)/orders/page.tsx` | Indexed |
| `/packaging/[id]/edit` | app | `app/(dashboard)/packaging/[id]/edit/page.tsx` | Indexed |
| `/packaging/[id]` | app | `app/(dashboard)/packaging/[id]/page.tsx` | Indexed |
| `/packaging/database` | app | `app/(dashboard)/packaging/database/page.tsx` | Indexed |
| `/packaging/materials/[id]/edit` | app | `app/(dashboard)/packaging/materials/[id]/edit/page.tsx` | Indexed |
| `/packaging/materials/[id]` | app | `app/(dashboard)/packaging/materials/[id]/page.tsx` | Indexed |
| `/packaging/materials/database` | app | `app/(dashboard)/packaging/materials/database/page.tsx` | Indexed |
| `/packaging/materials/new` | app | `app/(dashboard)/packaging/materials/new/page.tsx` | Indexed |
| `/packaging/materials` | app | `app/(dashboard)/packaging/materials/page.tsx` | Indexed |
| `/packaging/new` | app | `app/(dashboard)/packaging/new/page.tsx` | Indexed |
| `/packaging` | app | `app/(dashboard)/packaging/page.tsx` | Indexed |
| `/packaging/purchases/[id]/edit` | app | `app/(dashboard)/packaging/purchases/[id]/edit/page.tsx` | Indexed |
| `/packaging/purchases/[id]` | app | `app/(dashboard)/packaging/purchases/[id]/page.tsx` | Indexed |
| `/packaging/purchases/database` | app | `app/(dashboard)/packaging/purchases/database/page.tsx` | Indexed |
| `/packaging/purchases/new` | app | `app/(dashboard)/packaging/purchases/new/page.tsx` | Indexed |
| `/packaging/purchases` | app | `app/(dashboard)/packaging/purchases/page.tsx` | Indexed |
| `/payments/[id]/edit` | app | `app/(dashboard)/payments/[id]/edit/page.tsx` | Indexed |
| `/payments/[id]` | app | `app/(dashboard)/payments/[id]/page.tsx` | Indexed |
| `/payments/database` | app | `app/(dashboard)/payments/database/page.tsx` | Indexed |
| `/payments/new` | app | `app/(dashboard)/payments/new/page.tsx` | Indexed |
| `/payments` | app | `app/(dashboard)/payments/page.tsx` | Indexed |
| `/payments/receipts` | app | `app/(dashboard)/payments/receipts/page.tsx` | Indexed |
| `/production/[id]/edit` | app | `app/(dashboard)/production/[id]/edit/page.tsx` | Indexed |
| `/production/[id]` | app | `app/(dashboard)/production/[id]/page.tsx` | Indexed |
| `/production/[id]/work` | app | `app/(dashboard)/production/[id]/work/page.tsx` | Indexed |
| `/production/bulk` | app | `app/(dashboard)/production/bulk/page.tsx` | Indexed |
| `/production/calendar` | app | `app/(dashboard)/production/calendar/page.tsx` | Indexed |
| `/production/capacity` | app | `app/(dashboard)/production/capacity/page.tsx` | Indexed |
| `/production/consolidation` | app | `app/(dashboard)/production/consolidation/page.tsx` | Indexed |
| `/production/cutting/rules` | app | `app/(dashboard)/production/cutting/rules/page.tsx` | Indexed |
| `/production/database` | app | `app/(dashboard)/production/database/page.tsx` | Indexed |
| `/production/finishing/[id]` | app | `app/(dashboard)/production/finishing/[id]/page.tsx` | Indexed |
| `/production/finishing/database` | app | `app/(dashboard)/production/finishing/database/page.tsx` | Indexed |
| `/production/finishing` | app | `app/(dashboard)/production/finishing/page.tsx` | Indexed |
| `/production/floor` | app | `app/(dashboard)/production/floor/page.tsx` | Traced |
| `/production/handover/[id]` | app | `app/(dashboard)/production/handover/[id]/page.tsx` | Indexed |
| `/production/handover/new` | app | `app/(dashboard)/production/handover/new/page.tsx` | Indexed |
| `/production/handover` | app | `app/(dashboard)/production/handover/page.tsx` | Indexed |
| `/production/new` | app | `app/(dashboard)/production/new/page.tsx` | Indexed |
| `/production` | app | `app/(dashboard)/production/page.tsx` | Indexed |
| `/production/schedule` | app | `app/(dashboard)/production/schedule/page.tsx` | Indexed |
| `/production/scrap-standards` | app | `app/(dashboard)/production/scrap-standards/page.tsx` | Indexed |
| `/production/usage` | app | `app/(dashboard)/production/usage/page.tsx` | Indexed |
| `/production/work` | app | `app/(dashboard)/production/work/page.tsx` | Indexed |
| `/production/workstation` | app | `app/(dashboard)/production/workstation/page.tsx` | Indexed |
| `/profiles/[id]/edit` | app | `app/(dashboard)/profiles/[id]/edit/page.tsx` | Indexed |
| `/profiles/[id]` | app | `app/(dashboard)/profiles/[id]/page.tsx` | Indexed |
| `/profiles/[id]/specifications` | app | `app/(dashboard)/profiles/[id]/specifications/page.tsx` | Indexed |
| `/profiles/[id]/work` | app | `app/(dashboard)/profiles/[id]/work/page.tsx` | Indexed |
| `/profiles/database` | app | `app/(dashboard)/profiles/database/page.tsx` | Indexed |
| `/profiles/new` | app | `app/(dashboard)/profiles/new/page.tsx` | Indexed |
| `/profiles` | app | `app/(dashboard)/profiles/page.tsx` | Indexed |
| `/profitability` | app | `app/(dashboard)/profitability/page.tsx` | Indexed |
| `/quality/[id]/edit` | app | `app/(dashboard)/quality/[id]/edit/page.tsx` | Indexed |
| `/quality/[id]` | app | `app/(dashboard)/quality/[id]/page.tsx` | Indexed |
| `/quality/database` | app | `app/(dashboard)/quality/database/page.tsx` | Indexed |
| `/quality/new` | app | `app/(dashboard)/quality/new/page.tsx` | Indexed |
| `/quality` | app | `app/(dashboard)/quality/page.tsx` | Indexed |
| `/quality/plans/[id]` | app | `app/(dashboard)/quality/plans/[id]/page.tsx` | Indexed |
| `/quality/plans/new` | app | `app/(dashboard)/quality/plans/new/page.tsx` | Indexed |
| `/quality/plans` | app | `app/(dashboard)/quality/plans/page.tsx` | Indexed |
| `/quality/samples/[id]` | app | `app/(dashboard)/quality/samples/[id]/page.tsx` | Indexed |
| `/quality/samples` | app | `app/(dashboard)/quality/samples/page.tsx` | Indexed |
| `/quality/samples/triggers` | app | `app/(dashboard)/quality/samples/triggers/page.tsx` | Indexed |
| `/quality/work` | app | `app/(dashboard)/quality/work/page.tsx` | Indexed |
| `/quotes/[id]/edit` | app | `app/(dashboard)/quotes/[id]/edit/page.tsx` | Indexed |
| `/quotes/[id]` | app | `app/(dashboard)/quotes/[id]/page.tsx` | Indexed |
| `/quotes/[id]/review` | app | `app/(dashboard)/quotes/[id]/review/page.tsx` | Indexed |
| `/quotes/[id]/work` | app | `app/(dashboard)/quotes/[id]/work/page.tsx` | Indexed |
| `/quotes/database` | app | `app/(dashboard)/quotes/database/page.tsx` | Indexed |
| `/quotes/new` | app | `app/(dashboard)/quotes/new/page.tsx` | Indexed |
| `/quotes` | app | `app/(dashboard)/quotes/page.tsx` | Indexed |
| `/quotes/rates/new` | app | `app/(dashboard)/quotes/rates/new/page.tsx` | Indexed |
| `/quotes/rates` | app | `app/(dashboard)/quotes/rates/page.tsx` | Indexed |
| `/report-builder` | app | `app/(dashboard)/report-builder/page.tsx` | Indexed |
| `/reports` | app | `app/(dashboard)/reports/page.tsx` | Indexed |
| `/scan` | app | `app/(dashboard)/scan/page.tsx` | Traced |
| `/search` | app | `app/(dashboard)/search/page.tsx` | Indexed |
| `/settings/access` | app | `app/(dashboard)/settings/access/page.tsx` | Indexed |
| `/settings/branding` | app | `app/(dashboard)/settings/branding/page.tsx` | Indexed |
| `/settings/data/cutover` | app | `app/(dashboard)/settings/data/cutover/page.tsx` | Indexed |
| `/settings/data/import` | app | `app/(dashboard)/settings/data/import/page.tsx` | Indexed |
| `/settings/data` | app | `app/(dashboard)/settings/data/page.tsx` | Indexed |
| `/settings/enterprise` | app | `app/(dashboard)/settings/enterprise/page.tsx` | Indexed |
| `/settings/integrations` | app | `app/(dashboard)/settings/integrations/page.tsx` | Indexed |
| `/settings/master-cleanup` | app | `app/(dashboard)/settings/master-cleanup/page.tsx` | Indexed |
| `/settings/navigation` | app | `app/(dashboard)/settings/navigation/page.tsx` | Indexed |
| `/settings` | app | `app/(dashboard)/settings/page.tsx` | Indexed |
| `/settings/security` | app | `app/(dashboard)/settings/security/page.tsx` | Indexed |
| `/shipments/[id]/receipt` | app | `app/(dashboard)/shipments/[id]/receipt/page.tsx` | Indexed |
| `/systems-configurator/libraries` | app | `app/(dashboard)/systems-configurator/libraries/page.tsx` | Indexed |
| `/systems-configurator/new` | app | `app/(dashboard)/systems-configurator/new/page.tsx` | Indexed |
| `/systems-configurator` | app | `app/(dashboard)/systems-configurator/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]/bom` | app | `app/(dashboard)/systems-configurator/projects/[id]/bom/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]/cutting-list` | app | `app/(dashboard)/systems-configurator/projects/[id]/cutting-list/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]/edit` | app | `app/(dashboard)/systems-configurator/projects/[id]/edit/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]/glass-list` | app | `app/(dashboard)/systems-configurator/projects/[id]/glass-list/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]/optimization` | app | `app/(dashboard)/systems-configurator/projects/[id]/optimization/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]` | app | `app/(dashboard)/systems-configurator/projects/[id]/page.tsx` | Indexed |
| `/systems-configurator/projects/[id]/quote` | app | `app/(dashboard)/systems-configurator/projects/[id]/quote/page.tsx` | Indexed |
| `/systems-configurator/projects` | app | `app/(dashboard)/systems-configurator/projects/page.tsx` | Indexed |
| `/systems-configurator/reports` | app | `app/(dashboard)/systems-configurator/reports/page.tsx` | Indexed |
| `/systems-configurator/setup` | app | `app/(dashboard)/systems-configurator/setup/page.tsx` | Indexed |
| `/systems-configurator/templates/[id]/formula` | app | `app/(dashboard)/systems-configurator/templates/[id]/formula/page.tsx` | Indexed |
| `/systems-configurator/templates/[id]` | app | `app/(dashboard)/systems-configurator/templates/[id]/page.tsx` | Indexed |
| `/systems-configurator/templates` | app | `app/(dashboard)/systems-configurator/templates/page.tsx` | Indexed |
| `/tasks/[id]/assurance` | app | `app/(dashboard)/tasks/[id]/assurance/page.tsx` | Indexed |
| `/tasks/[id]/execute` | app | `app/(dashboard)/tasks/[id]/execute/page.tsx` | Indexed |
| `/tasks/[id]` | app | `app/(dashboard)/tasks/[id]/page.tsx` | Indexed |
| `/tasks/approvals/exceptions` | app | `app/(dashboard)/tasks/approvals/exceptions/page.tsx` | Indexed |
| `/tasks/approvals` | app | `app/(dashboard)/tasks/approvals/page.tsx` | Indexed |
| `/tasks/assurance/[view]/[id]` | app | `app/(dashboard)/tasks/assurance/[view]/[id]/page.tsx` | Indexed |
| `/tasks/assurance/database` | app | `app/(dashboard)/tasks/assurance/database/page.tsx` | Indexed |
| `/tasks/assurance/new` | app | `app/(dashboard)/tasks/assurance/new/page.tsx` | Indexed |
| `/tasks/assurance` | app | `app/(dashboard)/tasks/assurance/page.tsx` | Indexed |
| `/tasks/blueprints/[id]` | app | `app/(dashboard)/tasks/blueprints/[id]/page.tsx` | Indexed |
| `/tasks/blueprints/new` | app | `app/(dashboard)/tasks/blueprints/new/page.tsx` | Indexed |
| `/tasks/blueprints` | app | `app/(dashboard)/tasks/blueprints/page.tsx` | Indexed |
| `/tasks/bulk` | app | `app/(dashboard)/tasks/bulk/page.tsx` | Indexed |
| `/tasks/changes` | app | `app/(dashboard)/tasks/changes/page.tsx` | Indexed |
| `/tasks/commercial/[view]/[id]` | app | `app/(dashboard)/tasks/commercial/[view]/[id]/page.tsx` | Indexed |
| `/tasks/commercial/database` | app | `app/(dashboard)/tasks/commercial/database/page.tsx` | Indexed |
| `/tasks/commercial/new` | app | `app/(dashboard)/tasks/commercial/new/page.tsx` | Indexed |
| `/tasks/commercial` | app | `app/(dashboard)/tasks/commercial/page.tsx` | Indexed |
| `/tasks/commitments` | app | `app/(dashboard)/tasks/commitments/page.tsx` | Indexed |
| `/tasks/competencies` | app | `app/(dashboard)/tasks/competencies/page.tsx` | Indexed |
| `/tasks/control/[view]/[id]` | app | `app/(dashboard)/tasks/control/[view]/[id]/page.tsx` | Indexed |
| `/tasks/control/database` | app | `app/(dashboard)/tasks/control/database/page.tsx` | Indexed |
| `/tasks/control/new` | app | `app/(dashboard)/tasks/control/new/page.tsx` | Indexed |
| `/tasks/control` | app | `app/(dashboard)/tasks/control/page.tsx` | Indexed |
| `/tasks/coordination/[view]/[id]` | app | `app/(dashboard)/tasks/coordination/[view]/[id]/page.tsx` | Indexed |
| `/tasks/coordination/database` | app | `app/(dashboard)/tasks/coordination/database/page.tsx` | Indexed |
| `/tasks/coordination/new` | app | `app/(dashboard)/tasks/coordination/new/page.tsx` | Indexed |
| `/tasks/coordination` | app | `app/(dashboard)/tasks/coordination/page.tsx` | Indexed |
| `/tasks/criteria/[id]` | app | `app/(dashboard)/tasks/criteria/[id]/page.tsx` | Indexed |
| `/tasks/criteria/new` | app | `app/(dashboard)/tasks/criteria/new/page.tsx` | Indexed |
| `/tasks/criteria` | app | `app/(dashboard)/tasks/criteria/page.tsx` | Indexed |
| `/tasks/database` | app | `app/(dashboard)/tasks/database/page.tsx` | Indexed |
| `/tasks/delegations/[id]` | app | `app/(dashboard)/tasks/delegations/[id]/page.tsx` | Indexed |
| `/tasks/delegations` | app | `app/(dashboard)/tasks/delegations/page.tsx` | Indexed |
| `/tasks/execution/[view]/[id]` | app | `app/(dashboard)/tasks/execution/[view]/[id]/page.tsx` | Indexed |
| `/tasks/execution/database` | app | `app/(dashboard)/tasks/execution/database/page.tsx` | Indexed |
| `/tasks/execution/new` | app | `app/(dashboard)/tasks/execution/new/page.tsx` | Indexed |
| `/tasks/execution` | app | `app/(dashboard)/tasks/execution/page.tsx` | Indexed |
| `/tasks/handoffs` | app | `app/(dashboard)/tasks/handoffs/page.tsx` | Indexed |
| `/tasks/improvement/[view]/[id]` | app | `app/(dashboard)/tasks/improvement/[view]/[id]/page.tsx` | Indexed |
| `/tasks/improvement/database` | app | `app/(dashboard)/tasks/improvement/database/page.tsx` | Indexed |
| `/tasks/improvement/new` | app | `app/(dashboard)/tasks/improvement/new/page.tsx` | Indexed |
| `/tasks/improvement` | app | `app/(dashboard)/tasks/improvement/page.tsx` | Indexed |
| `/tasks/lifecycle/[view]/[id]` | app | `app/(dashboard)/tasks/lifecycle/[view]/[id]/page.tsx` | Indexed |
| `/tasks/lifecycle/database` | app | `app/(dashboard)/tasks/lifecycle/database/page.tsx` | Indexed |
| `/tasks/lifecycle/new` | app | `app/(dashboard)/tasks/lifecycle/new/page.tsx` | Indexed |
| `/tasks/lifecycle` | app | `app/(dashboard)/tasks/lifecycle/page.tsx` | Indexed |
| `/tasks/new` | app | `app/(dashboard)/tasks/new/page.tsx` | Indexed |
| `/tasks` | app | `app/(dashboard)/tasks/page.tsx` | Traced |
| `/tasks/practice` | app | `app/(dashboard)/tasks/practice/page.tsx` | Indexed |
| `/tasks/procedures/[id]/effectiveness` | app | `app/(dashboard)/tasks/procedures/[id]/effectiveness/page.tsx` | Indexed |
| `/tasks/procedures/[id]` | app | `app/(dashboard)/tasks/procedures/[id]/page.tsx` | Indexed |
| `/tasks/procedures/[id]/versions/[versionId]/execution` | app | `app/(dashboard)/tasks/procedures/[id]/versions/[versionId]/execution/page.tsx` | Indexed |
| `/tasks/procedures/[id]/versions/[versionId]` | app | `app/(dashboard)/tasks/procedures/[id]/versions/[versionId]/page.tsx` | Indexed |
| `/tasks/procedures/[id]/versions` | app | `app/(dashboard)/tasks/procedures/[id]/versions/page.tsx` | Indexed |
| `/tasks/procedures/new` | app | `app/(dashboard)/tasks/procedures/new/page.tsx` | Indexed |
| `/tasks/procedures` | app | `app/(dashboard)/tasks/procedures/page.tsx` | Indexed |
| `/tasks/routines/[id]` | app | `app/(dashboard)/tasks/routines/[id]/page.tsx` | Indexed |
| `/tasks/routines` | app | `app/(dashboard)/tasks/routines/page.tsx` | Indexed |
| `/tasks/specialist/[view]/[id]` | app | `app/(dashboard)/tasks/specialist/[view]/[id]/page.tsx` | Indexed |
| `/tasks/specialist/database` | app | `app/(dashboard)/tasks/specialist/database/page.tsx` | Indexed |
| `/tasks/specialist/new` | app | `app/(dashboard)/tasks/specialist/new/page.tsx` | Indexed |
| `/tasks/specialist` | app | `app/(dashboard)/tasks/specialist/page.tsx` | Indexed |
| `/tasks/triggers/[id]` | app | `app/(dashboard)/tasks/triggers/[id]/page.tsx` | Indexed |
| `/tasks/triggers/new` | app | `app/(dashboard)/tasks/triggers/new/page.tsx` | Indexed |
| `/tasks/triggers` | app | `app/(dashboard)/tasks/triggers/page.tsx` | Indexed |
| `/tasks/turnaround` | app | `app/(dashboard)/tasks/turnaround/page.tsx` | Indexed |
| `/tasks/verification` | app | `app/(dashboard)/tasks/verification/page.tsx` | Indexed |
| `/tenders` | app | `app/(dashboard)/tenders/page.tsx` | Indexed |
| `/vendors/[id]/edit` | app | `app/(dashboard)/vendors/[id]/edit/page.tsx` | Indexed |
| `/vendors/[id]` | app | `app/(dashboard)/vendors/[id]/page.tsx` | Indexed |
| `/vendors/[id]/work` | app | `app/(dashboard)/vendors/[id]/work/page.tsx` | Indexed |
| `/vendors/comparisons/[id]/offers/new` | app | `app/(dashboard)/vendors/comparisons/[id]/offers/new/page.tsx` | Indexed |
| `/vendors/comparisons/[id]` | app | `app/(dashboard)/vendors/comparisons/[id]/page.tsx` | Indexed |
| `/vendors/comparisons/database` | app | `app/(dashboard)/vendors/comparisons/database/page.tsx` | Indexed |
| `/vendors/comparisons/new` | app | `app/(dashboard)/vendors/comparisons/new/page.tsx` | Indexed |
| `/vendors/comparisons` | app | `app/(dashboard)/vendors/comparisons/page.tsx` | Indexed |
| `/vendors/database` | app | `app/(dashboard)/vendors/database/page.tsx` | Indexed |
| `/vendors/new` | app | `app/(dashboard)/vendors/new/page.tsx` | Indexed |
| `/vendors` | app | `app/(dashboard)/vendors/page.tsx` | Indexed |
| `/vendors/purchasing/database` | app | `app/(dashboard)/vendors/purchasing/database/page.tsx` | Indexed |
| `/vendors/purchasing` | app | `app/(dashboard)/vendors/purchasing/page.tsx` | Indexed |
| `/vendors/work` | app | `app/(dashboard)/vendors/work/page.tsx` | Indexed |
| `/api/access/invites/accept` | api POST | `app/api/access/invites/accept/route.ts` | Indexed |
| `/api/access/invites` | api POST | `app/api/access/invites/route.ts` | Indexed |
| `/api/access/roles` | api POST | `app/api/access/roles/route.ts` | Indexed |
| `/api/ai/quotation-assistant` | api POST | `app/api/ai/quotation-assistant/route.ts` | Indexed |
| `/api/collaboration-workflows` | api POST | `app/api/collaboration-workflows/route.ts` | Indexed |
| `/api/crm/leads` | api POST | `app/api/crm/leads/route.ts` | Indexed |
| `/api/cron/[schedule]` | api GET | `app/api/cron/[schedule]/route.ts` | Indexed |
| `/api/cutover/load` | api POST | `app/api/cutover/load/route.ts` | Indexed |
| `/api/dealer-inventory/items` | api POST | `app/api/dealer-inventory/items/route.ts` | Indexed |
| `/api/dealer-orders/[id]/comments` | api POST | `app/api/dealer-orders/[id]/comments/route.ts` | Indexed |
| `/api/dealer-orders/[id]/workflow` | api PATCH | `app/api/dealer-orders/[id]/workflow/route.ts` | Indexed |
| `/api/dealer-orders/from-quote-order` | api POST | `app/api/dealer-orders/from-quote-order/route.ts` | Indexed |
| `/api/dealer-orders` | api POST | `app/api/dealer-orders/route.ts` | Indexed |
| `/api/discrepancies/recount` | api POST | `app/api/discrepancies/recount/route.ts` | Indexed |
| `/api/email/send` | api POST | `app/api/email/send/route.ts` | Indexed |
| `/api/enterprise/data-exchange` | api POST | `app/api/enterprise/data-exchange/route.ts` | Indexed |
| `/api/master-import/[id]/rejected` | api GET | `app/api/master-import/[id]/rejected/route.ts` | Indexed |
| `/api/master-import/preview` | api POST | `app/api/master-import/preview/route.ts` | Indexed |
| `/api/master-import/template/[kind]` | api GET | `app/api/master-import/template/[kind]/route.ts` | Indexed |
| `/api/operator-workflows` | api POST | `app/api/operator-workflows/route.ts` | Indexed |
| `/api/payments` | api POST | `app/api/payments/route.ts` | Indexed |
| `/api/pdf/credit-note/[id]` | api GET | `app/api/pdf/credit-note/[id]/route.ts` | Indexed |
| `/api/pdf/expense-payment/[id]` | api GET | `app/api/pdf/expense-payment/[id]/route.ts` | Indexed |
| `/api/pdf/expense/[id]` | api GET | `app/api/pdf/expense/[id]/route.ts` | Indexed |
| `/api/pdf/invoice/[id]` | api GET | `app/api/pdf/invoice/[id]/route.ts` | Indexed |
| `/api/pdf/quote/[id]` | api GET | `app/api/pdf/quote/[id]/route.ts` | Indexed |
| `/api/pdf/systems-configurator/[id]/[type]` | api GET | `app/api/pdf/systems-configurator/[id]/[type]/route.ts` | Indexed |
| `/api/portal/orders/[id]/summary` | api GET | `app/api/portal/orders/[id]/summary/route.ts` | Indexed |
| `/api/qr-codes` | api POST | `app/api/qr-codes/route.ts` | Indexed |
| `/api/reports/audit-logs/export` | api GET | `app/api/reports/audit-logs/export/route.ts` | Indexed |
| `/api/shipments/receipt` | api POST | `app/api/shipments/receipt/route.ts` | Indexed |
| `/api/tasks` | api PATCH/POST | `app/api/tasks/route.ts` | Indexed |
| `/` | app | `app/page.tsx` | Indexed |
| `/portal/dashboard` | portal | `app/portal/dashboard/page.tsx` | Indexed |
| `/portal/orders` | portal | `app/portal/orders/page.tsx` | Indexed |
| `/portal/quotes` | portal | `app/portal/quotes/page.tsx` | Indexed |
| `/portal/self-service` | portal | `app/portal/self-service/page.tsx` | Indexed |
| `/portal/support` | portal | `app/portal/support/page.tsx` | Indexed |
