import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CostingRateForm, type DraftInitial } from "@/components/modules/quotes/costing-rates";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { canWriteRates } from "@/lib/workflow/costing-rates";

// UPGRADE_EOS feature 85: enter a new draft rate, or edit an existing draft (?edit=<id>).
export default async function NewCostingRatePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canWriteRates(context.role)) redirect("/quotes/rates");
  const { edit } = await searchParams;
  const editId = edit && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(edit) ? edit : null;
  const supabase = await createClient();
  const [customersResult, draftResult] = await Promise.all([
    supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).order("customer_name").limit(500),
    editId
      ? supabase.from("costing_rates").select("id, rate_type, basis, customer_id, alloy, finishing_type, rate, effective_from, effective_to, note, status").eq("company_id", context.companyId).eq("id", editId).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  const row = draftResult.data as (Omit<DraftInitial, "rate"> & { rate: number | string; status: string }) | null;
  const draft: DraftInitial | undefined = row && row.status === "draft" ? { ...row, rate: Number(row.rate) } : undefined;
  if (editId && !draft) redirect("/quotes/rates?status=draft");
  const customers = (customersResult.data ?? []).map((customer: { id: string; customer_name: string | null; company_name: string | null }) => ({ value: customer.id, label: customer.company_name || customer.customer_name || "Customer" }));

  return (
    <div className="space-y-5">
      <PageHeader title={draft ? "Edit draft rate" : "New costing rate"} description="A rate applies to quotations dated within its period. A customer agreement takes precedence over the general rate; an alloy-specific billet rate takes precedence over the all-alloy rate." />
      {customersResult.error ? <p role="alert" className="text-sm font-semibold text-amber-900">Customers could not be loaded, so only a general rate can be entered. Refresh to retry.</p> : null}
      <CostingRateForm rateId={draft?.id ?? randomUUID()} customers={customers} initial={draft} today={getBusinessDateBoundaries().today} />
    </div>
  );
}
