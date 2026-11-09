import { getSessionContext } from "@/lib/auth";
import { CUTOVER_DEFINITIONS, MASTER_DEFINITIONS } from "@/lib/master-data/import/definitions";
import { templateCsv } from "@/lib/master-data/import/engine";

// AP-006 / AP-007: blank sheet templates (column headings only) for each master and opening section.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const context = await getSessionContext();
  const kind = (await params).kind;
  const definition = Object.hasOwn(MASTER_DEFINITIONS, kind) ? MASTER_DEFINITIONS[kind] : Object.hasOwn(CUTOVER_DEFINITIONS, kind) ? CUTOVER_DEFINITIONS[kind] : null;
  if (!definition || context.dealerId) return new Response("Not found", { status: 404 });
  return new Response(`﻿${templateCsv(definition)}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="omalco-${kind}-template.csv"`, "cache-control": "no-store" } });
}
