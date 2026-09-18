"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers3, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { releaseFactoryLoadsAction } from "@/lib/actions/factory-loads";
import { formatWeight } from "@/lib/utils/format";

type QueueRow = {
  id: string;
  manufacturing_weight_kg: number;
  minimum_weight_kg: number;
  compatibility_signature: string;
  compatibility_label: string;
  created_at: string;
  orders?: { order_number?: string | null; priority?: string | null; customers?: { company_name?: string | null; customer_name?: string | null } | null } | null;
};

export function FactoryLoadConsolidationClient({ rows, canRelease }: { rows: QueueRow[]; canRelease: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupCode, setGroupCode] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const selectedWeight = selectedRows.reduce((sum, row) => sum + Number(row.manufacturing_weight_kg), 0);
  const minimum = Math.max(700, ...selectedRows.map((row) => Number(row.minimum_weight_kg)));
  const compatibilityCount = new Set(selectedRows.map((row) => row.compatibility_signature)).size;

  function release(mode: "consolidate" | "override") {
    startTransition(async () => {
      const result = await releaseFactoryLoadsAction({ queue_ids: [...selected], mode, group_code: groupCode, reason });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.releasedCount} factory load${result.releasedCount === 1 ? "" : "s"} released`);
      setSelected(new Set());
      setGroupCode("");
      setReason("");
      router.refresh();
    });
  }

  return <div className="space-y-6">
    <Card><CardHeader><div className="flex items-center gap-3"><Layers3 className="h-6 w-6 text-orange" /><div><h2 className="section-title">Pending Factory Loads</h2><p className="mt-1 text-sm font-medium text-slate-500">Combine compatible orders until the selected manufacturing weight reaches the factory minimum, or use a documented manager exception.</p></div></div></CardHeader><CardContent>
      <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="industrial-table min-w-[980px]"><thead><tr><th className="w-16">Select</th><th>Order</th><th>Customer</th><th>Material compatibility</th><th>Priority</th><th className="text-right">Factory kg</th><th className="text-right">Minimum</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><input type="checkbox" className="h-4 w-4 accent-orange" checked={selected.has(row.id)} disabled={!canRelease} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td className="font-black text-slate-950">{row.orders?.order_number ?? row.id.slice(0, 8)}</td><td>{row.orders?.customers?.company_name || row.orders?.customers?.customer_name || "Customer"}</td><td className="max-w-[260px] text-xs font-bold text-slate-600">{row.compatibility_label}</td><td>{row.orders?.priority ?? "normal"}</td><td className="text-right font-black tabular-nums">{formatWeight(row.manufacturing_weight_kg)}</td><td className="text-right tabular-nums">{formatWeight(row.minimum_weight_kg)}</td></tr>)}{!rows.length ? <tr><td colSpan={7} className="px-4 py-12 text-center font-semibold text-slate-500">No orders are waiting for consolidation.</td></tr> : null}</tbody></table></div>
    </CardContent></Card>
    {canRelease && rows.length ? <Card><CardHeader><h2 className="section-title">Release Selected Loads</h2></CardHeader><CardContent className="space-y-4"><div className={`rounded-2xl border p-4 ${selectedWeight >= minimum && compatibilityCount === 1 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className="font-black text-slate-950">Selected: {formatWeight(selectedWeight)} / {formatWeight(minimum)}</p><p className="mt-1 text-sm font-medium text-slate-600">{compatibilityCount > 1 ? "The selected orders have different alloy, temper, or billet-diameter requirements. Change the selection or use a documented manager exception." : selectedWeight >= minimum ? "The combined load is materially compatible and meets the factory minimum." : "Select more compatible orders or use a manager override with a clear reason."}</p></div><div className="grid gap-4 md:grid-cols-2"><label className="block space-y-1.5"><span className="form-label">Combined load / furnace group reference</span><input className="form-input" value={groupCode} onChange={(event) => setGroupCode(event.target.value)} placeholder="LOAD-2026-07-23-A" /></label><label className="block space-y-1.5"><span className="form-label">Manager override reason</span><input className="form-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Customer shutdown commitment, alloy campaign constraint..." /></label></div><div className="flex flex-wrap gap-3"><Button disabled={pending || !selected.size || selectedWeight < minimum || compatibilityCount !== 1 || !groupCode.trim()} onClick={() => release("consolidate")}><Layers3 className="mr-2 h-4 w-4" /> Release combined load</Button><Button variant="secondary" disabled={pending || !selected.size || reason.trim().length < 8} onClick={() => release("override")}><ShieldCheck className="mr-2 h-4 w-4" /> Manager override</Button></div></CardContent></Card> : null}
  </div>;
}
