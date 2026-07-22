import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { FinishingWorkflowBoard } from "@/components/modules/finishing-workflow-board";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { labelize } from "@/types/app";
import { redirect } from "next/navigation";

const attentionStatuses = ["planned", "sent_to_vendor", "in_process", "received", "rejected"];

export default async function ProductionFinishingPage({ searchParams }: { searchParams: Promise<{ production_job_id?: string; order_id?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "production")) redirect("/dashboard");
  const params = await searchParams;
  const supabase = await createClient();
  let request = supabase
    .from("finishing_jobs")
    .select("*, orders(order_number, customers(customer_name, company_name)), production_jobs(job_number), vendors(vendor_name)")
    .eq("company_id", context.companyId)
    .in("status", attentionStatuses);
  if (params.production_job_id) request = request.eq("production_job_id", params.production_job_id);
  if (params.order_id) request = request.eq("order_id", params.order_id);
  const { data, error } = await request
    .order("planned_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const rejectedIds = rows.filter((row: any) => row.status === "rejected").map((row: any) => row.id);
  const retryResult = rejectedIds.length
    ? await supabase
      .from("finishing_jobs")
      .select("*, orders(order_number, customers(customer_name, company_name)), production_jobs(job_number), vendors(vendor_name)")
      .eq("company_id", context.companyId)
      .in("retry_of_finishing_job_id", rejectedIds)
    : { data: [], error: null };
  const workflowRows = [
    ...rows,
    ...(retryResult.data ?? []).filter((retry: any) => !rows.some((row: any) => row.id === retry.id))
  ];
  const { data: vendorRows, error: vendorError } = await supabase
    .from("vendors")
    .select("id, vendor_name, vendor_type")
    .eq("company_id", context.companyId)
    .eq("is_active", true)
    .in("vendor_type", ["powder_coating", "anodizing", "other"])
    .order("vendor_name");
  const openRows = rows.filter((row: any) => !["completed", "not_required"].includes(row.status));
  const sentWeight = rows.filter((row: any) => ["sent_to_vendor", "in_process"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.input_weight_kg ?? 0), 0);
  const rejectionWeight = rows.reduce((sum: number, row: any) => sum + Number(row.rejection_weight_kg ?? 0), 0);

  return (
    <div className="space-y-6">
      <div><Link href="/production" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Production</Link><PageHeader title="Finishing Board" description="Track powder coating, anodizing, wood finish, outsourced vendor movement, receipts, rejection weight, and completion status." /></div>
      {error ? <Card className="border-red-200 bg-red-50"><CardContent><p className="font-black text-red-900">Could not load finishing jobs.</p><p className="mt-1 text-sm font-semibold text-red-700">{error.message}</p></CardContent></Card> : null}

      {vendorError ? <Card className="border-red-200 bg-red-50"><CardContent><p className="font-black text-red-900">Could not load finishing vendors.</p><p className="mt-1 text-sm font-semibold text-red-700">{vendorError.message}</p></CardContent></Card> : null}
      {retryResult.error ? <Card className="border-red-200 bg-red-50"><CardContent><p className="font-black text-red-900">Could not verify corrective finishing retries.</p><p className="mt-1 text-sm font-semibold text-red-700">{retryResult.error.message}</p></CardContent></Card> : null}
      <div className="grid gap-3 md:grid-cols-4"><Metric label="Open Jobs" value={String(openRows.length)} /><Metric label="At Vendor / In Process" value={formatWeight(sentWeight)} /><Metric label="Rejected" value={formatWeight(rejectionWeight)} /><Metric label="Active Queue" value={String(rows.length)} highlight /></div>

      <Card>
        <CardHeader><h2 className="section-title">Status Summary</h2></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {attentionStatuses.map((status) => <div key={status} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{labelize(status)}</p><p className="mt-2 text-2xl font-black text-slate-950">{rows.filter((row: any) => row.status === status).length}</p></div>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="section-title">Update Finishing Movement</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Use the explicit movement buttons to send, receive, reject, or complete material. Every status change is retained in history.</p>
        </CardHeader>
        <CardContent>
          <FinishingWorkflowBoard jobs={workflowRows} vendors={vendorRows ?? []} canUpdate={can(context.role, "update", "production")} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader><h2 className="section-title">Finishing Jobs</h2></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="industrial-table min-w-[1120px]">
              <thead><tr><th>Order / Job</th><th>Finish</th><th>Status</th><th>Vendor</th><th>Planned</th><th>Sent</th><th>Received</th><th className="text-right">Input kg</th><th className="text-right">Output kg</th><th className="text-right">Rejected kg</th><th>Remarks</th></tr></thead>
              <tbody>
                {rows.map((row: any) => <tr key={row.id}><td className="font-black text-slate-950">{row.orders?.order_number ?? "Order"}<p className="text-xs font-semibold text-slate-500">{row.production_jobs?.job_number ?? "No production job"} | {row.orders?.customers?.company_name ?? row.orders?.customers?.customer_name ?? "Customer"}</p></td><td className="font-semibold text-slate-700">{labelize(row.finishing_type)}<p className="text-xs text-slate-500">{row.color_code || row.shade_name || "No color"}</p></td><td><Badge value={row.status} /></td><td>{row.vendors?.vendor_name ?? "In-house / not assigned"}</td><td>{formatDate(row.planned_date)}</td><td>{formatDate(row.sent_date)}</td><td>{formatDate(row.received_date)}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.input_weight_kg)}</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.output_weight_kg)}</td><td className="text-right font-black tabular-nums text-slate-950">{formatWeight(row.rejection_weight_kg)}</td><td className="max-w-[260px] text-xs font-semibold leading-5 text-slate-500">{row.remarks || "-"}</td></tr>)}
                {!rows.length ? <tr><td colSpan={11} className="px-4 py-12 text-center font-semibold text-slate-500">No finishing jobs found. Finishing jobs are created from production/order workflows when surface treatment is required.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}
