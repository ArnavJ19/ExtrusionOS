# Database and Migration Audit

## Replay and Upgrade

| Check | Result | Boundary |
|---|---|---|
| Fresh PGlite replay | 296/296, zero migration failures | Two declared baseline files plus 294 active migrations, with Supabase platform stand-ins |
| Native PostgreSQL 18.3 replay and pre-November upgrade | 296/296, synthetic prior company preserved | Separate loopback cluster with platform stand-ins. One existing-company upgrade, without a copy of real historical data |
| Native catalog | 516 public tables, 824 public/Storage policies, 855 public/private security definers. All discovered public company-column tables had RLS enabled. All counted definers had explicit search paths | Presence checks. Predicate, grant, safe path order and role behavior require targeted review |
| Two independent native sessions | Distinct document numbers `A/26-27/0001` and `A/26-27/0002`. A rolled-back `0003` was issued on the next commit | Financial-year counter only. This is not a complete transactional concurrency run |
| Type coverage | `types/database.ts` is a subset. The newer stock RPC calls cast the name to `any` in `app/(dashboard)/dashboard/page.tsx:27–28` | Typecheck cannot demonstrate schema/API agreement. Regenerate or validate the selected contract against the release catalog |

[PGlite log](evidence/migration-replay.log) · [Native log](evidence/postgres-native-final.log) · [SQL declaration index](evidence/sql-object-index.json)

The active chain is the sorted files under `supabase/migrations/` plus `schema.sql` and `rls.sql`. The archive and the generated full schema dump serve other purposes. A fresh replay against the same directory is useful evidence of creation ordering and replayability. It cannot detect historical production data that would fail a new constraint or certify actual hosted definitions. The repository's PGlite test helper suspends the single-company insert trigger by default for two-company fixtures. The native replay kept that trigger enabled.

## Hosted Comparison

The local configuration identifies the linked AlExMS Supabase project. Its catalog is PostgreSQL 17.6, distinct from the audit's PostgreSQL 18.3. The Vercel project matched the repository. Its latest READY production record was created on 9 November 2026 at 16:28 IST from `0a5cc3d62d8fd679dc3a3fdce06d9bbc158db627`. The exact runtime environment binding and separately configured staging database remain unverified.

| Local group or object | Linked hosted evidence | Interpretation |
|---|---|---|
| November coordination and operations control | Three named chunks each | Group presence by ledger name |
| November assurance | Five named chunks with suffixes such as `part1_tables` | Group presence. Generic exact-name matching needs the suffix mapping |
| November lifecycle and improvement | Six and five named chunks respectively | Group presence by ledger name |
| November execution, commercial and specialist | Nine, nine and fourteen named chunks respectively | Group presence by ledger name |
| Stock snapshot | Named ledger entry and `get_stock_snapshot()` present | Read metadata confirms the RPC exists |
| Single-company Omalco guard | Catalog confirms enabled insert trigger. No identical local version entry was found | Catalog evidence supersedes an inference from the ledger filename |
| Autopilot 1 and 2 | Eight Batch 1 chunks and seven Batch 2 chunks by name; `ap_press` present | Presence without definition parity. Chunk labels skip Batch 2 part03 and require mapping |
| Autopilot 3 cash | No matching group name. `ap_cash(text,jsonb)` absent | Verified absence of the selected entry point on the linked database |
| Foundry cast and ordinary production completion | Hosted function-body MD5s match the captured local declarations | Strong evidence the reproduced cast and completion logic is installed there. Execution evidence remains local |
| Customer history retention | Zero cascading customer FKs on the four historical relations | Hosted catalog confirms the relevant cascade condition was removed |

The hosted ledger returned 259 rows. None of the 294 local filename versions matched a hosted version exactly. Supabase's applied IDs and split names often differ from the repository's filenames. The comparison file preserves the raw name/version metadata and a name heuristic. A zero exact match does not mean that zero migrations are installed. Individual definitions, grants, policies, triggers and data still need a release-specific reconciliation. [Hosted metadata](evidence/hosted-release-metadata.json)

## Release Compatibility Gates

- Record the reviewed source commit, production artifact, deployment alias, bound database and mapped migration chunks together.
- Verify actual definition and grant changes for each required command and role, including Storage and Auth configuration. Rehearse an upgrade against a representative approved historical schema and dataset.
- Validate generated or maintained DB types and per-command data contracts. Exercise duplicates, interrupted transactions, stale approvals and concurrent sessions on PostgreSQL compatible with the intended hosted version.
- Publish approved migration ordering, rollback or forward recovery, and reconciliation evidence before a production decision.
