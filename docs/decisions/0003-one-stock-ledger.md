# 0003 — One stock ledger for every material

**Status:** in progress (FS-08 and FS-109, Codex workstream `codex/v1`) · **Recorded:** 18 November 2026 (FS-107)

**Decision.** Every physical movement of metal and consumables is one append-only ledger row with weighed quantity, unit and source document; balances are derived from the ledger, never kept in competing columns. Billets have one model (FS-109 reconciles the purchased/opening lot model with the foundry billet model).

**Why.** The audit reproduced a cast that creates metal and packaging stock held in two places. Mass balance (FS-09), genealogy (FS-10) and costing (FS-12) all need one source of truth.

**Consequences.** Until FS-08/FS-109 land, KPI recovery and die health read `foundry_billets` (the model production uses), and the root workstream does not add new stock-movement writers.
