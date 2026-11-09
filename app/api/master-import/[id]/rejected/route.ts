import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { rejectedRowsCsv } from "@/lib/master-data/import/engine";
import { createClient } from "@/lib/supabase/server";

// AP-006: the exact rows a batch rejected, with the original cells and the reasons, to fix and upload again.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success || context.dealerId || !["owner", "admin"].includes(context.role)) return new Response("Not found", { status: 404 });
  const result = await (await createClient()).rpc("ap_import", { p_command: "get", p_payload: { batch_id: id.data } });
  if (result.error || !result.data) return new Response("Not found", { status: 404 });
  const batch = result.data as { master: string; mapping: Record<string, string | null>; rejected: Array<{ row: number; errors: string[]; values: Record<string, string> }> };
  const headers = [...new Set([...Object.keys(batch.mapping ?? {}), ...batch.rejected.flatMap(row => Object.keys(row.values ?? {}))])];
  return new Response(`﻿${rejectedRowsCsv(headers, batch.rejected)}\n`, { headers: { "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="omalco-${batch.master}-rejected-rows.csv"`, "cache-control": "no-store" } });
}
