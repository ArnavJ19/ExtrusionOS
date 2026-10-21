import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Moon, Search } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { LogoutButton } from "./logout-button";
import { ModuleNavigator } from "./module-navigator";
import { TaskNavigation } from "./task-navigation";
import type { NavIconName } from "./nav-link";
import { WorkspaceShortcuts } from "./workspace-shortcuts";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { getSearchResourceKeys } from "@/lib/auth/role-experience";
import { buildTaskNavigation } from "@/lib/navigation/task-navigation";
import type { EnterpriseModuleName, UserRole } from "@/types/app";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: "BarChart3", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"] },
  { href: "/command-center", label: "Command Center", icon: "Activity", roles: ["owner", "admin"] },
  { href: "/customers", label: "Customers", icon: "Users", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "dispatch_manager", "accounts", "viewer"] },
  { href: "/crm", label: "CRM", icon: "Target", roles: ["owner", "admin", "sales_manager", "sales"], module: "crm" },
  { href: "/profiles", label: "Profiles", icon: "Shapes", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "inventory_manager", "quality", "viewer"] },
  { href: "/dies", label: "Dies", icon: "Wrench", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "quality", "viewer"] },
  { href: "/die-intelligence", label: "Die Intel", icon: "Activity", roles: ["owner", "admin", "production_manager", "quality"] },
  { href: "/quotes", label: "Quotes", icon: "FileText", roles: ["owner", "admin", "sales_manager", "sales", "accounts", "viewer"] },
  { href: "/ai/quotation-assistant", label: "AI Quotes", icon: "Bot", roles: ["owner", "admin", "sales_manager", "sales"], module: "ai_assistant" },
  { href: "/systems-configurator", label: "Configurator", icon: "PackageCheck", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "viewer"] },
  { href: "/communications/whatsapp", label: "WhatsApp", icon: "FileText", roles: ["owner", "admin", "sales_manager", "sales"] },
  { href: "/barcode", label: "QR Gen", icon: "QrCode", roles: ["owner", "admin", "production_manager", "dispatch_manager"] },
  { href: "/scan", label: "Scanner", icon: "Search", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "quality"] },
  { href: "/mobile", label: "Mobile", icon: "Smartphone", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "quality"], module: "mobile_floor_app" },
  { href: "/documents", label: "Documents", icon: "FolderSearch", roles: ["owner", "admin", "sales_manager", "production_manager", "quality"] },
  { href: "/energy", label: "Energy", icon: "Zap", roles: ["owner", "admin", "production_manager"], module: "energy_monitoring" },
  { href: "/maintenance", label: "Maintenance", icon: "Wrench", roles: ["owner", "admin", "production_manager"], module: "machine_maintenance" },
  { href: "/machines", label: "Machines", icon: "Wrench", roles: ["owner", "admin", "production_manager", "production", "viewer"] },
  { href: "/tasks", label: "Tasks", icon: "CheckSquare", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"] },
  { href: "/orders", label: "Orders", icon: "Factory", roles: ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] },
  { href: "/production", label: "Production", icon: "CalendarRange", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"], module: "production_planning" },
  { href: "/foundry", label: "Foundry", icon: "Factory", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"] },
  { href: "/packaging", label: "Packaging", icon: "PackageCheck", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "viewer"] },
  { href: "/quality", label: "Quality", icon: "ClipboardCheck", roles: ["owner", "admin", "production_manager", "quality", "viewer"], module: "quality_compliance" },
  { href: "/inventory", label: "Inventory", icon: "Boxes", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "inventory_manager", "viewer", "dealer_admin", "dealer_staff"], module: "advanced_inventory" },
  { href: "/dealer-inventory", label: "Dealer Ledger", icon: "Boxes", roles: ["owner", "admin", "sales_manager", "factory_manager", "inventory_manager", "viewer", "dealer_admin", "dealer_staff"], module: "dealer_portal" },
  { href: "/vendors", label: "Vendors", icon: "Building2", roles: ["owner", "admin", "sales_manager", "production_manager", "accounts", "viewer"] },
  { href: "/dispatches", label: "Dispatches", icon: "Truck", roles: ["owner", "admin", "sales_manager", "sales", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "viewer"], aliases: ["/shipments"] },
  { href: "/dealer-orders", label: "Dealer Orders", icon: "Truck", roles: ["owner", "admin", "sales_manager", "sales", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"] },
  { href: "/discrepancies", label: "Discrepancies", icon: "ShieldCheck", roles: ["owner", "admin", "factory_manager", "inventory_manager", "dealer_admin", "dealer_staff"] },
  { href: "/tenders", label: "Tenders", icon: "Building2", roles: ["owner", "admin", "sales_manager"], module: "tender_management" },
  { href: "/exports", label: "Exports", icon: "Factory", roles: ["owner", "admin", "sales_manager", "dispatch_manager"], module: "export_docs" },
  { href: "/compliance", label: "Compliance", icon: "ShieldCheck", roles: ["owner", "admin", "quality"], module: "bis_compliance" },
  { href: "/profitability", label: "Profitability", icon: "TrendingUp", roles: ["owner", "admin", "accounts"], module: "profitability_intelligence" },
  { href: "/reports", label: "Reports", icon: "BarChart3", roles: ["owner", "admin", "sales_manager", "accounts"], module: "report_builder", aliases: ["/report-builder"] },
  { href: "/analytics", label: "Analytics", icon: "BarChart3", roles: ["owner", "admin", "sales_manager", "accounts"] },
  { href: "/automation", label: "Automation", icon: "WandSparkles", roles: ["owner", "admin"], module: "automation" },
  { href: "/expenses", label: "Expenses", icon: "IndianRupee", roles: ["owner", "admin", "accounts", "viewer"] },
  { href: "/invoices", label: "Invoices", icon: "FileText", roles: ["owner", "admin", "accounts", "viewer"] },
  { href: "/payments", label: "Payments", icon: "IndianRupee", roles: ["owner", "admin", "accounts", "viewer"] },
  { href: "/settings/integrations", label: "Integrations", icon: "PlugZap", roles: ["owner", "admin"], module: "accounting_integrations" },
  { href: "/settings/branding", label: "Branding", icon: "Palette", roles: ["owner", "admin"] },
  { href: "/settings/data", label: "Data Center", icon: "FileArchive", roles: ["owner", "admin"] },
  { href: "/settings/enterprise", label: "Enterprise", icon: "ShieldCheck", roles: ["owner", "admin"] },
  { href: "/settings/security", label: "Security", icon: "ShieldCheck", roles: ["owner", "admin"] },
  { href: "/settings/access", label: "Users & Roles", icon: "Users", roles: ["owner"] },
  { href: "/audit-logs", label: "Audit Logs", icon: "Activity", roles: ["owner", "admin", "viewer"] },
  { href: "/settings", label: "Settings", icon: "Settings", roles: ["owner", "admin"] }
] satisfies { href: string; label: string; icon: NavIconName; roles: UserRole[]; module?: EnterpriseModuleName; aliases?: string[] }[];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (!context.companyId) redirect("/onboarding");
  const supabase = await createClient();
  const [notificationResult, taskResult, featureFlags] = await Promise.all([
    supabase.rpc("get_unread_notification_count"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("status", ["open", "in_progress"]).or(`assigned_to.eq.${context.userId},assigned_to.is.null`),
    getFeatureFlagsForCompany(supabase, context.companyId)
  ]);
  const notificationCount = Number(notificationResult.data ?? 0);
  const taskCount = taskResult.count ?? 0;
  const searchableResources = getSearchResourceKeys(context.role);
  const searchPlaceholder = searchableResources.length
    ? `Search ${searchableResources.slice(0, 4).join(", ")}...`
    : "Search accessible records...";
  const navigation = buildTaskNavigation({
    items: nav as (typeof nav[number])[],
    role: context.role,
    featureFlags,
    hasRouteAccess,
    isFeatureEnabled,
    primaryLimit: 4
  });
  const visibleDestinations = [...navigation.primary, ...navigation.more.flatMap((group) => group.items)];
  const moduleNavigation = visibleDestinations.map(({ href, label, aliases }) => ({ href, label, aliases }));

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-neutral-950 lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-200 bg-[#f3f3f4]/95 px-2 py-2 backdrop-blur-xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-t-0 lg:px-3 lg:py-4">
        <div className="hidden items-center gap-3 rounded-3xl border border-black/[0.04] bg-white/70 p-3 shadow-sm lg:flex">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 font-black tracking-tight text-white shadow-sm">EO</div>
          <div className="min-w-0">
            <p className="truncate font-bold tracking-tight text-neutral-950">ExtrusionOS</p>
            <p className="truncate text-xs font-medium text-neutral-500">Aluminium SaaS OS</p>
          </div>
        </div>
        <div className="hidden shrink-0 px-3 py-5 lg:block">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Workspace</p>
          <p className="mt-1 text-sm font-semibold text-neutral-700">Sales, dies, production and dispatch</p>
        </div>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto lg:min-h-0 lg:flex-col lg:gap-5 lg:overflow-y-auto lg:overflow-x-hidden lg:overscroll-contain lg:pb-5">
          <TaskNavigation
            model={navigation}
            desktopShortcuts={<WorkspaceShortcuts context={context} placement="full" allowedRoutes={visibleDestinations.flatMap(({ href, aliases }) => [href, ...(aliases ?? [])])} />}
            mobileShortcuts={<WorkspaceShortcuts context={context} placement="compact" allowedRoutes={visibleDestinations.flatMap(({ href, aliases }) => [href, ...(aliases ?? [])])} />}
          />
          <div className="mt-auto hidden space-y-1 lg:block">
            <div className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm font-semibold text-neutral-400" aria-disabled="true"><span className="flex items-center gap-3"><Moon className="h-4 w-4" /> Dark mode</span><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">Unavailable</span></div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 pb-24 lg:pb-0">
        <header className="sticky top-0 z-20 flex flex-col gap-3 border-b border-neutral-200/70 bg-[#fafafa]/85 px-4 py-3 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Dashboard Overview</p>
            <p className="truncate text-lg font-bold tracking-tight text-neutral-950">{context.companyName}</p>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
            <Link href="/search" className="hidden min-w-0 max-w-xl flex-1 items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-400 shadow-sm transition hover:border-neutral-300 hover:text-neutral-700 md:flex">
              <Search className="h-4 w-4 shrink-0" /> <span className="truncate">{searchPlaceholder}</span>
            </Link>
            <Link href="/notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-300 hover:text-neutral-950">
              <Bell className="h-4 w-4" />
              {notificationCount + taskCount > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#f43f5e] ring-2 ring-white" /> : null}
            </Link>
            <div className="hidden items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-sm sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950 text-xs font-bold text-white">{(context.fullName || context.email || "U").slice(0, 1).toUpperCase()}</div>
              <div className="hidden lg:block">
                <p className="max-w-32 truncate text-xs font-bold text-neutral-950">{context.fullName || context.email}</p>
                <p className="text-[11px] font-medium capitalize text-neutral-400">{context.role.replaceAll("_", " ")}</p>
              </div>
            </div>
            <LogoutButton />
          </div>
        </header>
        <div className="min-h-[calc(100vh-73px)] bg-[#f7f7f8] p-4 lg:p-8">
          <ModuleNavigator items={moduleNavigation} />
          {children}
        </div>
      </main>
    </div>
  );
}
