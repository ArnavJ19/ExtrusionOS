import Link from "next/link";
import type { ReactNode } from "react";
import { Download, PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfiguratorOutputNav } from "@/components/modules/systems-configurator/output-nav";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/permissions";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { reserveSystemBomProfileStock } from "@/lib/systems-configurator/actions";
import { getSystemBomReadiness } from "@/lib/systems-configurator/bom-readiness";
import { buildProfileReservationStatus, groupProfileReservationRequirements } from "@/lib/systems-configurator/inventory-reservation";
import { labelize } from "@/types/app";

export default async function SystemBomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const [configurationResult, materialResult, profileResult, glassResult, hardwareResult] = await Promise.all([
    supabase.from("system_configurations").select("configuration_number, design_reference, project_name, grand_total, status, order_id").eq("company_id", context.companyId).eq("id", id).single(),
    supabase.from("system_material_summary").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("material_type", { ascending: true }),
    supabase.from("system_profile_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("profile_code", { ascending: true }).order("sort_order", { ascending: true }),
    supabase.from("system_glass_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("panel_index", { ascending: true }),
    supabase.from("system_hardware_bom").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("hardware_category", { ascending: true })
  ]);
  const configuration = configurationResult.data;
  const materialRows = materialResult.data ?? [];
  const profileRows = profileResult.data ?? [];
  const glassRows = glassResult.data ?? [];
  const hardwareRows = hardwareResult.data ?? [];
  const profileMaterialRows = materialRows.filter((item: any) => item.material_type === "aluminium_profile");
  const readiness = getSystemBomReadiness({ materialRows, profileCuts: profileRows, glassCuts: glassRows, hardwareRows });
  const reservationSourceRows = profileMaterialRows.length ? profileMaterialRows.map((item: any) => ({ profile_id: item.item_id, profile_code: item.item_code, profile_name: item.item_name, total_weight_kg: item.total_weight_kg, total_length_m: item.total_length_m })) : profileRows;
  const reservationRequirements = groupProfileReservationRequirements(reservationSourceRows);
  const [stockResult, reservationsResult] = reservationRequirements.length ? await Promise.all([
    supabase.from("profile_stock_batches").select("id, profile_id, total_weight_kg, status").eq("company_id", context.companyId).in("profile_id", reservationRequirements.map((item) => item.profileId)),
    supabase.from("profile_stock_reservations").select("profile_stock_batch_id, profile_id, order_id, configuration_id, reserved_weight_kg, status").eq("company_id", context.companyId).eq("status", "active").in("profile_id", reservationRequirements.map((item) => item.profileId))
  ]) : [{ data: [] }, { data: [] }];
  const reservationStatus = buildProfileReservationStatus(reservationRequirements, stockResult.data ?? [], reservationsResult.data ?? []);
  const orderId = configuration?.order_id ?? null;
  const alreadyReservedForThisConfiguration = Boolean(orderId) && (reservationsResult.data ?? []).some((reservation: any) => reservation.configuration_id === id && reservation.order_id === orderId);
  const reservationReady = Boolean(configuration?.order_id) && reservationStatus.length > 0 && reservationStatus.every((item) => item.ready);
  const reserveAction = reserveSystemBomProfileStock.bind(null, id);
  const materialAmount = materialRows.reduce((sum, item: any) => sum + Number(item.amount ?? 0), 0);
  const profileWeight = profileMaterialRows.reduce((sum, item: any) => sum + Number(item.total_weight_kg ?? 0), 0);
  const profileLength = profileMaterialRows.reduce((sum, item: any) => sum + Number(item.total_length_m ?? 0), 0);
  const glassArea = glassRows.reduce((sum, item: any) => sum + Number(item.area_sqft ?? 0), 0);
  const hardwareAmount = hardwareRows.reduce((sum, item: any) => sum + Number(item.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Production BOM" description={`${configuration?.configuration_number ?? "System"} · ${configuration?.design_reference ?? configuration?.project_name ?? "Aluminium system"}. Profiles, glass, beading, hardware, gasket, accessories, costing, and production-readiness checks.`} />
        <Link href={`/api/pdf/systems-configurator/${id}/hardware_bom`} target="_blank" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Download className="h-4 w-4" /> PDF</Link>
      </div>
      <ConfiguratorOutputNav projectId={id} active="bom" />

      <Card className={readiness.ready ? "border-emerald-200 bg-emerald-50 shadow-sm" : "border-red-200 bg-red-50 shadow-sm"}>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><p className={readiness.ready ? "text-sm font-black text-emerald-900" : "text-sm font-black text-red-900"}>{readiness.ready ? "BOM is ready for production review." : "BOM has production blockers."}</p><p className="mt-1 text-sm font-semibold text-slate-700">Critical issues must be fixed before using this BOM for cutting, purchasing, or production handoff.</p></div>
            <Badge value={readiness.ready ? "ready" : "blocked"} />
          </div>
          {readiness.issues.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{readiness.issues.map((issue) => <div key={issue.label} className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{issue.label}</p><Badge value={issue.severity} /></div><p className="mt-2 text-sm font-medium leading-6 text-slate-600">{issue.detail}</p></div>)}</div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><Metric label="Material Lines" value={String(materialRows.length)} /><Metric label="Profile Weight" value={`${profileWeight.toFixed(3)} kg`} /><Metric label="Profile Length" value={`${profileLength.toFixed(3)} m`} /><Metric label="Glass Area" value={`${glassArea.toFixed(3)} sqft`} /><Metric label="Hardware" value={`Rs. ${hardwareAmount.toLocaleString("en-IN")}`} /><Metric label="BOM Amount" value={`Rs. ${materialAmount.toLocaleString("en-IN")}`} highlight /></div>

      <Card className={reservationReady ? "border-emerald-200 bg-emerald-50 shadow-sm" : "border-amber-200 bg-amber-50 shadow-sm"}>
        <CardHeader><h2 className="section-title">Inventory Reservation</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><p className={reservationReady ? "text-sm font-black text-emerald-900" : "text-sm font-black text-amber-900"}>{alreadyReservedForThisConfiguration ? "Profile stock is already reserved for this configuration." : reservationReady ? "Profile stock can be reserved for the linked order." : configuration?.order_id ? "Profile stock is short or already reserved." : "Convert to an order before reserving stock."}</p><p className="mt-1 text-sm font-semibold text-slate-700">Reservation now uses a batch-level ledger, so partial kg can be reserved without blocking the entire stock batch.</p></div>
            {can(context.role, "update", "inventory") || can(context.role, "update", "production") ? <form action={reserveAction}><button type="submit" disabled={!reservationReady || alreadyReservedForThisConfiguration} className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-50">Reserve Stock</button></form> : null}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-white/70 bg-white">
            <table className="w-full min-w-[820px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Profile</th><th className="px-4 py-3 text-right">Required kg</th><th className="px-4 py-3 text-right">Stock kg</th><th className="px-4 py-3 text-right">Available kg</th><th className="px-4 py-3 text-right">Reserved kg</th><th className="px-4 py-3 text-right">Shortage kg</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{reservationStatus.map((item) => <tr key={item.profileId} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{item.profileCode}<p className="text-xs font-semibold text-slate-500">{item.profileName}</p></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{item.requiredWeightKg.toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{item.totalStockWeightKg.toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{item.availableWeightKg.toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{item.reservedWeightKg.toFixed(3)}</td><td className="px-4 py-3 text-right font-black tabular-nums">{item.shortageKg.toFixed(3)}</td><td className="px-4 py-3"><Badge value={item.ready ? "ready" : "short"} /></td></tr>)}{!reservationStatus.length ? <tr><td colSpan={7} className="px-4 py-10 text-center font-semibold text-slate-500">No linked profile cuts available for reservation.</td></tr> : null}</tbody></table>
          </div>
        </CardContent>
      </Card>

      <BomTable title="Material Summary" rows={materialRows} empty="No material summary yet." id={id} columns={["Material", "Qty", "Weight", "Length", "Area", "Rate", "Amount"]} render={(item: any) => <tr key={item.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{item.item_code || labelize(item.material_type)}<p className="text-xs font-semibold text-slate-500">{item.item_name}</p></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.quantity ?? 0).toFixed(3)} {item.unit}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.total_weight_kg ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.total_length_m ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.total_area_sqft ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">Rs. {Number(item.rate ?? 0).toLocaleString("en-IN")}</td><td className="px-4 py-3 text-right font-black tabular-nums">Rs. {Number(item.amount ?? 0).toLocaleString("en-IN")}</td></tr>} />
      <BomTable title="Profile Requirement" rows={profileRows} empty="No profile cuts yet." id={id} columns={["Profile", "Component", "Cut mm", "Qty", "Total m", "Kg/m", "Weight kg", "Stock mm"]} render={(cut: any) => <tr key={cut.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{cut.profile_code}<p className="text-xs font-semibold text-slate-500">{cut.profile_name}</p></td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(cut.component_role)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.cut_length_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cut.quantity}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.total_length_m ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.section_weight_kg_per_m ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-black tabular-nums">{Number(cut.total_weight_kg ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.stock_length_mm ?? 0).toFixed(0)}</td></tr>} />
      <BomTable title="Glass Requirement" rows={glassRows} empty="No glass cuts yet." id={id} columns={["Panel", "Glass", "Width", "Height", "Qty", "Area", "Rate", "Amount"]} render={(cut: any) => <tr key={cut.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{cut.glass_label || `P${cut.panel_index}`}</td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(cut.glass_type ?? "glass")} · {cut.thickness_mm}mm</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.width_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.height_mm ?? 0).toFixed(0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cut.quantity}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(cut.area_sqft ?? 0).toFixed(3)} sqft</td><td className="px-4 py-3 text-right font-semibold tabular-nums">Rs. {Number(cut.rate ?? 0).toLocaleString("en-IN")}</td><td className="px-4 py-3 text-right font-black tabular-nums">Rs. {Number(cut.amount ?? 0).toLocaleString("en-IN")}</td></tr>} />
      <BomTable title="Hardware, Gasket & Accessories" rows={hardwareRows} empty="No hardware BOM yet." id={id} columns={["Item", "Category", "Qty", "Unit", "Rate", "Amount", "Rule / Remarks"]} render={(item: any) => <tr key={item.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950">{item.item_code}<p className="text-xs font-semibold text-slate-500">{item.item_name}</p></td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(item.hardware_category)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.quantity ?? 0).toFixed(3)}</td><td className="px-4 py-3 font-semibold">{item.unit}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">Rs. {Number(item.rate ?? 0).toLocaleString("en-IN")}</td><td className="px-4 py-3 text-right font-black tabular-nums">Rs. {Number(item.amount ?? 0).toLocaleString("en-IN")}</td><td className="max-w-[280px] px-4 py-3 text-xs font-bold leading-5 text-slate-500">{item.remarks ?? "Default system hardware rule"}</td></tr>} />
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}

function BomTable({ title, rows, columns, render, empty, id }: { title: string; rows: any[]; columns: string[]; render: (row: any) => ReactNode; empty: string; id: string }) {
  return <Card className="overflow-hidden border-slate-200 shadow-sm"><CardHeader className="border-b border-slate-100 bg-white"><h2 className="flex items-center gap-2 font-black text-slate-950"><PackageCheck className="h-5 w-5 text-orange" /> {title}</h2></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[940px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr>{columns.map((column, index) => <th key={column} className={`px-4 py-3 ${index > 1 ? "text-right" : ""}`}>{column}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(render)}{!rows.length ? <tr><td colSpan={columns.length} className="px-4 py-12 text-center font-semibold text-slate-500">{empty} <Link href={`/systems-configurator/projects/${id}`} className="font-black text-orange">Calculate this configuration</Link>.</td></tr> : null}</tbody></table></div></CardContent></Card>;
}
