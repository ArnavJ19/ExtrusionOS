"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { customerMatchOption, customerNamePattern, customerOption, customerPhonePattern, inTaskCustomerRequestSchema, normalizedCustomerPhone, sameCustomerRequest, type InTaskCustomerData, type InTaskCustomerMatch, type InTaskCustomerRequest, type InTaskCustomerResult } from "@/lib/forms/in-task-customer";

const customerColumns = "id, company_id, created_by, customer_name, company_name, customer_type, phone, email, gst_number, billing_address, shipping_address, city, state, pincode, is_active, deleted_at";
const matchColumns = "id, customer_name, company_name, phone, gst_number, is_active";

export async function inTaskCustomerAction(input: InTaskCustomerRequest): Promise<InTaskCustomerResult> {
  let writeAttempted = false;
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "customers") || !can(context.role, "read", "customers")) return { kind: "error", error: "Your role cannot create customers." };
    const parsed = inTaskCustomerRequestSchema.safeParse(input);
    if (!parsed.success) return { kind: "error", error: parsed.error.issues[0]?.message ?? "Check the customer details." };
    const request = parsed.data;
    const supabase = await createClient();
    const readById = (id: string) => supabase.from("customers").select(customerColumns).eq("company_id", context.companyId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (request.intent === "select") {
      const result = await readById(request.customer_id);
      if (result.error || !result.data || result.data.is_active !== true) return { kind: "error", error: "That customer is no longer available. Check the matches again." };
      return { kind: "selected", customer: customerOption(result.data) };
    }
    const customer = { ...request.customer, phone: request.customer.phone ? normalizedCustomerPhone(request.customer.phone) : null };
    async function replay(id: string): Promise<InTaskCustomerResult | null> {
      const result = await readById(id);
      if (result.error) throw result.error;
      if (!result.data) return null;
      if (!sameCustomerRequest(result.data, customer, context.userId) || result.data.is_active !== true) return { kind: "error", error: "This request already has a different or inactive customer. Review it in Customers before continuing." };
      return { kind: "created", customer: customerOption(result.data) };
    }
    if (request.intent === "create") {
      // A retry reuses its primary key and must match both the author and original details.
      const prior = await replay(request.request_id);
      if (prior) return prior;
    }
    async function matchesFor(values: InTaskCustomerData) {
      const base = () => supabase.from("customers").select(matchColumns).eq("company_id", context.companyId).is("deleted_at", null);
      const checks: { label: string; query: PromiseLike<{ data: any; error: any }> }[] = [];
      if (values.gst_number) checks.push({ label: "GST", query: base().ilike("gst_number", values.gst_number).order("id").limit(11) });
      checks.push({ label: "customer name", query: base().ilike("customer_name", customerNamePattern(values.customer_name)).order("id").limit(11) });
      if (values.company_name) checks.push({ label: "company name", query: base().ilike("company_name", customerNamePattern(values.company_name)).order("id").limit(11) });
      if (values.phone) checks.push({ label: "phone", query: base().ilike("phone", customerPhonePattern(values.phone)).order("id").limit(11) });
      const results = await Promise.all(checks.map(({ query }) => query));
      const matches = new Map<string, InTaskCustomerMatch>();
      let hasMore = false;
      for (const [index, result] of results.entries()) {
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error("Customer match evidence is unavailable.");
        hasMore ||= result.data.length > 10;
        for (const row of result.data) {
          const prior = matches.get(row.id);
          if (prior) prior.matched_on.push(checks[index].label);
          else matches.set(row.id, { ...customerMatchOption(row), matched_on: [checks[index].label] });
        }
      }
      return { matches: [...matches.values()].slice(0, 10), hasMore: hasMore || matches.size > 10 };
    }
    const matches = await matchesFor(customer);
    if (request.intent === "check") return { kind: "checked", ...matches };
    if (matches.matches.length && !request.acknowledge_similar) return { kind: "similar", ...matches };
    writeAttempted = true;
    const inserted = await supabase.from("customers").insert({ ...customer, id: request.request_id, company_id: context.companyId, created_by: context.userId, is_active: true }).select(customerColumns).single();
    if (inserted.error) {
      const prior = await replay(request.request_id);
      if (prior) return prior;
      if (["42501", "23502", "23514", "22P02"].includes(inserted.error.code)) return { kind: "error", error: "The customer was not saved. Check your account permissions and customer details before retrying." };
      return { kind: "error", error: "The customer could not be confirmed. Retry these same details to check the result.", uncertain: true };
    }
    if (!inserted.data || inserted.data.id !== request.request_id || inserted.data.company_id !== context.companyId) throw new Error("The customer confirmation is unavailable.");
    revalidatePath("/customers");
    revalidatePath("/customers/database");
    return { kind: "created", customer: customerOption(inserted.data) };
  } catch {
    return { kind: "error", error: writeAttempted ? "The customer could not be confirmed. Retry these same details to check the result." : "Customer details could not be checked. Review your connection and account access, then retry.", uncertain: writeAttempted };
  }
}
