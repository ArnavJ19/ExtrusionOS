"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { allocateBilletToOrderAction, reallocateBilletToOrderAction } from "@/lib/actions/production";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import type { SessionContext } from "@/types/app";

type BilletRow = {
  id: string;
  billet_code: string;
  alloy: string | null;
  billet_diameter_inch: number | null;
  status: string;
  order_id: string | null;
  production_job_id?: string | null;
};

type RequirementRow = {
  id: string;
  order_id: string;
  alloy: string;
  billet_diameter_inch: number;
  billets_required: number;
  billets_allocated: number;
  billets_short: number;
  status: string;
  orders?: { order_number?: string | null; priority?: string | null; expected_dispatch_date?: string | null; current_stage?: string | null } | null;
};

export function BilletAllocationClient({ context, billetId }: { context: SessionContext; billetId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [billet, setBillet] = useState<BilletRow | null>(null);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data: billetData, error: billetError } = await supabase
      .from("foundry_billets")
      .select("id, billet_code, alloy, billet_diameter_inch, status, order_id, production_job_id")
      .eq("company_id", context.companyId)
      .eq("id", billetId)
      .single();
    if (billetError) throw billetError;
    setBillet(billetData as BilletRow);

    if ((billetData?.status === "cast" || billetData?.status === "allocated") && !billetData?.production_job_id) {
      const { data: reqData, error: reqError } = await supabase
        .from("order_billet_requirements")
        .select("id, order_id, alloy, billet_diameter_inch, billets_required, billets_allocated, billets_short, status, orders(order_number, priority, expected_dispatch_date, current_stage)")
        .eq("company_id", context.companyId)
        .in("status", ["pending", "partial", "shortage"])
        .ilike("alloy", billetData.alloy ?? "")
        .eq("billet_diameter_inch", billetData.billet_diameter_inch)
        .gt("billets_short", 0)
        .order("created_at", { ascending: true });
      if (reqError) throw reqError;
      setRequirements((reqData ?? []) as RequirementRow[]);
    } else {
      setRequirements([]);
    }
  }

  useEffect(() => {
    load().catch((error) => toast.error(getErrorMessage(error, "Could not load billet allocation options"))).finally(() => setLoading(false));
  }, [billetId]);

  async function allocate() {
    if (!selectedOrderId) return toast.error("Select an order to allocate this billet.");
    setSaving(true);
    const result = billet?.order_id
      ? await reallocateBilletToOrderAction({ billet_id: billetId, order_id: selectedOrderId })
      : await allocateBilletToOrderAction({ billet_id: billetId, order_id: selectedOrderId });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Billet allocated to order");
    setSelectedOrderId("");
    await load();
  }

  if (loading || !billet) return null;

  return (
    <Card>
      <CardHeader><h2 className="section-title">Manual Order Allocation</h2></CardHeader>
      <CardContent className="space-y-4">
        {billet.status !== "cast" && billet.status !== "allocated" || billet.production_job_id ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            This billet is not available for manual allocation. Current status: <Badge value={billet.status} />
          </div>
        ) : requirements.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Billet</p><p className="font-black text-slate-950">{billet.billet_code}</p></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Alloy</p><p className="font-black text-slate-950">{billet.alloy}</p></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Diameter</p><p className="font-black text-slate-950">{billet.billet_diameter_inch} in</p></div>
            </div>
            <label className="block space-y-1.5">
              <span className="form-label">Compatible open orders</span>
              <SearchableSelect value={selectedOrderId} placeholder="Select order" options={requirements.map((requirement) => ({ value: requirement.order_id, label: `${requirement.orders?.order_number ?? "Order"} - ${requirement.orders?.priority ?? "normal"} - needs ${requirement.billets_short} more / ${requirement.billets_required}` }))} onChange={setSelectedOrderId} />
            </label>
            <Button type="button" disabled={saving || !selectedOrderId} onClick={allocate}>{saving ? "Saving..." : billet.order_id ? "Reallocate Billet" : "Allocate Billet"}</Button>
          </>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            No open order currently needs this billet alloy and diameter. Alloy mismatch is blocked automatically.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
