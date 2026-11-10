// AP-097: warn before saving a record that looks like one entered shortly before (same customer and amount or quantity,
// or the same reference). Used by the create actions on the server: a match stops the save until the person either
// opens the existing record or confirms "save anyway", which is logged. The rule lives in private.ap3_duplicates.
import { z } from "zod";
import type { DuplicateKind } from "./commands.ts";

export const duplicateMatchSchema = z.object({
  id: z.string().uuid(), kind: z.enum(["quote", "order", "receipt", "dispatch"]), label: z.string(), href: z.string(), created_at: z.string(), why: z.string()
});
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;
export type DuplicateConfirmation = { confirmed?: boolean; note?: string | null } | null | undefined;
export type DuplicateGate = { blocked: true; matches: DuplicateMatch[] } | { blocked: false; matches: DuplicateMatch[] };

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

/** Checks for possible duplicates. The check never blocks the business flow when it cannot run (for example before the
 * database upgrade): only a confirmed match list stops the save. */
export async function duplicateGate(client: RpcClient, kind: DuplicateKind, payload: Record<string, unknown>, confirmation: DuplicateConfirmation): Promise<DuplicateGate> {
  const clean = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== undefined && value !== ""));
  let result: { data: unknown; error: { code?: string } | null };
  try { result = await client.rpc("ap_dupes", { p_command: "check", p_payload: { kind, ...clean } }); }
  catch { return { blocked: false, matches: [] }; }
  if (result.error) return { blocked: false, matches: [] };
  const parsed = z.object({ matches: z.array(duplicateMatchSchema) }).safeParse(result.data);
  const matches = parsed.success ? parsed.data.matches : [];
  if (!matches.length) return { blocked: false, matches };
  if (!confirmation?.confirmed) return { blocked: true, matches };
  try {
    await client.rpc("ap_dupes", { p_command: "acknowledge", p_payload: { kind, matches: matches.map(m => m.id).slice(0, 10), decision: "saved_anyway",
      ...(confirmation.note && confirmation.note.trim().length >= 3 ? { note: confirmation.note.trim().slice(0, 300) } : {}) } });
  } catch { /* the warning was shown; the save proceeds */ }
  return { blocked: false, matches };
}

export const duplicateMessage = (matches: DuplicateMatch[]) =>
  `Possible duplicate: ${matches.map(m => `${m.label} (${m.why})`).join("; ")}. Open it, or confirm to save anyway.`;
