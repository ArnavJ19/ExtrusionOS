# ExtrusionOS Pro

Quotation, Die Management, and Order Tracking for Aluminium Extrusion MSMEs.

## Architecture Summary

ExtrusionOS Pro is a multi-tenant vertical SaaS product built with Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth, PostgreSQL, Storage, and Row Level Security. Each user belongs to one company through `app_users.company_id`; every operational table carries `company_id`, and RLS restricts data access to that tenant.

The app focuses on three business pains for Indian aluminium extrusion MSMEs: accurate quotation costing, practical die tracking, and visibility into order/dispatch status. The implementation avoids ERP sprawl and keeps V1 focused on customers, profile master data, dies, quotations with live costing, order stages, dispatch tracking, settings, and PDF quotation output.

## Project Structure

```txt
app/
  (auth)/login, signup, onboarding
  (dashboard)/dashboard, customers, profiles, dies, quotes, orders, dispatches, settings
  api/pdf/quote/[id]
components/
  layout, ui, modules
lib/
  calculations, supabase, validations, pdf, utils
supabase/
  schema.sql, rls.sql, seed.sql
types/
  app.ts, database.ts
```

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in SQL Editor.
3. Run `supabase/rls.sql` in SQL Editor.
4. Optionally run `supabase/seed.sql` after replacing the demo user UUID with an actual auth user id.
5. Copy `.env.example` to `.env.local` and set Supabase URL plus either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. Install dependencies with `npm install`.
7. Start locally with `npm run dev`.

## Supabase Storage

Create these private buckets:

```txt
company-assets
profile-drawings
die-drawings
quote-pdfs
dispatch-documents
```

All file paths should start with `company_id/`, for example `company_id/profiles/profile_id/file.pdf`.

## Deployment

1. Push the repo to GitHub.
2. Import into Vercel.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel environment variables.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only if you later add server-side admin jobs.
5. Deploy.

## Test Checklist

- Signup creates an auth user, company, owner profile, and company settings.
- User without profile is redirected to onboarding.
- Customer/profile/die rows are isolated by company.
- Profile duplicate code is rejected per company.
- Die duplicate number is rejected per company.
- Quote calculator updates total meters, weight, GST, grand total, price/kg, and price/m live.
- Draft quote saves quote and line items to Supabase.
- Quote PDF route downloads a professional PDF.
- Approved quote converts to an order once.
- Order stage update writes `order_stage_history`.
- Dispatch creation records bundles, transporter, vehicle, e-way bill, and LR number.
- Delivered dispatch can move the order to delivered.
- Settings updates company profile and quotation defaults.
