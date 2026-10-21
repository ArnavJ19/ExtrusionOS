"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { getSearchResourceKeys } from "@/lib/auth/role-experience";
import { createClient } from "@/lib/supabase/server";
import { cleanFindQuery, findDefinitions, findResult, type FindResource, type FindResponse } from "@/lib/workflow/instant-search";

export async function instantFindAction(input: string): Promise<FindResponse> {
  try {
    const context = await getSessionContext();
    const query = cleanFindQuery(z.string().max(80).parse(input));
    if (query.length < 2) return { query, items: [], unavailable: [] };
    const supabase = await createClient();
    const resources = getSearchResourceKeys(context.role) as FindResource[];
    const results = await Promise.all(resources.map(async (resource) => {
      const definition = findDefinitions[resource];
      let request = supabase.from(definition.table).select(definition.columns).eq("company_id", context.companyId);
      if (resource === "customers") request = request.is("deleted_at", null);
      const result = await request.or(definition.search.map((field) => `${field}.ilike.*${query}*`).join(",")).order("id").limit(6);
      if (result.error || !Array.isArray(result.data)) return { resource, items: [], unavailable: true };
      const rows = z.array(z.object({ id: z.string().uuid() }).passthrough()).max(6).parse(result.data);
      return { resource, items: rows.map((row) => findResult(resource, row, context.role)), unavailable: false };
    }));
    return { query, items: results.flatMap((result) => result.items), unavailable: results.filter((result) => result.unavailable).map((result) => result.resource) };
  } catch { return { query: "", items: [], unavailable: [], error: "Search is unavailable. Check your connection and account access, then retry." }; }
}
