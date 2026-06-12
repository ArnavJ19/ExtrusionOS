# ExtrusionOS Modules

This file lists the functional modules currently present in the system routes and what each module does.

## Core Workspace Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Dashboard | `/dashboard` | Role-aware daily workspace with module summaries and operational focus. |
| Command Center | `/command-center` | Owner/admin control tower for cross-module KPIs, alerts, and decision-making. |
| Search | `/search` | Global in-app search across operational entities. |
| Notifications | `/notifications` | Central feed for alerts and task-related signals. |
| Tasks | `/tasks`, `/tasks/database`, `/tasks/new`, `/tasks/[id]` | Action management and follow-up tracking for teams and dealers. |

## Commercial and CRM Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Customers | `/customers`, `/customers/database`, `/customers/new`, `/customers/[id]` | Customer master records, segmentation, and relationship context. |
| CRM | `/crm` | Opportunity and follow-up workflow support around sales execution. |
| Quotes | `/quotes`, `/quotes/database`, `/quotes/new`, `/quotes/[id]` | Quotation lifecycle from draft to conversion to order. |
| AI Quotation Assistant | `/ai/quotation-assistant` | Guided AI-assisted quote drafting with safety controls. |
| Orders | `/orders`, `/orders/database`, `/orders/new`, `/orders/[id]` | Commercial commitment and order-stage progression control. |
| Tenders | `/tenders` | Tender tracking and commercial response workflow. |
| Dealer Orders | `/dealer-orders`, `/dealer-orders/database`, `/dealer-orders/new`, `/dealer-orders/[id]`, `/dealer-orders/quote-orders/[id]` | Dealer-specific order capture, execution, and factory coordination. |

## Engineering, Production, and Dispatch Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Profiles | `/profiles`, `/profiles/database`, `/profiles/new`, `/profiles/[id]` | Aluminium profile master data: section specs, alloy, temper, and process constraints. |
| Dies | `/dies`, `/dies/database`, `/dies/new`, `/dies/[id]` | Die lifecycle management, readiness, and maintenance status. |
| Die Intelligence | `/die-intelligence` | Advanced die-level performance and operational insights. |
| Production | `/production`, `/production/database`, `/production/new`, `/production/[id]`, `/production/finishing` | Job planning, execution, and output visibility for extrusion operations. |
| Machines | `/machines`, `/machines/database`, `/machines/new`, `/machines/[id]` | Machine master, state tracking, and maintenance linkage. |
| Maintenance | `/maintenance` | Preventive/breakdown maintenance execution and controls. |
| Energy | `/energy` | Utility and energy consumption tracking with cost linkage. |
| Dispatches | `/dispatches`, `/dispatches/database`, `/dispatches/new`, `/dispatches/[id]` | Shipment planning, transporter workflow, and delivery-state tracking. |
| Shipments Receipt | `/shipments/[id]/receipt` | Receipt confirmation workflow for dealer/factory shipment reconciliation. |
| Barcode / QR | `/barcode`, `/scan` | QR generation and scan-based traceability across operations. |
| Mobile Floor App | `/mobile`, `/mobile/jobs`, `/mobile/quality`, `/mobile/dispatch`, `/mobile/scan`, `/mobile/tasks` | Mobile-first production-floor workflows for fast execution updates. |

## Foundry and Material Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Foundry (Core) | `/foundry`, `/foundry/database`, `/foundry/new`, `/foundry/[id]` | Foundry batch planning, material conversion, and billet production control. |
| Foundry Billets | `/foundry/billets`, `/foundry/billets/database`, `/foundry/billets/[id]` | Billet inventory, traceability, and batch-linked control. |
| External Sources | `/foundry/external-sources`, `/foundry/external-sources/database`, `/foundry/external-sources/new`, `/foundry/external-sources/[id]` | External aluminium source intake and status management. |
| Outsourced Billets | `/foundry/outsourced-billets`, `/foundry/outsourced-billets/database`, `/foundry/outsourced-billets/[id]` | Third-party billet procurement and tracking. |
| Scrap | `/foundry/scrap`, `/foundry/scrap/database`, `/foundry/scrap/new`, `/foundry/scrap/[id]` | Scrap collection, quality classification, and recovery operations. |

