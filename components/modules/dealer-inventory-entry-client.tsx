"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatWeight } from "@/lib/utils/format";

type ProfileOption = { id: string; profile_code: string; profile_name: string; section_weight_kg_per_m?: number | null };
type StockRow = { id: string; finish: string; length_m: number; quantity_pieces: number; total_weight_kg: number; bundle_number?: string | null; location?: string | null; status: string; aluminium_profiles?: { profile_code?: string; profile_name?: string } | null };

export function DealerInventoryEntryClient({ profiles, stock }: { profiles: ProfileOption[]; stock: StockRow[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ profile_id: "", finish: "mill_finish", length_m: "5.8", quantity_pieces: "", total_weight_kg: "", bundle_number: "", location: "Dealer warehouse", notes: "" });

  async function submit() {
    setSaving(true);
    const response = await fetch("/api/dealer-inventory/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not add inventory");
    toast.success("Dealer inventory added");
    setForm({ profile_id: "", finish: "mill_finish", length_m: "5.8", quantity_pieces: "", total_weight_kg: "", bundle_number: "", location: "Dealer warehouse", notes: "" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h2 className="section-title">Add Dealer Inventory</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block space-y-1.5"><span className="form-label">Profile *</span><select className="form-input" value={form.profile_id} onChange={(event) => setForm({ ...form, profile_id: event.target.value })}><option value="">Select profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_code} - {profile.profile_name}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="form-label">Finish *</span><select className="form-input" value={form.finish} onChange={(event) => setForm({ ...form, finish: event.target.value })}><option value="mill_finish">Mill finish</option><option value="powder_coating">Powder coating</option><option value="anodizing">Anodizing</option><option value="wood_finish">Wood finish</option></select></label>
            <label className="block space-y-1.5"><span className="form-label">Length m *</span><input className="form-input" type="number" min="0" step="0.001" value={form.length_m} onChange={(event) => setForm({ ...form, length_m: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Pieces *</span><input className="form-input" type="number" min="1" step="1" value={form.quantity_pieces} onChange={(event) => setForm({ ...form, quantity_pieces: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Total kg *</span><input className="form-input" type="number" min="0" step="0.001" value={form.total_weight_kg} onChange={(event) => setForm({ ...form, total_weight_kg: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Bundle number</span><input className="form-input" value={form.bundle_number} onChange={(event) => setForm({ ...form, bundle_number: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Location</span><input className="form-input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
            <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Notes</span><input className="form-input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Manual entry reason, source, stock count note" /></label>
          </div>
          <div className="flex justify-end"><Button type="button" disabled={saving} onClick={submit}>{saving ? "Adding..." : "Add to My Inventory"}</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="section-title">My Profile Stock</h2></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="industrial-table min-w-[900px]"><thead><tr>{["Profile", "Finish", "Pieces", "Weight", "Bundle", "Location", "Status"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{stock.map((row) => <tr key={row.id}><td className="font-black">{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td>{row.finish}</td><td>{row.quantity_pieces}</td><td>{formatWeight(row.total_weight_kg)}</td><td>{row.bundle_number ?? "-"}</td><td>{row.location ?? "-"}</td><td><Badge value={row.status} /></td></tr>)}{!stock.length ? <tr><td colSpan={7} className="px-4 py-12 text-center font-semibold text-slate-500">No dealer inventory found.</td></tr> : null}</tbody></table></div></CardContent>
      </Card>
    </div>
  );
}
