import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerRequirementForm } from "@/components/modules/orders/customer-requirements";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageCustomerRequirements, customerRequirementSchema } from "@/lib/workflow/customer-step-requirements";

export default async function NewCustomerRequirementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; page?: string }> }) {
  const [{ id }, q, c] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (c.dealerId || !canManageCustomerRequirements(c.role)) redirect("/customers");
  let existing;
  if (q.edit) {
    const client = await createClient();
    const r = await client.rpc("customer_requirement_command", { p_command: "requirement.load", p_payload: { customer_id: id, id: q.edit } });
    existing = !r.error ? customerRequirementSchema.safeParse(r.data).data : null;
    if (!existing) notFound();
  }
  return <div className="space-y-5"><PageHeader title={existing ? "Update customer requirement" : "New customer requirement"} description="A change creates a new revision. Orders must review it before the next applicable work step; earlier acknowledgements remain as history." actions={<Link className="text-sm font-bold underline" href={`/customers/${id}/requirements`}>All requirements</Link>} /><section className="rounded-3xl border border-slate-200 bg-white p-5"><CustomerRequirementForm customerId={id} existing={existing ?? undefined} /></section></div>;
}