## Inventory, Packaging, and Quality Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Inventory | `/inventory`, `/inventory/database`, `/inventory/new`, `/inventory/[id]`, `/inventory/reservations` | Stock control, availability, reorder risk, and reservation management. |
| Dealer Inventory | `/dealer-inventory` | Dealer-side stock visibility and ownership isolation flow. |
| Discrepancies | `/discrepancies` | Recount and mismatch resolution workflow between physical and recorded stock. |
| Packaging Jobs | `/packaging`, `/packaging/database`, `/packaging/new`, `/packaging/[id]` | Packaging execution and readiness flow before dispatch. |
| Packaging Materials | `/packaging/materials`, `/packaging/materials/database`, `/packaging/materials/new`, `/packaging/materials/[id]` | Packaging BOM material masters and stock control. |
| Packaging Purchases | `/packaging/purchases`, `/packaging/purchases/database`, `/packaging/purchases/new`, `/packaging/purchases/[id]` | Procurement and expense-linked purchase tracking for packaging inputs. |
| Quality | `/quality`, `/quality/database`, `/quality/new`, `/quality/[id]` | Inspection logging, pass/reject decisions, and quality compliance records. |

## Financial and Vendor Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Invoices | `/invoices`, `/invoices/database`, `/invoices/new`, `/invoices/[id]` | Billing and receivable tracking across customers and order fulfillment. |
| Payments | `/payments`, `/payments/database`, `/payments/new`, `/payments/[id]` | Payment records and settlement tracking for financial closure. |
| Expenses | `/expenses`, `/expenses/database`, `/expenses/new`, `/expenses/[id]`, `/expenses/pending-approvals` | Centralized expense ledger with approval workflow and source linkage. |
| Expense Payments | `/expenses/payments`, `/expenses/payments/database`, `/expenses/payments/new`, `/expenses/payments/[id]` | Outgoing payment logging against expense ledger entries. |
| Vendors | `/vendors`, `/vendors/database`, `/vendors/new`, `/vendors/[id]` | Supplier master data and procurement counterpart management. |

## Intelligence, Reporting, and Advanced Tooling

| Module | Primary Routes | What It Does |
|---|---|---|
| Reports | `/reports` (redirects to `/report-builder`) | Reporting entry point for analysis and exports. |
| Report Builder | `/report-builder` | Advanced custom report design with governed data access. |
| Profitability Intelligence | `/profitability` | Margin and cost analytics across commercial and operational dimensions. |
| Advanced Analytics | `/analytics` | Deep KPI dashboard across revenue, production, dispatch, receivables, expenses, quality, and inventory risk. |
| Documents Intelligence | `/documents`, `/documents/intelligence` | Technical document control, revisions, approvals, and query context. |
| Automation | `/automation`, `/automation/first-automation` | Rule and workflow automation setup with enterprise controls. |
| Communications (WhatsApp) | `/communications/whatsapp` | WhatsApp-oriented communication workflow support. |
| Exports | `/exports` | Export documentation and related process support. |
| Compliance | `/compliance` | Compliance tracking and readiness workflows. |

## Systems Configurator Suite

| Module | Primary Routes | What It Does |
|---|---|---|
| Systems Configurator Home | `/systems-configurator` | Entry to aluminium door/window system engineering workflows. |
| Configurator Setup | `/systems-configurator/setup` | Master setup and readiness controls for calculations and outputs. |
| Configurator Libraries | `/systems-configurator/libraries` | Profile/hardware/calculation library management. |
| Configurator Templates | `/systems-configurator/templates`, `/systems-configurator/templates/[id]`, `/systems-configurator/templates/[id]/formula` | Template and formula logic management for engineered systems. |
| Configurator Projects | `/systems-configurator/projects`, `/systems-configurator/projects/[id]`, `/systems-configurator/new` | Project-level sizing, design, and lifecycle progression. |
| Configurator Outputs | `/systems-configurator/projects/[id]/bom`, `/cutting-list`, `/glass-list`, `/optimization`, `/quote` | Detailed engineered outputs: BOM, cutting, glass, optimization, and quote views. |
| Configurator Reports | `/systems-configurator/reports` | Report center for customer and production-facing outputs. |

## Admin and Security Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Settings | `/settings` | Global administrative controls entry point. |
| Access Control | `/settings/access` | Users, invitations, and role access management. |
| Security | `/settings/security` | Security-related controls and visibility. |
| Enterprise Controls | `/settings/enterprise` | Feature-flag and enterprise capability governance. |
| Branding | `/settings/branding` | Company-level brand configuration. |
| Data Center | `/settings/data` | Data setup and operational configuration controls. |
| Integrations | `/settings/integrations` | External integration setup and status. |
| Audit Logs | `/audit-logs` | Immutable activity trail for governance and traceability. |

## Authentication and Portal Modules

| Module | Primary Routes | What It Does |
|---|---|---|
| Authentication | `/login`, `/signup`, `/accept-invite`, `/onboarding` | User access, onboarding, and invitation acceptance flows. |
| Customer/Dealer Portal | `/portal/dashboard`, `/portal/orders`, `/portal/quotes`, `/portal/support` | External-facing portal views for dealer/customer collaboration. |

