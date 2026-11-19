# 0004 — One business date: India time, shift day from the shift start

**Status:** accepted (FS-82) · **Recorded:** 18 November 2026

**Decision.** "Today" is the India (Asia/Kolkata) date: `private.business_today()` in SQL, `businessToday()` in `lib/utils/business-date.ts`. A shift belongs to the date it started on (`private.business_shift`, `businessShift`), so the 22:00–06:00 shift is the start date's shift all night. The financial year runs 1 April to 31 March (`private.business_financial_year`, `financialYearOf`).

**Enforced by.** Migration `20261119100000` rewrote every function body that read `current_date` and every date default; `tests/fs-batch4-sql.test.mjs` and `tests/fs-batch4.test.mjs` fail if a raw `current_date` or `new Date().toISOString().slice(0, 10)` returns.
