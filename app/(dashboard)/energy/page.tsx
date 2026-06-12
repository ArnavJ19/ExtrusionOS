"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Flame, Plus, Save, TrendingUp, Wind, X, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";

type EnergyReading = {
  id: string;
  machine_id: string;
  reading_date: string;
  energy_type: string;
  opening_reading: number;
  closing_reading: number;
  consumption: number;
  unit: string;
  rate_per_unit: number;
  total_cost: number;
  production_kg: number;
  cost_per_kg: number;
  source_name?: string | null;
  energy_source_id?: string | null;
};

type EnergySource = {
  id: string;
  source_name: string;
  energy_type: string;
  unit: string;
  default_rate_per_unit: number;
  is_active: boolean;
};

const ENERGY_ICONS: Record<string, typeof Zap> = {
  electricity: Zap,
  grid_electricity: Zap,
  solar: Zap,
  dg_electricity: Zap,
  natural_gas: Flame,
  diesel: Flame,
  furnace_oil: Flame,
  lpg: Flame,
  compressed_air: Wind,
  other: BarChart3,
};

const ENERGY_TYPES = [
  "electricity",
  "grid_electricity",
  "solar",
  "dg_electricity",
  "natural_gas",
  "diesel",
  "furnace_oil",
  "lpg",
  "compressed_air",
  "other",
];

const defaultUnitForType = (energyType: string) => {
  if (energyType === "diesel" || energyType === "furnace_oil") return "litres";
  if (energyType === "natural_gas" || energyType === "lpg") return "cubic_m";
  if (energyType === "compressed_air") return "units";
  return "kWh";
};

const requireNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  return value;
};

