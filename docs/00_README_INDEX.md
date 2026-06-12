# ExtrusionOS Documentation Index

This folder contains project-level instructions and operating rules for ExtrusionOS.

Use these documents to keep development consistent across AI coding agents and human contributors.

## Recommended Reading Order

1. `AGENTS.md` in the repository root  
   Primary instruction file for AI coding agents.

2. `PROJECT_CONTEXT.md`  
   Product vision, users, business context, and scope.

3. `ARCHITECTURE.md`  
   Technical architecture, folder structure, data flow, and engineering patterns.

4. `DATABASE_AND_RLS.md`  
   Database design, Supabase RLS, migrations, indexes, and tenant isolation.

5. `UI_UX_GUIDELINES.md`  
   Product UI rules, page patterns, status boards, database pages, and design principles.

6. `MODULES.md`  
   Detailed description of each product module and its expected responsibilities.

7. `BUSINESS_LOGIC_AND_CALCULATIONS.md`  
   Rules for quote, order, inventory, production, payment, yield, and configurator calculations.

8. `SECURITY_CHECKLIST.md`  
   Security checklist for auth, RLS, storage, public views, and secrets.

9. `QA_AUDIT_CHECKLIST.md`  
   Manual QA checklist for all major modules.

10. `IMPLEMENTATION_RULES.md`  
   Rules for safe development, migrations, testing, and completion reports.

11. `CODING_STANDARDS.md`  
   TypeScript, component, form, query, and error-handling standards.

12. `SUPABASE_STORAGE_AND_FILES.md`  
   Supabase Storage bucket, file path, privacy, signed URL, and PDF file rules.

13. `REPORTS_AND_PDFS.md`  
   Report/PDF generation standards and customer/internal separation rules.

14. `DEPLOYMENT_AND_ENVIRONMENT.md`  
   Environment variables, deployment, migrations, and production readiness.

15. `TROUBLESHOOTING_AND_AUDIT_PROMPTS.md`  
   Reusable prompts and procedures for bug, SQL, RLS, and security audits.

16. `ROADMAP_AND_SCOPE_CONTROL.md`  
   Scope boundaries, feature prioritization, and anti-bloat rules.

## How to Use These Files With Coding Agents

When starting a coding session, tell the agent:

```text
Read AGENTS.md and the relevant docs in /docs before making changes. Follow the project rules, preserve RLS, keep the UI simple, and do not create mock-only features.
```

For security or database work, also say:

```text
Read DATABASE_AND_RLS.md and SECURITY_CHECKLIST.md before changing any schema, migration, policy, server action, API route, or storage logic.
```

For UI work, also say:

```text
Read UI_UX_GUIDELINES.md before changing layouts. Do not mix large forms and large tables on the same page.
```

For QA work, also say:

```text
Use QA_AUDIT_CHECKLIST.md and run available checks before completing work.
```
