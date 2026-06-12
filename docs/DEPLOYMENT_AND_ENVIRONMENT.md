# Deployment and Environment — ExtrusionOS

## 1. Deployment Targets

Frontend:

- Vercel

Backend/database/storage:

- Supabase

## 2. Environment Variables

Common variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Rules:

- `NEXT_PUBLIC_*` variables may be used in browser code.
- `SUPABASE_SERVICE_ROLE_KEY` must be server-only.
- Do not import service role logic into client components.
- Do not commit real `.env` values.
- `.env.example` should contain placeholders only.

## 3. Supabase Setup

Required setup may include:

- Auth enabled
- Database migrations applied
- RLS policies applied
- Storage buckets created
- Storage policies applied
- Seed data optionally applied
- Edge functions/RPC if used

## 4. Migration Process

Before deployment:

1. Review migrations.
2. Confirm migrations are safe.
3. Confirm no destructive operations.
4. Confirm RLS policies are included.
5. Confirm indexes are included for high-volume tables.
6. Confirm generated TypeScript types are updated if workflow supports it.

## 5. Build Checks

Before deployment, run:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

If commands are missing, document it.

## 6. Production Readiness Checklist

- [ ] Auth works
- [ ] Company onboarding works
- [ ] RLS enabled
- [ ] Storage policies enabled
- [ ] Environment variables configured
- [ ] Service role key server-only
- [ ] Build passes
- [ ] Core flows tested
- [ ] Customer PDFs sanitized
- [ ] Public share links safe
- [ ] Error pages friendly
- [ ] Logs do not expose secrets

## 7. Vercel Checklist

- [ ] Project builds on Vercel
- [ ] Environment variables set
- [ ] Node version compatible
- [ ] Build command correct
- [ ] Output settings correct
- [ ] API routes/server actions work
- [ ] No service key in client bundle

## 8. Supabase Checklist

- [ ] Migrations applied
- [ ] RLS policies active
- [ ] Storage buckets created
- [ ] Storage policies active
- [ ] Auth redirect URLs configured
- [ ] Email settings configured if needed
- [ ] Database indexes created
- [ ] Required RPC/functions created

## 9. Rollback Guidance

If deployment fails:

1. Identify whether failure is frontend, database, RLS, or env-related.
2. Do not drop data to fix quickly.
3. Roll back code deployment if needed.
4. Add corrective migration if schema issue exists.
5. Document issue and fix.

## 10. Demo Readiness

A demo build should support:

- Login
- Dashboard
- Customers
- Profiles
- Dies
- Quotes
- Orders
- Dispatches
- Inventory
- Payments if enabled
- Reports if enabled
- System configurator if enabled

Use realistic seed/demo data only if clearly separated from production.
