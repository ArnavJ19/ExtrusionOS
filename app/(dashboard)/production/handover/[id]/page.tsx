import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AcknowledgeHandover, HandoverSummaryView } from "@/components/modules/production/shift-handover";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReadHandover, canSubmitHandover, formatIst, handoverRecordSchema } from "@/lib/workflow/shift-handover";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ShiftHandoverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (context.dealerId || !canReadHandover(context.role)) redirect("/dashboard");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const result = await supabase.rpc("shift_handover_command", { p_command: "handover.load", p_payload: { handover_id: id } });
  if (result.error?.message === "Handover is unavailable") notFound();
  if (result.error) throw new Error("The handover could not be loaded. Refresh to retry.");
  const record = handoverRecordSchema.parse(result.data);

  return (
    <div className="space-y-5">
      <PageHeader
        title={record.shift_label}
        description={`${formatIst(record.period_start)} to ${formatIst(record.period_end)} IST · prepared by ${record.prepared_by_name} on ${formatIst(record.prepared_at)}`}
        actions={<Link href="/production/handover" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All handovers</Link>}
      />
      {record.note ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-black text-amber-950">Supervisor note</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-amber-950">{record.note}</p>
        </section>
      ) : null}
      <AcknowledgeHandover record={record} canAcknowledge={canSubmitHandover(context.role)} isPreparer={record.prepared_by === context.userId} />
      <HandoverSummaryView summary={record.summary} />
    </div>
  );
}
