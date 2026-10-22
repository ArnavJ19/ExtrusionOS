# Archived migrations

These files are kept for history only. They are outside `supabase/migrations/`, so neither the Supabase CLI nor `scripts/replay-migration-chain.mjs` runs them.

They never ran (or ran only partly) on the live database, AlExMS. A catalog comparison on 22 October 2026 found:

| File (original name) | Evidence |
|---|---|
| `20260515000600_enterprise_phase_1.sql` (`0006_enterprise_phase_1.sql`) | Its seed insert violates `subscription_plans_type_check` from `20260513_enterprise_phase1_foundation`. Live has only `idx_feature_flags_company` from it; its policies and other indexes are absent. |
| `20260515000700_enterprise_phase_2.sql` (`0007_enterprise_phase_2.sql`) | None of its indexes exist live. Its tables and policies are identical to those created by `20260513_enterprise_phase2_ai_quotation_assistant`. |
| `20260516000000_core_dealer_improvements.sql` (`20260514_core_dealer_improvements.sql`) | Invalid dollar quoting made it unrunnable as written. None of its objects exist live (`orders.order_source_label`, `orders_order_origin_check`, `payments` type/status checks, the `idx_tasks_*` / `idx_orders_*` / `idx_payments_*` indexes, the `tasks` policies). |

See `docs/MIGRATION_CHAIN_REPLAY_2026-10-22.md`.
