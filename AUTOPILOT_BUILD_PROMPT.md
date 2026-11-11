# Autopilot batch build prompt

Copy everything below the line. Change only the two values in the first block.

---

Build Autopilot batch **[N]**.
Features: **[NEXT]** ← write `NEXT` to take the next 10 undelivered entries from the Delivery plan in AUTOPILOT_UPGRADES.md (then by delivery rank), or list exact IDs, e.g. `AP-011, AP-012, ...`.

**Before coding**
1. Read CLAUDE.md, the full entries for the selected IDs in AUTOPILOT_UPGRADES.md (including "The autopilot principle" and "Shared implementation contract"), every existing AUTOPILOT_UPGRADE_BATCH_*.md, and your memory notes for this project.
2. Confirm which of the selected entries a previous batch already delivered. If one was, replace it with the next undelivered entry and say so.
3. For each feature, find the existing code it builds on (the "Builds on" line) and reuse it. Do not duplicate logic that already exists in `lib/`.
4. Check `git status`. Create a branch `feat/autopilot-batch-[N]` from the current branch. Do not modify, commit, or revert any unrelated uncommitted changes you find.

**How to build**
- Build each feature completely to its "System does", "Build", "Guardrails" and "Done when" lines. Do not build a thin placeholder. If part of an entry truly cannot be built now (missing device, provider, or business decision), build everything else and record the missing part honestly.
- Follow Detect → Propose → Confirm → Learn. The system prepares the work; the employee confirms. Nothing automatic may post stock, post money, approve quality, or send a customer message.
- Put features inside the module and record where the work actually happens (order, job, die, dispatch, invoice, workstation, My Work). Do not create new `/tasks/*` hubs.
- Business logic goes in `lib/`. Validate on the server with Zod. Take `company_id` and the actor from the session. Every new table gets RLS policies and indexes.
- Use one additive migration for the whole batch: `supabase/migrations/<timestamp>_autopilot_batch_[N].sql`. Replay it locally with the full migration chain using the project's existing harness. **Do not apply it to the hosted database.**
- List pages: 10 server-paginated rows, search, filters, sort, and loading/empty/error states. Customer-facing views must never show cost, margin, supplier rates, or internal notes.
- Do not ask me questions unless you are truly blocked. Make sensible assumptions and record them.

**Verify**
1. For each feature, write unit tests and SQL/RLS tests for its edge cases (duplicates, concurrency, stale proposals, wrong customer, unauthorised role, missing input that must stay blank rather than zero).
2. Run `npm run lint`, `npm run typecheck`, `npm run build` and `npm test`, and fix every failure your changes caused.
3. Start the app and check each feature in the in-app browser, at desktop width and at phone width.
4. Review your own diff for bugs and security problems, then fix what you find.
5. Re-read each entry's "Done when" line and confirm it is met. If it is not, say exactly what is missing.

**Record and finish**
1. Write `AUTOPILOT_UPGRADE_BATCH_[N].md` in the same structure as NOV_UPGRADE_BATCH_10.md: Selection table, per-feature recheck/tests/audit, scope boundaries, data and security audit, verification results, hosted migration state, remaining acceptance.
2. Add a one-line link to the batch record near the top of AUTOPILOT_UPGRADES.md.
3. Update your project memory with the batch status.
4. Commit on the batch branch. **Do not push, merge, or apply the hosted migration** unless I say so.
5. Report in the CLAUDE.md section 13 format, ending with what I need to do: migration to apply, employee checks, and decisions still open.
