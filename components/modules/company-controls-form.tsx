"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { saveCompanyControlSettingsAction } from "@/lib/actions/erp-controls";

type Controls = { delivery_completion_tolerance_percent: number; metal_receipt_max_kg: number; metal_receipt_weighbridge_threshold_kg: number };

export function CompanyControlsForm({ initial, canEdit }: { initial: Controls; canEdit: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({
    delivery_completion_tolerance_percent: String(initial.delivery_completion_tolerance_percent),
    metal_receipt_max_kg: String(initial.metal_receipt_max_kg),
    metal_receipt_weighbridge_threshold_kg: String(initial.metal_receipt_weighbridge_threshold_kg)
  });
  const [pending, startTransition] = useTransition();
  function save() {
    startTransition(async () => {
      const result = await saveCompanyControlSettingsAction(values);
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Operational controls saved");
      router.refresh();
    });
  }
  const field = (name: keyof typeof values, label: string, hint: string, step: string) => (
    <label className="block space-y-1.5">
      <span className="form-label">{label}</span>
      <input className="form-input" type="number" step={step} disabled={!canEdit} value={values[name]} onChange={(event) => setValues({ ...values, [name]: event.target.value })} />
      <span className="text-xs font-semibold text-slate-500">{hint}</span>
    </label>
  );
  return (
    <Card>
      <CardHeader><h2 className="section-title">Operational controls</h2></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {field("delivery_completion_tolerance_percent", "Delivery completion tolerance %", "An order closes as delivered within this shortfall (0 to 10).", "0.01")}
          {field("metal_receipt_max_kg", "Maximum kg per metal receipt", "Ingot, purchased scrap and outsourced billet receipts above this are rejected.", "0.001")}
          {field("metal_receipt_weighbridge_threshold_kg", "Weighbridge slip required from kg", "Receipts at or above this need a weighbridge slip reference.", "0.001")}
        </div>
        {canEdit ? <div className="flex justify-end"><Button type="button" disabled={pending} onClick={save}>{pending ? "Saving..." : "Save controls"}</Button></div> : <p className="text-xs font-semibold text-slate-500">Only an owner or admin can change these controls.</p>}
      </CardContent>
    </Card>
  );
}