export default function EnergyPage() {
  const supabase = createClient();

  const [readings, setReadings] = useState<EnergyReading[]>([]);
  const [sources, setSources] = useState<EnergySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [filterType, setFilterType] = useState("all");
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
  const [showForm, setShowForm] = useState(false);

  const [fMachine, setFMachine] = useState("");
  const [fType, setFType] = useState("electricity");
  const [fOpen, setFOpen] = useState(0);
  const [fClose, setFClose] = useState(0);
  const [fUnit, setFUnit] = useState("kWh");
  const [fProd, setFProd] = useState(0);
  const [fRate, setFRate] = useState(0);
  const [fSourceMode, setFSourceMode] = useState<"existing" | "new">("existing");
  const [fSourceId, setFSourceId] = useState("");
  const [fSourceName, setFSourceName] = useState("");

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState("electricity");
  const [newSourceUnit, setNewSourceUnit] = useState("kWh");
  const [newSourceRate, setNewSourceRate] = useState(0);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");
    let companyId = "";
    try {
      companyId = (await getCompanyId()).companyId;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not resolve company.");
      setLoading(false);
      return;
    }
    const [readingsResult, sourcesResult] = await Promise.all([
      supabase.from("energy_readings").select("*").eq("company_id", companyId).order("reading_date", { ascending: false }).limit(500),
      supabase.from("energy_sources").select("*").eq("company_id", companyId).order("source_name", { ascending: true }),
    ]);

    if (readingsResult.error) setErrorMessage(readingsResult.error.message);
    if (sourcesResult.error) setErrorMessage((prev) => prev || sourcesResult.error.message);

    const readingRows = (readingsResult.data ?? []) as any[];
    const sourceRows = (sourcesResult.data ?? []) as any[];

    setReadings(
      readingRows.map((row) => ({
        id: String(row.id),
        machine_id: String(row.machine_id ?? ""),
        reading_date: String(row.reading_date ?? ""),
        energy_type: String(row.energy_type ?? "other"),
        opening_reading: Number(row.opening_reading ?? 0),
        closing_reading: Number(row.closing_reading ?? 0),
        consumption: Number(row.consumption ?? 0),
        unit: String(row.unit ?? "kWh"),
        rate_per_unit: Number(row.rate_per_unit ?? 0),
        total_cost: Number(row.total_cost ?? 0),
        production_kg: Number(row.production_kg ?? 0),
        cost_per_kg: Number(row.cost_per_kg ?? 0),
        source_name: row.source_name ?? null,
        energy_source_id: row.energy_source_id ?? null,
      })),
    );

    setSources(
      sourceRows.map((row) => ({
        id: String(row.id),
        source_name: String(row.source_name ?? ""),
        energy_type: String(row.energy_type ?? "other"),
        unit: String(row.unit ?? "kWh"),
        default_rate_per_unit: Number(row.default_rate_per_unit ?? 0),
        is_active: Boolean(row.is_active),
      })),
    );

    if (readingRows.length) {
      const latestDate = String(readingRows[0].reading_date ?? "");
      if (latestDate) setFilterDate(latestDate);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeSourcesForType = useMemo(
    () => sources.filter((source) => source.is_active && source.energy_type === fType),
    [sources, fType],
  );

  useEffect(() => {
    setFUnit(defaultUnitForType(fType));
    if (!activeSourcesForType.length) {
      setFSourceMode("new");
      setFSourceId("");
      setFSourceName("");
      return;
    }
    if (fSourceMode === "existing") {
      const current = activeSourcesForType.find((source) => source.id === fSourceId) ?? activeSourcesForType[0];
      setFSourceId(current.id);
      setFSourceName(current.source_name);
      setFUnit(current.unit);
      if (!fRate) setFRate(current.default_rate_per_unit);
    }
  }, [fType, activeSourcesForType, fSourceId, fSourceMode, fRate]);

  const filtered = useMemo(
    () => readings.filter((reading) => (filterType === "all" || reading.energy_type === filterType) && reading.reading_date === filterDate),
    [readings, filterType, filterDate],
  );

  const totals = useMemo(() => {
    const value = filtered.reduce(
      (acc, row) => ({
        cost: acc.cost + row.total_cost,
        consumption: acc.consumption + row.consumption,
        production: acc.production + row.production_kg,
      }),
      { cost: 0, consumption: 0, production: 0 },
    );
    return {
      ...value,
      costPerKg: value.production > 0 ? value.cost / value.production : 0,
    };
  }, [filtered]);

  const byType = useMemo(() => {
    const map = new Map<string, { cost: number; consumption: number }>();
    for (const row of filtered) {
      const current = map.get(row.energy_type) ?? { cost: 0, consumption: 0 };
      current.cost += row.total_cost;
      current.consumption += row.consumption;
      map.set(row.energy_type, current);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].cost - a[1].cost);
  }, [filtered]);

  const typeFilters = useMemo(() => ["all", ...Array.from(new Set(readings.map((row) => row.energy_type)))], [readings]);

  async function getCompanyId() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error(userError?.message ?? "You must be logged in.");
    const { data: appUser, error: appUserError } = await supabase.from("app_users").select("company_id").eq("id", user.id).single();
    if (appUserError || !appUser?.company_id) throw new Error(appUserError?.message ?? "Company not found.");
    return { companyId: String(appUser.company_id), userId: String(user.id) };
  }

  const handleRateChange = async (id: string, newRate: number) => {
    setErrorMessage("");
    const row = readings.find((item) => item.id === id);
    if (!row) return;

    try {
      const safeRate = requireNonNegative(newRate, "Rate per unit");
      const totalCost = row.consumption * safeRate;
      const { companyId } = await getCompanyId();
      const { error } = await supabase
        .from("energy_readings")
        .update({
          rate_per_unit: safeRate,
          total_cost: totalCost,
          cost_per_kg: row.production_kg > 0 ? totalCost / row.production_kg : 0,
          rate_locked_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("company_id", companyId);
      if (error) throw error;
      setReadings((prev) =>
        prev.map((current) =>
          current.id === id
            ? {
                ...current,
                rate_per_unit: safeRate,
                total_cost: totalCost,
                cost_per_kg: current.production_kg > 0 ? totalCost / current.production_kg : 0,
              }
            : current,
        ),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update reading rate.");
    }
  };

  const addEnergySource = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    try {
      requireNonNegative(newSourceRate, "Default rate");
      const { companyId } = await getCompanyId();
      const payload = {
        company_id: companyId,
        source_name: newSourceName.trim(),
        energy_type: newSourceType,
        unit: newSourceUnit,
        default_rate_per_unit: newSourceRate,
        is_active: true,
      };
      const { error } = await supabase
        .from("energy_sources")
        .upsert(payload, { onConflict: "company_id,source_name" })
        .select("id")
        .single();
      if (error) throw error;
      setNewSourceName("");
      setNewSourceRate(0);
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save source.");
    }
  };

  const updateSourceRate = async (id: string, rate: number) => {
    setErrorMessage("");
    try {
      const safeRate = requireNonNegative(rate, "Default rate");
      const { companyId } = await getCompanyId();
      const { error } = await supabase.from("energy_sources").update({ default_rate_per_unit: safeRate, updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", companyId);
      if (error) throw error;
      setSources((prev) => prev.map((source) => (source.id === id ? { ...source, default_rate_per_unit: safeRate } : source)));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update source rate.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    try {
      const { companyId, userId } = await getCompanyId();

      requireNonNegative(fOpen, "Opening reading");
      requireNonNegative(fClose, "Closing reading");
      requireNonNegative(fRate, "Rate per unit");
      requireNonNegative(fProd, "Production kg");
      const consumption = fClose - fOpen;
      if (consumption < 0) throw new Error("Closing reading cannot be less than opening reading.");

      let selectedSourceId: string | null = null;
      let selectedSourceName = "";

      if (fSourceMode === "existing") {
        const source = sources.find((item) => item.id === fSourceId);
        if (!source) throw new Error("Select a valid source.");
        selectedSourceId = source.id;
        selectedSourceName = source.source_name;
      } else {
        if (!fSourceName.trim()) throw new Error("Enter source name.");
        const sourcePayload = {
          company_id: companyId,
          source_name: fSourceName.trim(),
          energy_type: fType,
          unit: fUnit,
          default_rate_per_unit: fRate,
          is_active: true,
        };
        const { data: sourceData, error: sourceError } = await supabase
          .from("energy_sources")
          .upsert(sourcePayload, { onConflict: "company_id,source_name" })
          .select("id, source_name")
          .single();
        if (sourceError || !sourceData) throw new Error(sourceError?.message ?? "Could not save source.");
        selectedSourceId = String(sourceData.id);
        selectedSourceName = String(sourceData.source_name);
      }

      const totalCost = consumption * fRate;
      const costPerKg = fProd > 0 ? totalCost / fProd : 0;

      const payload = {
        company_id: companyId,
        machine_id: fMachine.trim(),
        reading_date: filterDate,
        energy_type: fType,
        opening_reading: fOpen,
        closing_reading: fClose,
        consumption,
        unit: fUnit,
        rate_per_unit: fRate,
        total_cost: totalCost,
        production_kg: fProd,
        cost_per_kg: costPerKg,
        energy_source_id: selectedSourceId,
        source_name: selectedSourceName,
        recorded_by: userId,
        rate_locked_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("energy_readings").insert(payload);
      if (error) throw error;

      setShowForm(false);
      setFMachine("");
      setFOpen(0);
      setFClose(0);
      setFProd(0);
      setFRate(0);
      setFSourceName("");
      setFSourceId("");
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save reading.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Energy and Furnace Monitoring"
          description="Track machine-wise consumption with editable rates and multiple electricity/energy sources."
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={filterDate}
            onChange={(event) => setFilterDate(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <Button onClick={() => setShowForm(true)} className="gap-2 bg-orange text-white hover:bg-orange/90">
            <Plus className="h-4 w-4" />
            Log Reading
          </Button>
        </div>
      </div>

      {errorMessage ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{errorMessage}</div> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="Total Cost" value={`INR ${totals.cost.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} icon={Zap} />
        <Metric label="Production" value={`${totals.production.toLocaleString("en-IN")} kg`} icon={TrendingUp} />
        <Metric label="Cost / kg" value={`INR ${totals.costPerKg.toFixed(2)}`} icon={BarChart3} />
        <Metric label="Readings" value={filtered.length.toString()} icon={Flame} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardContent className="p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Cost Breakdown by Energy Type</p>
            <div className="space-y-3">
              {byType.map(([energyType, value]) => {
                const Icon = ENERGY_ICONS[energyType] ?? BarChart3;
                return (
                  <div key={energyType} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-slate-700" />
                      <span className="text-xs font-bold capitalize text-slate-800">{energyType.replace(/_/g, " ")}</span>
                    </div>
                    <span className="text-xs font-black text-slate-900">INR {value.cost.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                  </div>
                );
              })}
              {!byType.length ? <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm font-semibold text-slate-500">No data for selected date/filter.</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Energy Source Master</p>
            <form onSubmit={addEnergySource} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                value={newSourceName}
                onChange={(event) => setNewSourceName(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="New source name (Grid Meter 2)"
                required
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newSourceType}
                  onChange={(event) => {
                    setNewSourceType(event.target.value);
                    setNewSourceUnit(defaultUnitForType(event.target.value));
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold"
                >
                  {ENERGY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <select value={newSourceUnit} onChange={(event) => setNewSourceUnit(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold">
                  <option value="kWh">kWh</option>
                  <option value="litres">litres</option>
                  <option value="kg">kg</option>
                  <option value="cubic_m">cubic_m</option>
                  <option value="units">units</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newSourceRate}
                  onChange={(event) => setNewSourceRate(Number(event.target.value))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold"
                  placeholder="Rate"
                  required
                />
              </div>
              <Button type="submit" className="w-full gap-2 bg-slate-900 text-white hover:bg-slate-800">
                <Save className="h-4 w-4" />
                Save Source
              </Button>
            </form>
            <div className="max-h-[300px] space-y-2 overflow-y-auto">
              {sources.map((source) => (
                <div key={source.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-black text-slate-900">{source.source_name}</p>
                  <p className="text-[10px] font-semibold capitalize text-slate-500">{source.energy_type.replace(/_/g, " ")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={source.default_rate_per_unit}
                      onChange={(event) => updateSourceRate(source.id, Number(event.target.value))}
                      className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                    />
                    <span className="text-[10px] font-semibold text-slate-500">per {source.unit}</span>
                  </div>
                </div>
              ))}
              {!sources.length ? <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm font-semibold text-slate-500">No energy sources added.</div> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {typeFilters.map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize transition ${
              filterType === type ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {type === "all" ? "All Types" : type.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                  <th className="px-5 py-3 font-medium">Machine / Source</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Open - Close</th>
                  <th className="px-5 py-3 font-medium">Consumed</th>
                  <th className="px-5 py-3 font-medium">Rate</th>
                  <th className="px-5 py-3 font-medium">Total Cost</th>
                  <th className="px-5 py-3 font-medium">Production</th>
                  <th className="px-5 py-3 font-medium">Cost / kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => {
                  const Icon = ENERGY_ICONS[row.energy_type] ?? BarChart3;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="text-xs font-bold text-slate-900">{row.machine_id || "-"}</p>
                        <p className="text-[10px] font-semibold text-slate-500">{row.source_name || "Unspecified source"}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold capitalize text-slate-700">
                          <Icon className="h-3 w-3" />
                          {row.energy_type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs font-mono text-slate-700">
                        {row.opening_reading} - {row.closing_reading}
                      </td>
                      <td className="px-5 py-3 text-xs font-bold text-slate-900">
                        {row.consumption} {row.unit}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.rate_per_unit}
                          onChange={(event) => handleRateChange(row.id, Number(event.target.value))}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold"
                        />{" "}
                        / {row.unit}
                      </td>
                      <td className="px-5 py-3 text-xs font-black text-slate-900">INR {row.total_cost.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                      <td className="px-5 py-3 text-xs text-slate-700">{row.production_kg.toLocaleString("en-IN")} kg</td>
                      <td className="px-5 py-3 text-xs font-black text-slate-900">INR {row.cost_per_kg.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {!filtered.length && !loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-400">
                      No readings for selected date and type.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">New Reading</p>
                <p className="text-lg font-black">Log Energy Consumption</p>
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-2 transition hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Machine</label>
                  <input
                    value={fMachine}
                    onChange={(event) => setFMachine(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Press 1 (1800T)"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Energy Type</label>
                  <select
                    value={fType}
                    onChange={(event) => {
                      setFType(event.target.value);
                      setFRate(0);
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {ENERGY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFSourceMode("existing")}
                      className={`rounded-full px-3 py-1 text-xs font-bold ${fSourceMode === "existing" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
                    >
                      Existing Source
                    </button>
                    <button
                      type="button"
                      onClick={() => setFSourceMode("new")}
                      className={`rounded-full px-3 py-1 text-xs font-bold ${fSourceMode === "new" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
                    >
                      New Source
                    </button>
                  </div>
                  {fSourceMode === "existing" ? (
                    <select
                      value={fSourceId}
                      onChange={(event) => {
                        setFSourceId(event.target.value);
                        const selected = sources.find((source) => source.id === event.target.value);
                        if (selected) {
                          setFRate(selected.default_rate_per_unit);
                          setFUnit(selected.unit);
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select source</option>
                      {activeSourcesForType.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.source_name} ({source.unit})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={fSourceName}
                      onChange={(event) => setFSourceName(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      placeholder="Source name (Rooftop Solar, DG Set 2)"
                      required
                    />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Opening Reading</label>
                  <input type="number" min="0" value={fOpen} onChange={(event) => setFOpen(Number(event.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Closing Reading</label>
                  <input type="number" min="0" value={fClose} onChange={(event) => setFClose(Number(event.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Unit</label>
                  <select value={fUnit} onChange={(event) => setFUnit(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="kWh">kWh</option>
                    <option value="litres">litres</option>
                    <option value="kg">kg</option>
                    <option value="cubic_m">cubic_m</option>
                    <option value="units">units</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Rate / unit</label>
                  <input type="number" min="0" step="0.01" value={fRate} onChange={(event) => setFRate(Number(event.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">Production (kg)</label>
                  <input type="number" min="0" value={fProd} onChange={(event) => setFProd(Number(event.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
              </div>

              {fClose >= fOpen ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
                  <p>
                    Consumption: <b>{fClose - fOpen}</b> {fUnit}
                  </p>
                  <p>
                    Total Cost: <b>INR {((fClose - fOpen) * fRate).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b>
                  </p>
                  {fProd > 0 ? (
                    <p>
                      Cost / kg: <b>INR {(((fClose - fOpen) * fRate) / fProd).toFixed(2)}</b>
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  Closing reading should be greater than opening reading.
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-slate-900 text-white hover:bg-slate-800">
                  Save Reading
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Zap }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-700" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        </div>
        <p className="text-2xl font-black text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}
