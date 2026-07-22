"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NumberTicker, CompactTicker } from "@/components/ui/number-ticker";
import { formatCompactCurrency, formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import { labelize } from "@/types/app";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Info,
  ArrowRight, Factory, IndianRupee, Bell, Sparkles,
} from "lucide-react";

type Metrics = {
  monthlyQuoteValue: number; monthlyQuoteCount: number;
  monthlyOrderValue: number; monthlyOrderCount: number;
  lastMonthOrderValue: number; revenueGrowth: number;
  sentQuoteValue: number; sentQuoteCount: number;
  pendingQuoteCount: number; convertedQuoteCount: number; quoteConversionRate: number;
  activeProductionCount: number; plannedJobCount: number;
  monthlyDispatchCount: number; dispatchWeight: number;
  delayedOrderCount: number; pendingDispatchCount: number;
  totalReceivableValue: number; overdueInvoiceCount: number; monthlyPaymentValue: number;
  lowStockCount: number; totalInventoryCount: number;
  totalProduced: number; totalScrap: number; recoveryPercent: number | null;
  recoveryInputKg: number; recoveryOutputKg: number; recoveryCapturedJobCount: number; recoveryMissingJobCount: number;
  qualityHoldCount: number; totalInspected: number; failedInspections: number;
  dieCorrectionCount: number; dieInactiveCount: number;
  unreadAlertCount: number; openTaskCount: number; urgentTaskCount: number;
  activeCustomerCount: number;
};

type Insight = { text: string; severity: "info" | "warning" | "critical" | "success" };

type Props = {
  metrics: Metrics;
  delayedOrders: any[];
  overdueInvoices: any[];
  lowStockItems: any[];
  recentOrders: any[];
  plannedJobs: any[];
  alerts: any[];
  openTasks: any[];
  topCustomers: { name: string; value: number }[];
  insights: Insight[];
};

type Section = "business" | "operations" | "financial" | "insights";

