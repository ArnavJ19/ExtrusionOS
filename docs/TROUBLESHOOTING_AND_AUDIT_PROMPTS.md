# Troubleshooting and Audit Prompts — ExtrusionOS

This document contains reusable prompts and procedures for auditing the project.

## 1. Repeatable Bug / SQL / Security Audit Prompt

Use this with Cursor, Claude Code, Codex, or another coding agent:

```text
You are a senior full-stack engineer, database architect, Supabase security expert, QA engineer, and SaaS production-readiness auditor.

Audit the current ExtrusionOS codebase from scratch.

Scan:
- Next.js routes
- Components
- Supabase queries
- Server actions
- API routes
- Database migrations
- RLS policies
- Storage policies
- Zod schemas
- TypeScript types
- Business calculations
- File uploads
- PDF generation
- Public/customer routes

Find:
- TypeScript errors
- Build errors
- Runtime errors
- Broken routes
- Broken imports
- Missing tables
- Missing columns
- Wrong enum values
- Broken Supabase queries
- RLS vulnerabilities
- Cross-company data leaks
- Auth bypasses
- Role permission bypasses
- Service role key exposure
- Unsafe file upload/storage logic
- Public route leaks
- Quote calculation bugs
- Inventory calculation bugs
- Payment bugs
- Missing validation
- Missing tests

Before fixing, produce a report with Critical, High, Medium, and Low issues.

Then fix Critical and High issues first using safe patches and safe migrations.

After fixing, run available checks:
- npm run lint
- npm run typecheck
- npm run build
- npm test

Report what changed, files modified, migrations added, tests updated, and remaining risks.
```

## 2. UI Cleanup Prompt

```text
Audit the ExtrusionOS UI and fix pages where large forms and full data tables are shown together.

Each major module should have:
- Overview page
- Database page with 10-row pagination
- Create/edit page or drawer
- Detail page

Use status cards/boards for modules with statuses.

Do not break business logic or RLS.

Improve loading, empty, and error states.
```

## 3. Database/RLS Audit Prompt

```text
Audit all Supabase tables, migrations, RLS policies, and storage policies.

Verify every company-specific table has company_id, RLS enabled, safe select/insert/update/delete policies, indexes, and proper constraints.

Find any policy that allows broad authenticated access.

Find any query that trusts company_id from frontend input.

Fix Critical and High RLS/tenant isolation issues first.
```

## 4. Calculation Audit Prompt

```text
Audit all business calculation logic in ExtrusionOS.

Focus on:
- Quote totals
- GST
- Margin
- Price per kg
- Price per meter
- Inventory movements
- Payment balance
- Overdue status
- Yield/recovery
- Configurator cutting list if enabled

Find duplicated logic, divide-by-zero risks, NaN risks, negative value bugs, rounding inconsistencies, and missing tests.

Centralize calculations in /lib and add tests.
```

## 5. Storage Audit Prompt

```text
Audit Supabase Storage usage.

Check buckets, upload logic, file paths, file type validation, file size validation, signed URLs, public/private bucket settings, and storage policies.

Verify all files are scoped by company_id and users cannot access another company’s files.

Fix unsafe storage policies and insecure upload paths.
```

## 6. Deployment Readiness Prompt

```text
Check if ExtrusionOS is ready to deploy.

Run lint, typecheck, build, and tests.

Verify env vars, Supabase migrations, RLS policies, storage buckets, storage policies, auth redirects, service role key safety, and public route safety.

Provide a deployment readiness score and list blockers.
```

## 7. How to Report Findings

Use this format:

```md
# Audit Report

## Executive Summary
- Demo readiness:
- Production readiness:
- Security score:
- Database readiness:
- Test readiness:

## Critical Issues
| Issue | Area | Risk | Fix |

## High Issues
| Issue | Area | Risk | Fix |

## Medium Issues
| Issue | Area | Risk | Fix |

## Low Issues
| Issue | Area | Risk | Fix |

## Fixes Implemented
| Fix | Files | Migration | Tests |

## Commands Run
| Command | Result | Notes |

## Remaining Risks

## Manual Test Checklist
```
