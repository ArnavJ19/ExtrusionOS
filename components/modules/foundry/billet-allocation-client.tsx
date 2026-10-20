"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { allocateBilletToOrderAction, reallocateBilletToOrderAction } from "@/lib/actions/production";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { isAllocationRecordId as isRecordId, parseAllocationBillet, parseAllocationOptions, type AllocationBillet, type AllocationOptions } from "@/lib/workflow/billet-allocation-options";
import type { SessionContext } from "@/types/app";

export function BilletAllocationClient({ context, billetId }: { context: SessionContext; billetId: string }) {
  if (!can(context.role, "update", "foundry")) return null;
  return <BilletAllocationPanel key={`${context.userId}:${context.companyId}:${context.role}:${billetId}`} context={context} billetId={billetId} />;
}

type AllocationRead =
  | { status: "loading" }
  | { status: "unavailable"; error: string }
  | { status: "ready"; billet: AllocationBillet; options: AllocationOptions | null };

const allocationUnconfirmed = "Allocation could not be confirmed. Refresh the billet and review its current allocation before trying again.";

function BilletAllocationPanel({ context, billetId }: { context: SessionContext; billetId: string }) {
  const [supabase] = useState(() => createClient());
  const [read, setRead] = useState<AllocationRead>({ status: "loading" });
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState({ search: "", page: 1 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const mounted = useRef(false);
  const savePending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const { data: billetData, error: billetError } = await supabase
          .from("foundry_billets")
          .select("id, company_id, billet_code, alloy, temper, billet_diameter_inch, status, order_id, production_job_id")
          .eq("company_id", context.companyId)
          .eq("id", billetId)
          .single();
        if (!current) return;
        if (billetError) throw billetError;
        const initialBillet = parseAllocationBillet(billetData, { companyId: context.companyId, billetId });
        let options: AllocationOptions | null = null;
        if ((initialBillet.status === "cast" || initialBillet.status === "allocated") && !initialBillet.production_job_id) {
          const { data, error } = await supabase.rpc("get_manual_billet_allocation_options", {
            p_billet_id: billetId, p_search: query.search.trim(), p_page: query.page,
          });
          if (!current) return;
          if (error?.code === "PGRST202") throw new Error("Allocation options are unavailable until the database update is ready. Contact an administrator.");
          if (error) throw error;
          options = parseAllocationOptions(data, { companyId: context.companyId, billetId, search: query.search, page: query.page });
        }
        setRead({ status: "ready", billet: options?.billet ?? initialBillet, options });
      } catch (error) {
        if (current) setRead({ status: "unavailable", error: getErrorMessage(error, "Could not load billet allocation options") });
      }
    }
    void load();
    return () => { current = false; };
  }, [supabase, billetId, context.companyId, revision, query.search, query.page]);

  function changeQuery(search: string, page: number) {
    if (savePending.current) return;
    setSelectedOrderId("");
    setSaveError(null);
    setRead({ status: "loading" });
    setQuery({ search, page });
  }

  function refresh() {
    if (savePending.current) return;
    setSelectedOrderId("");
    setSaveError(null);
    setRead({ status: "loading" });
    setRevision(value => value + 1);
  }

  async function allocate() {
    if (savePending.current || saveError || read.status !== "ready") return;
    if (!selectedOrderId || !read.options?.items.some(row => row.order_id === selectedOrderId)) return toast.error("Select an order to allocate this billet.");
    savePending.current = true;
    setSaving(true);
    setConfirmation(null);
    try {
      const result = read.billet.order_id
        ? await reallocateBilletToOrderAction({ billet_id: billetId, order_id: selectedOrderId })
        : await allocateBilletToOrderAction({ billet_id: billetId, order_id: selectedOrderId });
      if (!mounted.current) return;
      if (!result?.success) {
        setSaveError(result?.error ? `${getErrorMessage({ message: result.error })} Refresh the billet before trying again.` : allocationUnconfirmed);
        return;
      }
      if (!isRecordId(result.requirementId)) {
        setSaveError(allocationUnconfirmed);
        return;
      }
      setConfirmation("Billet allocated to order.");
      toast.success("Billet allocated to order");
      setSelectedOrderId("");
      setRead({ status: "loading" });
      setQuery({ search: "", page: 1 });
      setRevision(value => value + 1);
    } catch {
      if (mounted.current) setSaveError(allocationUnconfirmed);
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const billet = read.status === "ready" ? read.billet : null;
  const options = read.status === "ready" ? read.options : null;

  return (
    <Card>
      <CardHeader><h2 className="section-title">Manual Order Allocation</h2></CardHeader>
      <CardContent className="min-w-0 space-y-4 break-words">
        {confirmation ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{confirmation}</p> : null}
        {saveError ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{saveError}</p> : null}
        {billet ? (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Billet</p><p className="font-black text-slate-950">{billet.billet_code}</p></div>
              <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Alloy</p><p className="font-black text-slate-950">{billet.alloy?.trim() || "Not captured"}</p></div>
              <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">Temper / Diameter</p><p className="font-black text-slate-950">{billet.temper?.trim() || "Not captured"} / {billet.billet_diameter_inch} in</p></div>
            </div>
            {billet.order_id ? <p className="text-sm font-semibold text-slate-700">This billet is allocated. <a className="underline underline-offset-4" href={`/orders/${billet.order_id}`}>View allocated order</a>.</p> : null}
          </>
        ) : null}
        <label className="block space-y-1.5">
          <span className="form-label">Find compatible orders</span>
          <input className="form-input w-full" aria-label="Find compatible orders" placeholder="Search order number" maxLength={100} value={query.search} disabled={saving} onChange={event => changeQuery(event.target.value, 1)} />
        </label>
        {read.status === "loading" ? <p role="status" className="text-sm font-semibold text-slate-600">Loading billet allocation options...</p> : read.status === "unavailable" ? (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{read.error}</p>
        ) : billet && (billet.status !== "cast" && billet.status !== "allocated" || billet.production_job_id) ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            This billet is not available for manual allocation. Current status: <Badge value={billet.status} />
          </div>
        ) : billet && options?.items.length ? (
          <>
            <label className="block space-y-1.5">
              <span className="form-label">Compatible open orders</span>
              <SearchableSelect value={selectedOrderId} placeholder="Select order" disabled={saving || Boolean(saveError)} options={options.items.map(option => ({ value: option.order_id, label: `${option.order_number} - ${option.priority} - needs ${option.billets_short} more / ${option.billets_required} (${option.requirement_count} requirements)` }))} onChange={setSelectedOrderId} />
            </label>
            <Button type="button" disabled={saving || Boolean(saveError) || !selectedOrderId} onClick={allocate}>{saving ? "Saving..." : billet.order_id ? "Reallocate Billet" : "Allocate Billet"}</Button>
          </>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            {query.search.trim() ? "No matching compatible order. Change the order-number search to try again." : "No open order currently needs a compatible billet with this alloy, temper and diameter."}
          </div>
        )}
        {options && options.total_count > 0 ? <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-700">
          <span>Page {options.page} of {Math.max(1, Math.ceil(options.total_count / 10))} / {options.total_count} compatible orders</span>
          <Button type="button" variant="secondary" disabled={saving || options.page <= 1} onClick={() => changeQuery(query.search, options.page - 1)}>Previous orders</Button>
          <Button type="button" variant="secondary" disabled={saving || options.page * 10 >= options.total_count} onClick={() => changeQuery(query.search, options.page + 1)}>Next orders</Button>
        </div> : null}
        <div><Button type="button" variant="secondary" disabled={saving || read.status === "loading"} onClick={refresh}>{read.status === "unavailable" ? "Retry loading allocation" : "Refresh allocation options"}</Button></div>
      </CardContent>
    </Card>
  );
}
