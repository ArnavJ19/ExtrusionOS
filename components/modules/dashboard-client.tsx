"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, CalendarDays, Check, ChevronDown, CircleDollarSign, Factory, FileText, PackageCheck, Truck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NumberTicker, CompactTicker } from "@/components/ui/number-ticker";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DashboardView } from "@/lib/auth/role-experience";

export function DashboardTabs({
  allowedViews,
  initialView,
  operationalResources,
  operationsHref,
  quoteRows,
  orderRows,
  monthlyQuoteValue,
  monthlyOrderValue,
  productionCount,
  pendingDispatchCount,
  delayedOrders,
  activeCustomerCount,
  monthlyQuoteCount,
  monthlyOrderCount,
  dispatchCount,
  dieCorrectionCount,
  lowInventoryRows = [],
  qualityHoldCount = 0,
  todayJobCount = 0,
  pendingQuoteCount = 0
}: any) {
  const [activeTab, setActiveTab] = useState<DashboardView>(initialView);
  const attentionTotal = delayedOrders.length + lowInventoryRows.length + qualityHoldCount + pendingQuoteCount + dieCorrectionCount;
  const totalStatus = Math.max(productionCount + pendingDispatchCount + dispatchCount + delayedOrders.length, 1);

  const allTabs: { id: DashboardView; label: string }[] = [
    { id: "owner", label: "Owner View" },
    { id: "sales", label: "Sales Pipeline" },
    { id: "operations", label: "Operations" }
  ];
  const tabs = allTabs.filter((tab) => allowedViews.includes(tab.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[24px] border border-[#eaeaea] bg-white p-4 shadow-[0_18px_45px_rgba(17,17,17,0.035)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-neutral-950">Good morning</h2>
          <p className="mt-1 text-sm font-medium text-neutral-500">A clean operating snapshot across quotation, production, dispatch and inventory.</p>
        </div>
        {tabs.length > 1 ? <div className="flex rounded-2xl border border-neutral-200 bg-neutral-50 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-xl px-3.5 py-2 text-xs font-semibold text-neutral-500 transition-all duration-200 hover:text-neutral-950 sm:text-sm",
                activeTab === tab.id && "bg-white text-neutral-950 shadow-sm ring-1 ring-black/[0.04]"
              )}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div> : null}
      </div>

      {activeTab === "operations" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {operationalResources.includes("production") ? <StatCard icon={Factory} label="Floor Load" rawValue={productionCount} change="Live" comparison="Orders in active production stages" tone="blue" /> : null}
          {operationalResources.includes("dispatches") ? <StatCard icon={Truck} label="Dispatch Queue" rawValue={pendingDispatchCount} change={dispatchCount ? `${dispatchCount} moved` : "No movement"} comparison="Orders still pending movement" tone="yellow" /> : null}
          {operationalResources.includes("quality") ? <StatCard icon={Check} label="Quality Holds" rawValue={qualityHoldCount} change={qualityHoldCount ? "Review" : "Clear"} comparison="Rejected or rework inspections" tone="purple" /> : null}
          {operationalResources.includes("inventory") ? <StatCard icon={Boxes} label="Low Stock" rawValue={lowInventoryRows.length} change={lowInventoryRows.length ? "Reorder" : "Healthy"} comparison="Items at or below reorder level" tone="green" /> : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={CircleDollarSign} label="Booked Revenue" rawValue={monthlyOrderValue} isCurrency change={monthlyOrderCount ? `${monthlyOrderCount} orders` : "No orders"} comparison={`${activeCustomerCount} active buying customers`} tone="green" />
          <StatCard icon={FileText} label="Pipeline Value" rawValue={monthlyQuoteValue} isCurrency change={monthlyQuoteCount ? `${monthlyQuoteCount} quotes` : "No quotes"} comparison={`${monthlyQuoteCount} quotes created`} tone="purple" />
          <StatCard icon={Factory} label={activeTab === "sales" ? "Orders Converted" : "Floor Load"} rawValue={activeTab === "sales" ? monthlyOrderCount : productionCount} change={activeTab === "sales" ? "This month" : "Live"} comparison={activeTab === "sales" ? "Confirmed customer orders" : "Jobs in production"} tone="blue" />
          <StatCard icon={activeTab === "sales" ? FileText : Truck} label={activeTab === "sales" ? "Quotes Pending" : "Dispatch Ready"} rawValue={activeTab === "sales" ? pendingQuoteCount : pendingDispatchCount} change={activeTab === "sales" ? "Follow up" : dispatchCount ? `+${dispatchCount}` : "0"} comparison={activeTab === "sales" ? "Open commercial follow-ups" : "Moved this month"} tone="yellow" />
        </div>
      )}

      {activeTab === "owner" ? (
        <div className="animate-in fade-in space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
            <Card>
              <CardContent>
                <SectionHeading title="Overview / Analytics" action="This Year" />
                <div className="mt-7 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-5xl font-bold tracking-tight text-neutral-950"><NumberTicker value={monthlyQuoteCount + monthlyOrderCount + dispatchCount} duration={1000} /></p>
                    <p className="mt-3 text-sm font-medium text-neutral-500">Current quote, order, and dispatch activity</p>
                  </div>
                  <div className="grid flex-1 gap-5 md:grid-cols-3">
                    <ActivityGrid title="Quotes" active={monthlyQuoteCount} />
                    <ActivityGrid title="Orders" active={monthlyOrderCount} />
                    <ActivityGrid title="Dispatch" active={dispatchCount} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <SectionHeading title="Status Breakdown" action="This Month" />
                <div className="mt-6 grid gap-6 sm:grid-cols-[190px_1fr] sm:items-center">
                  <DonutChart total={productionCount + pendingDispatchCount + dispatchCount + delayedOrders.length} segments={[productionCount, pendingDispatchCount, dispatchCount, delayedOrders.length]} />
                  <div className="space-y-4">
                    <ProgressItem icon={Factory} label="In production" value={productionCount} total={totalStatus} color="bg-[#8b5cf6]" />
                    <ProgressItem icon={Truck} label="Pending dispatch" value={pendingDispatchCount} total={totalStatus} color="bg-[#eab308]" />
                    <ProgressItem icon={PackageCheck} label="Dispatched" value={dispatchCount} total={totalStatus} color="bg-[#60a5fa]" />
                    <ProgressItem icon={CalendarDays} label="Delayed" value={delayedOrders.length} total={totalStatus} color="bg-neutral-950" />
                    <Link href="/reports" className="mt-2 inline-flex w-full items-center justify-center rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800">View all</Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.25fr_1fr]">
            <Card>
              <CardContent>
                <SectionHeading title="Tasks / Approvals" />
                <div className="mt-5 space-y-3">
                  <TaskCard title="Delayed orders" value={delayedOrders.length} href="/orders" tone={delayedOrders.length ? "critical" : "ok"} />
                  <TaskCard title="Pending quotes" value={pendingQuoteCount} href="/quotes" tone={pendingQuoteCount ? "warning" : "ok"} />
                  <TaskCard title="QC holds" value={qualityHoldCount} href="/quality" tone={qualityHoldCount ? "critical" : "ok"} />
                  <TaskCard title="Die correction" value={dieCorrectionCount} href="/dies" tone={dieCorrectionCount ? "warning" : "ok"} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <SectionHeading title="Recent Activity" href="/orders" />
                <div className="mt-5 space-y-3">
                  {orderRows.length ? orderRows.slice(0, 5).map((order: any) => (
                    <Link key={order.id} href={`/orders/${order.id}`} className="group flex items-center justify-between gap-4 rounded-2xl border border-neutral-100 bg-white p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-950 group-hover:underline">{order.order_number}</p>
                        <p className="mt-1 truncate text-xs font-medium text-neutral-500">{order.customers?.company_name || order.customers?.customer_name || "Customer"} · Dispatch {formatDate(order.expected_dispatch_date)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge value={order.current_stage} />
                        <p className="mt-2 text-sm font-bold text-neutral-950">{formatCurrency(order.order_value)}</p>
                      </div>
                    </Link>
                  )) : <div className="empty-mini">No recent orders yet.</div>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <SectionHeading title="Upcoming Events" href="/production" />
                <div className="mt-5 space-y-4">
                  <EventItem time="Today" title="Production jobs" meta={`${todayJobCount} active floor jobs`} accent="bg-[#8b5cf6]" />
                  <EventItem time="This week" title="Dispatch follow-up" meta={`${pendingDispatchCount} orders pending movement`} accent="bg-[#60a5fa]" />
                  <EventItem time="Toolroom" title="Die correction" meta={`${dieCorrectionCount} dies need attention`} accent="bg-neutral-950" />
                  <EventItem time="Inventory" title="Low stock review" meta={`${lowInventoryRows.length} items below reorder`} accent="bg-[#eab308]" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === "sales" ? (
        <div className="animate-in fade-in grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardContent>
              <SectionHeading title="Sales Pipeline" href="/quotes" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <MiniMetric label="Quotes generated" value={monthlyQuoteCount} />
                <MiniMetric label="Orders converted" value={monthlyOrderCount} />
                <MiniMetric label="Quoted value" value={formatCompactCurrency(monthlyQuoteValue)} />
                <MiniMetric label="Booked value" value={formatCompactCurrency(monthlyOrderValue)} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <SectionHeading title="Recent Quotes" href="/quotes" />
              <div className="mt-5 space-y-3">
                {quoteRows.length ? quoteRows.map((quote: any) => (
                  <Link key={quote.id} href={`/quotes/${quote.id}`} className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-100 p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-950">{quote.quote_number}</p>
                      <p className="mt-1 truncate text-xs font-medium text-neutral-500">{quote.customers?.company_name || quote.customers?.customer_name || "Customer"} · {formatDate(quote.quote_date)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge value={quote.status} />
                      <p className="mt-2 text-sm font-bold text-neutral-950">{formatCurrency(quote.grand_total)}</p>
                    </div>
                  </Link>
                )) : <div className="empty-mini">No quotations yet. Create a quote to start building sales pipeline.</div>}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "operations" ? (
        <div className="animate-in fade-in grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardContent>
              <SectionHeading title="Operations Snapshot" href={operationsHref} />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {operationalResources.includes("production") ? <MiniMetric label="In production" value={productionCount} /> : null}
                {operationalResources.includes("dispatches") ? <MiniMetric label="Pending dispatch" value={pendingDispatchCount} /> : null}
                {operationalResources.includes("production") ? <MiniMetric label="Today's jobs" value={todayJobCount} /> : null}
                <MiniMetric label="Attention items" value={attentionTotal} />
              </div>
            </CardContent>
          </Card>
          {operationalResources.includes("inventory") ? <Card>
            <CardContent>
              <SectionHeading title="Low Inventory Watchlist" href="/inventory" />
              <div className="mt-5 space-y-3">
                {lowInventoryRows.length ? lowInventoryRows.map((item: any) => (
                  <div key={item.id} className="rounded-2xl border border-neutral-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-950">{item.item_code}</p>
                        <p className="mt-1 truncate text-xs font-medium text-neutral-500">{item.item_name}</p>
                      </div>
                      <Boxes className="h-4 w-4 text-neutral-400" />
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-neutral-100">
                      <div className="h-full max-w-full rounded-full bg-[#f43f5e]" style={{ width: `${Math.min(100, Math.max(8, (Number(item.current_stock ?? 0) / Math.max(Number(item.reorder_level ?? 1), 1)) * 100))}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-semibold text-neutral-500">{Number(item.current_stock ?? 0).toLocaleString("en-IN")} {item.unit} / reorder {Number(item.reorder_level ?? 0).toLocaleString("en-IN")}</p>
                  </div>
                )) : <div className="empty-mini">No low inventory items right now.</div>}
              </div>
            </CardContent>
          </Card> : null}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ icon: Icon, label, rawValue, isCurrency, change, comparison, tone }: { icon: any; label: string; rawValue: number; isCurrency?: boolean; change: string; comparison: string; tone: "green" | "purple" | "blue" | "yellow" }) {
  const toneClass = {
    green: "bg-emerald-50 text-emerald-600",
    purple: "bg-violet-50 text-violet-600",
    blue: "bg-sky-50 text-sky-600",
    yellow: "bg-yellow-50 text-yellow-600"
  }[tone];

  return (
    <div className="group rounded-[20px] border border-[#eaeaea] bg-white p-5 shadow-[0_18px_45px_rgba(17,17,17,0.035)] transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_22px_50px_rgba(17,17,17,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-neutral-100 bg-neutral-50 text-neutral-500"><Icon className="h-4 w-4" /></span>
          <p className="text-sm font-semibold text-neutral-800">{label}</p>
        </div>
        <ChevronDown className="h-4 w-4 text-neutral-300" />
      </div>
      <div className="mt-8 flex items-end gap-3">
        <p className="text-4xl font-bold tracking-tight text-neutral-950">{isCurrency ? <CompactTicker value={rawValue} duration={1000} /> : <NumberTicker value={rawValue} duration={1000} />}</p>
        <span className={cn("mb-1 rounded-full px-2 py-1 text-[11px] font-bold", toneClass)}>{change}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-neutral-500">{comparison}</p>
    </div>
  );
}

function SectionHeading({ title, action, href }: { title: string; action?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="text-base font-bold tracking-tight text-neutral-950">{title}</h3>
      {href ? <Link href={href} className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50">View all <ArrowRight className="h-3.5 w-3.5" /></Link> : null}
      {action ? <span className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700">{action}</span> : null}
    </div>
  );
}

function ActivityGrid({ title, active }: { title: string; active: number }) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-neutral-700">{title}</p>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 28 }).map((_, index) => (
          <span key={index} className={cn("h-4 rounded-md bg-neutral-100", index < Math.min(active, 28) && (index % 5 === 0 ? "bg-[#60a5fa]" : "bg-[#8b5cf6]"))} />
        ))}
      </div>
    </div>
  );
}

function DonutChart({ total, segments }: { total: number; segments: number[] }) {
  const safeTotal = Math.max(total, 1);
  const colors = ["#8b5cf6", "#eab308", "#60a5fa", "#111111"];
  const gradient = segments.reduce<{ cursor: number; stops: string[] }>((acc, value, index) => {
    const start = acc.cursor;
    const end = start + (value / safeTotal) * 100;
    return { cursor: end, stops: [...acc.stops, `${colors[index]} ${start}% ${end}%`] };
  }, { cursor: 0, stops: [] }).stops.join(", ");

  return (
    <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-full" style={{ background: `conic-gradient(${gradient || "#eeeeee 0% 100%"})` }}>
      <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-white shadow-inner">
        <p className="text-xs font-semibold text-neutral-400">Total</p>
        <p className="text-4xl font-bold tracking-tight text-neutral-950"><NumberTicker value={total} duration={800} /></p>
      </div>
    </div>
  );
}

function ProgressItem({ icon: Icon, label, value, total, color }: { icon: any; label: string; value: number; total: number; color: string }) {
  return (
    <div className="grid grid-cols-[32px_1fr_auto] items-center gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-50 text-neutral-500 ring-1 ring-neutral-100"><Icon className="h-4 w-4" /></span>
      <div>
        <div className="h-2 rounded-full bg-neutral-100"><div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.round((value / Math.max(total, 1)) * 100))}%` }} /></div>
        <p className="mt-1 text-xs font-medium text-neutral-500">{label}</p>
      </div>
      <p className="text-sm font-bold text-neutral-950"><NumberTicker value={value} duration={600} /></p>
    </div>
  );
}

function TaskCard({ title, value, href, tone }: { title: string; value: number; href: string; tone: "critical" | "warning" | "ok" }) {
  const accent = tone === "critical" ? "text-[#f43f5e] bg-rose-50" : tone === "warning" ? "text-[#eab308] bg-yellow-50" : "text-[#22c55e] bg-emerald-50";
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-100 p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl", accent)}>{tone === "ok" ? <Check className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}</span>
        <div>
          <p className="text-sm font-semibold text-neutral-950">{title}</p>
          <p className="text-xs font-medium text-neutral-500">Needs review</p>
        </div>
      </div>
      <p className="text-xl font-bold text-neutral-950"><NumberTicker value={value} duration={600} /></p>
    </Link>
  );
}

function EventItem({ time, title, meta, accent }: { time: string; title: string; meta: string; accent: string }) {
  return (
    <div className="relative rounded-2xl border border-neutral-100 bg-white p-4 pl-5 transition hover:border-neutral-200 hover:bg-neutral-50">
      <span className={cn("absolute left-0 top-4 h-10 w-1 rounded-r-full", accent)} />
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{time}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-950">{title}</p>
      <p className="mt-1 text-xs font-medium text-neutral-500">{meta}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  const isNumeric = typeof value === "number";
  return (
    <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-neutral-950">{isNumeric ? <NumberTicker value={value} /> : value}</p>
    </div>
  );
}
