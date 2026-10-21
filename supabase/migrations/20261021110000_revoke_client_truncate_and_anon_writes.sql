-- EXOS-AUD-030: anon and authenticated held TRUNCATE on almost every public table
-- (including audit_logs_enterprise, invoices and foundry_billets), and anon held
-- INSERT/UPDATE/DELETE on every business table. TRUNCATE bypasses RLS and row
-- triggers, so the grant is unsafe even though PostgREST does not expose it today.
--
-- Before this migration (hosted check, 21 Oct 2026): every public table has RLS
-- enabled, and no INSERT/UPDATE/DELETE policy is satisfiable without an
-- authenticated company session, so anon writes were already rejected by RLS.
-- Revoking them changes no working flow. anon SELECT is kept (RLS still applies;
-- subscription_plans is intentionally readable).
--
-- Default privileges are tightened as well so tables created later by the
-- migration role do not regain these grants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

revoke truncate on all tables in schema public from anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon;

alter default privileges in schema public revoke truncate on tables from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;

commit;
