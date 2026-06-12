export type CostEntry = {
  id: string;
  customer_name: string;
  profile_name: string;
  die_code: string;
  salesperson: string;
  product_category: string;
  finishing_type: string;
  branch: string;
  month_key: string;
  revenue: number;
  total_weight_kg: number;
  rate_per_kg: number;
  material_cost: number;
  conversion_cost: number;
  finishing_cost: number;
  packing_cost: number;
  transport_cost: number;
  scrap_cost: number;
  energy_cost: number;
  die_cost_allocated: number;
  overhead_cost: number;
  other_cost: number;
  payment_days: number;
  payment_status: string;
};

export type ProfitAlert = {
  id: string;
  alert_type: string;
  severity: string;
  entity_type: string;
  entity_name: string;
  description: string;
  metric_value: number;
  threshold_value: number;
  is_acknowledged: boolean;
};

export function totalCost(e: CostEntry) {
  return e.material_cost + e.conversion_cost + e.finishing_cost + e.packing_cost +
    e.transport_cost + e.scrap_cost + e.energy_cost + e.die_cost_allocated +
    e.overhead_cost + e.other_cost;
}

export function grossMargin(e: CostEntry) { return e.revenue - totalCost(e); }
export function marginPct(e: CostEntry) { return e.revenue > 0 ? (grossMargin(e) / e.revenue) * 100 : 0; }

export const DIMENSIONS = ["customer", "profile", "die", "salesperson", "category", "finishing", "branch", "month"] as const;
export type Dimension = typeof DIMENSIONS[number];

export function getDimensionKey(e: CostEntry, dim: Dimension): string {
  switch (dim) {
    case "customer": return e.customer_name;
    case "profile": return e.profile_name;
    case "die": return e.die_code;
    case "salesperson": return e.salesperson;
    case "category": return e.product_category;
    case "finishing": return e.finishing_type;
    case "branch": return e.branch;
    case "month": return e.month_key;
  }
}

export type AggRow = {
  key: string;
  revenue: number;
  totalCost: number;
  margin: number;
  marginPct: number;
  materialCost: number;
  conversionCost: number;
  finishingCost: number;
  scrapCost: number;
  energyCost: number;
  transportCost: number;
  avgPayDays: number;
  weightKg: number;
  orders: number;
};

export function aggregate(entries: CostEntry[], dim: Dimension): AggRow[] {
  const map = new Map<string, CostEntry[]>();
  entries.forEach((e) => {
    const k = getDimensionKey(e, dim);
    map.set(k, [...(map.get(k) || []), e]);
  });
  return Array.from(map.entries()).map(([key, items]) => {
    const rev = items.reduce((s, e) => s + e.revenue, 0);
    const tc = items.reduce((s, e) => s + totalCost(e), 0);
    const mg = rev - tc;
    return {
      key,
      revenue: rev,
      totalCost: tc,
      margin: mg,
      marginPct: rev > 0 ? (mg / rev) * 100 : 0,
      materialCost: items.reduce((s, e) => s + e.material_cost, 0),
      conversionCost: items.reduce((s, e) => s + e.conversion_cost, 0),
      finishingCost: items.reduce((s, e) => s + e.finishing_cost, 0),
      scrapCost: items.reduce((s, e) => s + e.scrap_cost, 0),
      energyCost: items.reduce((s, e) => s + e.energy_cost, 0),
      transportCost: items.reduce((s, e) => s + e.transport_cost, 0),
      avgPayDays: Math.round(items.reduce((s, e) => s + e.payment_days, 0) / items.length),
      weightKg: items.reduce((s, e) => s + e.total_weight_kg, 0),
      orders: items.length,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}
