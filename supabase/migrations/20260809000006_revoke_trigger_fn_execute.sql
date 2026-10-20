-- Security hygiene: the trigger functions added in this batch are only ever invoked by
-- their table triggers, never as public RPCs. Revoke the default EXECUTE grant so they are
-- not callable via PostgREST (/rest/v1/rpc/...) by anon/authenticated, matching how the
-- other trigger/atomic helpers in this project are locked down.
revoke all on function public.enforce_expense_payment_guards() from public, anon, authenticated;
revoke all on function public.reconcile_foundry_billet_count() from public, anon, authenticated;
