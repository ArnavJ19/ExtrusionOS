"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { inTaskVendorRequestSchema, normalizedVendorPhone, sameVendorRequest, vendorMatchOption, vendorNamePattern, vendorOption, vendorPhonePattern,
  type InTaskVendorData, type InTaskVendorMatch, type InTaskVendorRequest, type InTaskVendorResult } from "@/lib/forms/in-task-vendor";

const vendorColumns = "id, company_id, created_by, vendor_name, vendor_type, contact_person, phone, gst_number, city, is_active";
const matchColumns = "id, vendor_name, vendor_type, phone, gst_number, is_active";

// NOV-010: create a missing vendor without leaving the task. Mirrors the in-task customer action:
// advisory duplicate checks, an idempotent create keyed by the request identity, and selection of
// an existing active match instead of a second record.
export async function inTaskVendorAction(input: InTaskVendorRequest): Promise<InTaskVendorResult> {
  let writeAttempted = false;
  try {
    const context = await getSessionContext();
    if (context.dealerId || !can(context.role, "create", "vendors") || !can(context.role, "read", "vendors")) return { kind: "error", error: "Your role cannot create vendors." };
    const parsed = inTaskVendorRequestSchema.safeParse(input);
    if (!parsed.success) return { kind: "error", error: parsed.error.issues[0]?.message ?? "Check the vendor details." };
    const request = parsed.data;
    const supabase = await createClient();
    const readById = (id: string) => supabase.from("vendors").select(vendorColumns).eq("company_id", context.companyId).eq("id", id).maybeSingle();
    if (request.intent === "select") {
      const result = await readById(request.vendor_id);
      if (result.error || !result.data || result.data.is_active !== true) return { kind: "error", error: "That vendor is no longer available. Check the matches again." };
      return { kind: "selected", vendor: vendorOption(result.data) };
    }
    const vendor = { ...request.vendor, phone: request.vendor.phone ? normalizedVendorPhone(request.vendor.phone) : null };
    async function replay(id: string): Promise<InTaskVendorResult | null> {
      const result = await readById(id);
      if (result.error) throw result.error;
      if (!result.data) return null;
      if (!sameVendorRequest(result.data, vendor, context.userId) || result.data.is_active !== true) return { kind: "error", error: "This request already has a different or inactive vendor. Review it in Vendors before continuing." };
      return { kind: "created", vendor: vendorOption(result.data) };
    }
    if (request.intent === "create") {
      const prior = await replay(request.request_id);
      if (prior) return prior;
    }
    async function matchesFor(values: InTaskVendorData) {
      const base = () => supabase.from("vendors").select(matchColumns).eq("company_id", context.companyId);
      const checks: { label: string; query: PromiseLike<{ data: any; error: any }> }[] = [];
      if (values.gst_number) checks.push({ label: "GST", query: base().ilike("gst_number", values.gst_number).order("id").limit(11) });
      checks.push({ label: "vendor name", query: base().ilike("vendor_name", vendorNamePattern(values.vendor_name)).order("id").limit(11) });
      if (values.phone) checks.push({ label: "phone", query: base().ilike("phone", vendorPhonePattern(values.phone)).order("id").limit(11) });
      const results = await Promise.all(checks.map(({ query }) => query));
      const matches = new Map<string, InTaskVendorMatch>();
      let hasMore = false;
      for (const [index, result] of results.entries()) {
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error("Vendor match evidence is unavailable.");
        hasMore ||= result.data.length > 10;
        for (const row of result.data) {
          const prior = matches.get(row.id);
          if (prior) prior.matched_on.push(checks[index].label);
          else matches.set(row.id, { ...vendorMatchOption(row), matched_on: [checks[index].label] });
        }
      }
      return { matches: [...matches.values()].slice(0, 10), hasMore: hasMore || matches.size > 10 };
    }
    const matches = await matchesFor(vendor);
    if (request.intent === "check") return { kind: "checked", ...matches };
    if (matches.matches.length && !request.acknowledge_similar) return { kind: "similar", ...matches };
    writeAttempted = true;
    const inserted = await supabase.from("vendors").insert({ ...vendor, id: request.request_id, company_id: context.companyId, created_by: context.userId, is_active: true }).select(vendorColumns).single();
    if (inserted.error) {
      const prior = await replay(request.request_id);
      if (prior) return prior;
      if (["42501", "23502", "23514", "22P02", "23505"].includes(inserted.error.code)) return { kind: "error", error: "The vendor was not saved. Check your account permissions and vendor details before retrying." };
      return { kind: "error", error: "The vendor could not be confirmed. Retry these same details to check the result.", uncertain: true };
    }
    if (!inserted.data || inserted.data.id !== request.request_id || inserted.data.company_id !== context.companyId) throw new Error("The vendor confirmation is unavailable.");
    revalidatePath("/vendors");
    revalidatePath("/vendors/database");
    return { kind: "created", vendor: vendorOption(inserted.data) };
  } catch {
    return { kind: "error", error: writeAttempted ? "The vendor could not be confirmed. Retry these same details to check the result." : "Vendor details could not be checked. Review your connection and account access, then retry.", uncertain: writeAttempted };
  }
}
