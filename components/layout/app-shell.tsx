import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Moon } from "lucide-react";
import { GlobalFind } from "@/components/search/global-find";
import { DensityControl } from "./density-control";
import { SuggestImprovementLink } from "@/components/layout/suggest-improvement";
import { canUseImprovementAction } from "@/lib/workflow/improvement";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { LogoutButton } from "./logout-button";
import { ModuleNavigator } from "./module-navigator";
import { TaskNavigation } from "./task-navigation";
import { WorkspaceShortcuts } from "./workspace-shortcuts";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { getSearchResourceKeys } from "@/lib/auth/role-experience";
import { buildTaskNavigation } from "@/lib/navigation/task-navigation";
import { APP_DESTINATIONS } from "@/lib/navigation/app-destinations";
import { NavVisitBeacon } from "./nav-visit-beacon";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const context = await getSessionContext();
  if (!context.companyId) redirect("/onboarding");
  const supabase = await createClient();
  const [notificationResult, taskResult, featureFlags, layoutResult] = await Promise.all([
    supabase.rpc("get_unread_notification_count"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).in("status", ["open", "in_progress"]).or(`assigned_to.eq.${context.userId},assigned_to.is.null`),
    getFeatureFlagsForCompany(supabase, context.companyId),
    // AP-042: the role navigation an admin approved; without one (or before the upgrade) the standard list is used.
    supabase.rpc("ap_navigation", { p_command: "layout", p_payload: {} })
  ]);
  const approvedItems = Array.isArray(layoutResult.data?.items) ? (layoutResult.data.items as unknown[]).filter((item): item is string => typeof item === "string") : null;
  const notificationCount = Number(notificationResult.data ?? 0);
  const taskCount = taskResult.count ?? 0;
  const searchableResources = getSearchResourceKeys(context.role);
  const searchPlaceholder = searchableResources.length
    ? `Search ${searchableResources.slice(0, 4).join(", ")}...`
    : "Search accessible records...";
  const navigation = buildTaskNavigation({
    items: [...APP_DESTINATIONS],
    role: context.role,
    featureFlags,
    hasRouteAccess,
    isFeatureEnabled,
    primaryLimit: 4,
    approvedItems
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
            <GlobalFind placeholder={searchPlaceholder} />
            <DensityControl scope={{ companyId: context.companyId, userId: context.userId }} />
            {!context.dealerId && canUseImprovementAction(context.role, "suggestion.submit") ? <SuggestImprovementLink /> : null}
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
          <NavVisitBeacon destinations={moduleNavigation} />
          {children}
        </div>
      </main>
    </div>
  );
}
