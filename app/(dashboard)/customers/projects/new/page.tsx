import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectForm } from "@/components/modules/customers/customer-projects";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageProjects } from "@/lib/workflow/customer-projects";

const CUSTOMER_LIMIT = 1000;

export default async function NewCustomerProjectPage() {
  const context = await getSessionContext();
  if (context.dealerId || !canManageProjects(context.role)) redirect("/customers/projects");
  const supabase = await createClient();
  const result = await supabase.from("customers").select("id, customer_name, company_name, city")
    .eq("company_id", context.companyId).eq("is_active", true).is("deleted_at", null)
    .order("company_name", { ascending: true }).limit(CUSTOMER_LIMIT + 1);
  if (result.error) throw new Error("Customers could not be loaded. Refresh to retry.");
  const rows = result.data ?? [];
  const customers = rows.slice(0, CUSTOMER_LIMIT).map((row) => ({ value: row.id, label: [row.company_name || row.customer_name, row.city].filter(Boolean).join(" · ") }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="New Project"
        description="A project belongs to one customer. Its quotations, orders and dispatches are linked afterwards from the project page."
        actions={<Link href="/customers/projects" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All projects</Link>}
      />
      {rows.length > CUSTOMER_LIMIT ? <p className="text-sm font-semibold text-amber-800">Showing the first {CUSTOMER_LIMIT} active customers. Search by name to find others.</p> : null}
      <ProjectForm customers={customers} />
    </div>
  );
}
