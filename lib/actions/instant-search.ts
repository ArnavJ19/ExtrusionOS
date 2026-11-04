"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { getSearchResourceKeys } from "@/lib/auth/role-experience";
import { createClient } from "@/lib/supabase/server";
import { cleanFindQuery, findDefinitions, findFilter, findResult, rankFindResults, type FindResource, type FindResponse } from "@/lib/workflow/instant-search";

export async function instantFindAction(input: string): Promise<FindResponse> {
  try {
    const context = await getSessionContext();
    const raw = z.string().max(80).parse(input);
    const query = cleanFindQuery(raw);
    if (query.length < 2) return { query, items: [], unavailable: [] };
    const supabase = await createClient();
    // Resources are recomputed from the current session role on every call, so revoked access applies at once.
    const resources = getSearchResourceKeys(context.role) as FindResource[];
    const results = await Promise.all(resources.map(async (resource) => {
      const definition = findDefinitions[resource];
      let request = supabase.from(definition.table).select(definition.columns).eq("company_id", context.companyId);
      if (resource === "customers") request = request.is("deleted_at", null);
      const result = await request.or(findFilter(definition, raw)).order("id").limit(6);
      if (result.error || !Array.isArray(result.data)) return { resource, items: [], unavailable: true };
      const rows = z.array(z.object({ id: z.string().uuid() }).passthrough()).max(6).parse(result.data);
      return { resource, items: rows.map((row) => findResult(resource, row, context.role)), unavailable: false };
    }));
    return { query, items: rankFindResults(results.flatMap((result) => result.items), query), unavailable: results.filter((result) => result.unavailable).map((result) => result.resource) };
  } catch { return { query: "", items: [], unavailable: [], error: "Search is unavailable. Check your connection and account access, then retry." }; }
}
