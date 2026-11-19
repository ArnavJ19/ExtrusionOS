# 0002 — Business writes go through validated database command functions

**Status:** accepted (Autopilot batches, FS-89 in progress) · **Recorded:** 18 November 2026 (FS-107)

**Decision.** A change to business records is a call to a `security definer` gateway (`public.ap_*`, `public.fs_*`) that takes the company, the person and the role from the session (`private.ap_ctx`), validates every field, applies the change in one transaction and writes its own audit. Server actions allow-list each command and validate it with Zod first; only messages the database marks `AP: ` are shown to people.

**Why.** Browser-side writes were the largest gap between the project rules and the code (FABLE FS-89, FS-90). A gateway is the one place to enforce permission, quantity and state rules, and it is testable as a real role in PGlite and PostgreSQL.

**Consequences.** New tables have row-level security on and no direct grants. Remaining grandfathered browser writes are listed in the FS-89 baseline (Codex workstream) and are being retired one module at a time.
