# 0005 — One KPI definition and one computation path

**Status:** accepted (FS-77, FS-132) · **Recorded:** 18 November 2026

**Decision.** Each management KPI is defined once in `lib/insights/metrics.ts` and `docs/KPI_DICTIONARY.md` (kept equal by a test) and computed for a period by `private.kpi_values`, read through `public.fs_kpi`. Command Center reads only that path; the analytics and dashboard snapshots compute overlapping figures by the same rules and a fixture test requires equality. A value is measured, not captured, or not measurable — never a zero standing in for missing data — and no target is stored with a KPI.

**Consequences.** Adding a KPI means a registry entry, a dictionary row and a key in `private.kpi_values` in the same change.