export function CommandCenterClient({ metrics, delayedOrders, overdueInvoices, lowStockItems, recentOrders, plannedJobs, alerts, openTasks, topCustomers, insights }: Props) {
  const [section, setSection] = useState<Section>("business");
  const m = metrics;

  const sections: { id: Section; label: string; icon: any }[] = [
    { id: "business", label: "Business", icon: TrendingUp },
    { id: "operations", label: "Operations", icon: Factory },
    { id: "financial", label: "Financial", icon: IndianRupee },
    { id: "insights", label: "Insights", icon: Sparkles },
  ];

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HeroCard label="Booked Revenue" rawValue={m.monthlyOrderValue} sub={`${m.monthlyOrderCount} orders this month`} growth={m.revenueGrowth} dark />
        <HeroCard label="Pipeline Value" rawValue={m.monthlyQuoteValue} sub={`${m.monthlyQuoteCount} quotes generated`} />
        <HeroCard label="Receivables" rawValue={m.totalReceivableValue} sub={`${m.overdueInvoiceCount} overdue`} alert={m.overdueInvoiceCount > 0} />
        <HeroCard
          label="Recovery %"
          rawValue={m.recoveryPercent}
          isPercent
          emptyLabel="Not captured"
          sub={m.recoveryMissingJobCount > 0
            ? `${m.recoveryMissingJobCount} completed job(s) missing issued billet input`
            : m.recoveryCapturedJobCount > 0
              ? `${formatWeight(m.recoveryOutputKg)} output from ${formatWeight(m.recoveryInputKg)} issued billet`
              : "No completed jobs this month"}
          alert={m.recoveryPercent !== null && m.recoveryPercent < 85}
        />
      </div>

      {/* Attention Banner */}
      <Card className="border-orange/30 bg-gradient-to-br from-charcoal to-graphite text-white shadow-premium">
        <CardContent>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Command Center</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-white">What needs attention today</h2>
            </div>
            <Link href="/reports" className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-black text-white transition hover:border-orange hover:text-orange">
              Open Reports
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <AttentionTile label="Delayed Orders" value={m.delayedOrderCount} href="/orders" tone={m.delayedOrderCount > 0 ? "critical" : "ok"} />
            <AttentionTile label="Low Stock" value={m.lowStockCount} href="/inventory" tone={m.lowStockCount > 3 ? "critical" : m.lowStockCount > 0 ? "warning" : "ok"} />
            <AttentionTile label="QC Holds" value={m.qualityHoldCount} href="/quality" tone={m.qualityHoldCount > 0 ? "critical" : "ok"} />
            <AttentionTile label="Die Correction" value={m.dieCorrectionCount} href="/dies" tone={m.dieCorrectionCount > 0 ? "warning" : "ok"} />
            <AttentionTile label="Overdue Invoices" value={m.overdueInvoiceCount} href="/payments" tone={m.overdueInvoiceCount > 0 ? "critical" : "ok"} />
            <AttentionTile label="Urgent Tasks" value={m.urgentTaskCount} href="/settings/enterprise" tone={m.urgentTaskCount > 0 ? "warning" : "ok"} />
          </div>
        </CardContent>
      </Card>

      {/* Section Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-4 overflow-x-auto">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.id} onClick={() => setSection(s.id)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 py-3 px-1 text-sm font-bold transition-colors ${section === s.id ? "border-orange text-orange" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>
                <Icon className="h-4 w-4" /> {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Business */}
      {section === "business" && (
        <div className="animate-in fade-in space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label="Pending Quotes" rawValue={m.pendingQuoteCount} />
            <MiniMetric label="Sent (Awaiting)" rawValue={m.sentQuoteCount} sub={formatCompactCurrency(m.sentQuoteValue)} />
            <MiniMetric label="Conversion Rate" rawValue={m.quoteConversionRate} isPercent />
            <MiniMetric label="Active Customers" rawValue={m.activeCustomerCount} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardContent>
                <SectionHeader title="Recent Orders" href="/orders" />
                <div className="space-y-2">
                  {recentOrders.length > 0 ? recentOrders.map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="min-w-0">
                        <Link href={`/orders/${o.id}`} className="font-black text-slate-950 hover:text-orange hover:underline">{o.order_number}</Link>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{o.customers?.company_name || o.customers?.customer_name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge value={o.current_stage} />
                        <p className="mt-1 text-sm font-black text-slate-950">{formatCurrency(o.order_value)}</p>
                      </div>
                    </div>
                  )) : <div className="empty-mini">No orders yet.</div>}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <SectionHeader title="Top Customers This Month" href="/customers" />
                {topCustomers.length > 0 ? (
                  <div className="space-y-2">
                    {topCustomers.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange/10 text-sm font-black text-orange">#{i + 1}</span>
                          <p className="font-bold text-slate-900">{c.name}</p>
                        </div>
                        <p className="font-black text-slate-950">{formatCompactCurrency(c.value)}</p>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-mini">No customer order data this month.</div>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Operations */}
      {section === "operations" && (
        <div className="animate-in fade-in space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label="In Production" rawValue={m.activeProductionCount} />
            <MiniMetric label="Planned Jobs" rawValue={m.plannedJobCount} />
            <MiniMetric label="Dispatched" rawValue={m.monthlyDispatchCount} sub={formatWeight(m.dispatchWeight)} />
            <MiniMetric label="Scrap This Month" rawValue={m.totalScrap} suffix=" kg" />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {delayedOrders.length > 0 && (
              <Card className="border-red-200 bg-gradient-to-br from-white to-red-50">
                <CardContent>
                  <h3 className="mb-3 text-lg font-black text-red-700">Delayed Orders</h3>
                  <div className="space-y-2">
                    {delayedOrders.map((o: any) => (
                      <div key={o.id} className="flex items-center justify-between rounded-xl border border-red-100 bg-white p-3">
                        <div>
                          <Link href={`/orders/${o.id}`} className="font-bold text-slate-900 hover:underline">{o.order_number}</Link>
                          <p className="text-xs text-slate-500">{o.customers?.company_name || o.customers?.customer_name}</p>
                        </div>
                        <p className="text-xs font-bold text-red-600">Due {formatDate(o.expected_dispatch_date)}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent>
                <SectionHeader title="Upcoming Production Jobs" href="/production" />
                {plannedJobs.length > 0 ? (
                  <div className="space-y-2">
                    {plannedJobs.map((j: any) => (
                      <div key={j.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div>
                          <p className="font-bold text-slate-900">{j.job_number}</p>
                          <p className="text-xs text-slate-500">{formatWeight(j.planned_quantity_kg)} planned · {formatDate(j.planned_date)}</p>
                        </div>
                        <Badge value={j.status} />
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-mini">No planned production jobs.</div>}
              </CardContent>
            </Card>
            {lowStockItems.length > 0 && (
              <Card className="border-amber-200 bg-gradient-to-br from-white to-amber-50 xl:col-span-2">
                <CardContent>
                  <SectionHeader title="Low Inventory Watchlist" href="/inventory" />
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {lowStockItems.map((item: any) => (
                      <div key={item.id} className="rounded-xl border border-amber-200 bg-white p-3">
                        <p className="truncate text-sm font-black text-slate-900">{item.item_code}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{item.item_name}</p>
                        <p className="mt-2 text-xs font-black text-amber-700">{Number(item.current_stock ?? 0).toLocaleString("en-IN")} {item.unit} / reorder {Number(item.reorder_level ?? 0).toLocaleString("en-IN")}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Financial */}
      {section === "financial" && (
        <div className="animate-in fade-in space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label="Total Receivables" rawValue={m.totalReceivableValue} isCurrency />
            <MiniMetric label="Payments Received" rawValue={m.monthlyPaymentValue} isCurrency sub="This month" />
            <MiniMetric label="Overdue Invoices" rawValue={m.overdueInvoiceCount} alert={m.overdueInvoiceCount > 0} />
            <MiniMetric label="Pending Dispatch" rawValue={m.pendingDispatchCount} />
          </div>
          <Card>
            <CardContent>
              <SectionHeader title="Overdue Invoices" href="/payments" />
              {overdueInvoices.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table">
                    <thead><tr><th>Invoice</th><th>Customer</th><th>Amount Due</th><th>Due Date</th><th>Status</th></tr></thead>
                    <tbody>
                      {overdueInvoices.map((inv: any) => (
                        <tr key={inv.id}>
                          <td className="font-bold">{inv.invoice_number || `#${inv.id.slice(0, 8)}`}</td>
                          <td>{inv.customers?.company_name || inv.customers?.customer_name || "—"}</td>
                          <td className="font-black text-red-700">{formatCurrency(inv.balance_due)}</td>
                          <td className="text-red-600">{formatDate(inv.due_date)}</td>
                          <td><Badge value={inv.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty-mini">No overdue invoices. All payments on track.</div>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Insights */}
      {section === "insights" && (
        <div className="animate-in fade-in space-y-6">
          <Card className="border-orange/20 bg-gradient-to-br from-orange/5 via-white to-white">
            <CardContent>
              <div className="mb-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">AI / Rule-Based Insights</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Business Intelligence</h2>
                <p className="mt-1 text-sm text-slate-500">Automated observations from your data this month.</p>
              </div>
              {insights.length > 0 ? (
                <div className="space-y-3">
                  {insights.map((insight, i) => (
                    <InsightCard key={i} text={insight.text} severity={insight.severity} />
                  ))}
                </div>
              ) : <div className="empty-mini">Not enough data to generate insights yet.</div>}
            </CardContent>
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardContent>
                <SectionHeader title="Unread Alerts" href="/settings/enterprise" />
                {alerts.length > 0 ? (
                  <div className="space-y-2">
                    {alerts.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-orange" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900">{a.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{labelize(a.severity)} · {formatDate(a.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-mini">No unread alerts.</div>}
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <SectionHeader title="Open Tasks" href="/settings/enterprise" />
                {openTasks.length > 0 ? (
                  <div className="space-y-2">
                    {openTasks.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900">{t.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{labelize(t.task_type)} · Due {formatDate(t.due_date)}</p>
                        </div>
                        <Badge value={t.priority} />
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-mini">No open tasks.</div>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function HeroCard({ label, rawValue, sub, growth, dark, alert, isPercent, emptyLabel = "—" }: { label: string; rawValue: number | null; sub: string; growth?: number; dark?: boolean; alert?: boolean; isPercent?: boolean; emptyLabel?: string }) {
  const base = dark
    ? "bg-charcoal text-white shadow-premium"
    : alert
    ? "border-red-200 bg-gradient-to-br from-white to-red-50"
    : "border-slate-200/80 bg-gradient-to-br from-white via-aluminium/50 to-white";
  return (
    <div className={`metric-card ${base}`}>
      <p className={`relative z-[1] text-xs font-black uppercase tracking-[0.14em] ${dark ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <p className={`relative z-[1] mt-3 text-3xl font-black tracking-tight ${dark ? "text-white" : alert ? "text-red-700" : "text-slate-950"}`}>
        {isPercent
          ? (rawValue !== null ? <NumberTicker value={rawValue} decimals={1} suffix="%" duration={1000} /> : emptyLabel)
          : <CompactTicker value={rawValue ?? 0} duration={1000} />
        }
      </p>
      <div className="relative z-[1] mt-2 flex items-center gap-2">
        <p className={`text-sm font-medium ${dark ? "text-slate-300" : "text-slate-500"}`}>{sub}</p>
        {growth !== undefined && growth !== 0 && (
          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-black ${growth > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {growth > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(growth).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, rawValue, sub, alert, isCurrency, isPercent, suffix }: { label: string; rawValue: number; sub?: string; alert?: boolean; isCurrency?: boolean; isPercent?: boolean; suffix?: string }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${alert ? "border-red-200 bg-red-50" : "border-slate-200/80 bg-white"}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black tracking-tight ${alert ? "text-red-700" : "text-slate-950"}`}>
        {isCurrency
          ? <CompactTicker value={rawValue} duration={800} />
          : isPercent
          ? <NumberTicker value={rawValue} decimals={0} suffix="%" />
          : <NumberTicker value={rawValue} suffix={suffix} />
        }
      </p>
      {sub && <p className="mt-1 text-xs font-medium text-slate-500">{sub}</p>}
    </div>
  );
}

function AttentionTile({ label, value, href, tone }: { label: string; value: number; href: string; tone: "critical" | "warning" | "ok" }) {
  const cls = tone === "critical" ? "border-red-400/40 bg-red-500/15 text-red-100" : tone === "warning" ? "border-orange/40 bg-orange/15 text-orange-100" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  return (
    <Link href={href} className={`rounded-2xl border p-4 transition hover:border-orange ${cls}`}>
      <p className="text-xs font-black uppercase tracking-[0.12em] opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-black"><NumberTicker value={value} duration={600} /></p>
    </Link>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="section-title">{title}</h3>
      <Link href={href} className="inline-flex items-center gap-1 text-xs font-bold text-orange hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>
    </div>
  );
}

function InsightCard({ text, severity }: { text: string; severity: "info" | "warning" | "critical" | "success" }) {
  const icons = { info: Info, warning: AlertTriangle, critical: AlertTriangle, success: CheckCircle };
  const colors = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    critical: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  const iconColors = { info: "text-blue-500", warning: "text-amber-500", critical: "text-red-500", success: "text-emerald-500" };
  const Icon = icons[severity];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${colors[severity]}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColors[severity]}`} />
      <p className="text-sm font-semibold leading-relaxed">{text}</p>
    </div>
  );
}
