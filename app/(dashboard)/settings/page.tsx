import { SettingsClient } from "@/components/modules/settings-client";
import { CompanyControlsForm } from "@/components/modules/company-controls-form";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { booksLockControls } from "@/lib/workflow/erp-control-panels";
import { OperationalWorkLinks } from "@/components/modules/shared/operational-work-links";
import Link from "next/link";

// Autopilot batch 1 setup pages.
const AUTOPILOT_LINKS = [
  { href: "/settings/data/import", label: "Import masters from Excel" }, { href: "/settings/data/cutover", label: "Opening balances and cut-over" },
  { href: "/settings/navigation", label: "Navigation by role" }, { href: "/invoices/numbering", label: "Document numbering" }, { href: "/invoices/periods", label: "Month close" },
  { href: "/production/calendar", label: "Factory calendar" }, { href: "/automation", label: "Scheduled jobs" }
];

export default async function SettingsPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const [companyResult, settingsResult, controlsResult, lockResult] = await Promise.all([
    supabase.from("companies").select("*").eq("id", context.companyId).single(),
    supabase.from("company_settings_authorized").select("*").eq("company_id", context.companyId).maybeSingle(),
    supabase.from("company_settings").select("delivery_completion_tolerance_percent, metal_receipt_max_kg, metal_receipt_weighbridge_threshold_kg").eq("company_id", context.companyId).maybeSingle(),
    supabase.rpc("get_books_locked_through")
  ]);
  const controls = controlsResult.data;
  return (
    <div className="space-y-6">
      <OperationalWorkLinks area="settings" role={context.role} dealer={!!context.dealerId}/>
      {["owner", "admin"].includes(context.role) ? <section aria-label="Go-live and automation" className="rounded-2xl border border-neutral-200 bg-white p-4"><h2 className="text-sm font-bold">Go-live and automation</h2>
        <ul className="mt-2 flex flex-wrap gap-2">{AUTOPILOT_LINKS.map(link => <li key={link.href}><Link href={link.href} className="inline-flex min-h-10 items-center rounded-xl border border-neutral-300 px-3 text-sm font-semibold hover:bg-neutral-50">{link.label}</Link></li>)}</ul></section> : null}
      <SettingsClient context={context} company={companyResult.data ?? { id: context.companyId, name: context.companyName }} settings={settingsResult.data} />
      {controls ? <CompanyControlsForm canEdit={["owner", "admin"].includes(context.role)} initial={{
        delivery_completion_tolerance_percent: Number(controls.delivery_completion_tolerance_percent ?? 0),
        metal_receipt_max_kg: Number(controls.metal_receipt_max_kg ?? 60000),
        metal_receipt_weighbridge_threshold_kg: Number(controls.metal_receipt_weighbridge_threshold_kg ?? 10000)
      }} /> : null}
      <ErpControlPanel title="Accounting period" actions={booksLockControls(context, lockResult.data ? String(lockResult.data) : null)} />
    </div>
  );
}
