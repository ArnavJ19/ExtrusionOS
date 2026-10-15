-- Metadata only. Run with database catalog access on the intended staging database.
-- A missing ledger produces an error, not evidence of an empty migration history.
begin transaction read only;

select jsonb_build_object(
  'migration_ledger_present', true,
  'migrations', coalesce(jsonb_agg(jsonb_build_object(
    'version', migration.version::text,
    'name', to_jsonb(migration)->>'name'
  ) order by migration.version::text), '[]'::jsonb)
) as migration_ledger
from supabase_migrations.schema_migrations migration;

rollback;
