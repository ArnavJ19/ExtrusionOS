"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar, CircleDot, Clock, DollarSign, Plus, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { maintenanceBillUploadRules, validateUploadFile } from "@/lib/validations/uploads";

type Schedule = {
  id: string;
  machine_id: string;
  machine_type: string;
  maintenance_type: string;
  description: string | null;
  frequency_type: string;
  next_due_date: string;
  assigned_to: string | null;
  status: string;
};

type SparePart = {
  id: string;
  part_code: string;
  part_name: string;
  machine_type: string | null;
  unit: string;
  current_stock: number;
  reorder_level: number;
  average_rate: number;
  location: string | null;
};

type SpareUsage = {
  id: string;
  breakdown_id: string;
  spare_part_id: string;
  quantity_used: number;
  amount: number;
  part_code: string;
  part_name: string;
  unit: string;
};

type Breakdown = {
  id: string;
  machine_id: string;
  machine_type: string;
  breakdown_date: string;
  start_time: string | null;
  end_time: string | null;
  downtime_minutes: number;
  issue_description: string;
  root_cause: string | null;
  action_taken: string | null;
  spare_parts_used: string | null;
  cost: number;
  status: string;
  reported_by: string | null;
  resolved_by: string | null;
  vendor_name: string | null;
  bill_number: string | null;
  bill_storage_bucket: string | null;
  bill_storage_path: string | null;
  bill_file_url: string | null;
  usage: SpareUsage[];
};

const MACHINE_LABELS: Record<string, string> = {
  extrusion_press: "Extrusion Press",
  billet_heater: "Billet Heater",
  aging_oven: "Aging Oven",
  puller: "Puller",
  stretcher: "Stretcher",
  cutting_machine: "Cutting Machine",
  powder_coating_line: "Powder Coating",
  anodizing_line: "Anodizing Line",
  compressor: "Compressor",
  packing_equipment: "Packing Equipment",
  other: "Other",
};

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-700",
  open: "bg-red-100 text-red-800",
  resolved: "bg-green-100 text-green-800",
  recurring: "bg-purple-100 text-purple-800",
};

export default function MaintenancePage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [tab, setTab] = useState<"schedules" | "breakdowns" | "spares">("schedules");
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"schedule" | "breakdown">("schedule");
  const [selectedBreakdown, setSelectedBreakdown] = useState<Breakdown | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [breakdowns, setBreakdowns] = useState<Breakdown[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);

  const [fMachine, setFMachine] = useState("");
  const [fMachineType, setFMachineType] = useState("extrusion_press");
  const [fMaintenanceType, setFMaintenanceType] = useState("preventive");
  const [fDescription, setFDescription] = useState("");
  const [fFrequency, setFFrequency] = useState("monthly");
  const [fDueDate, setFDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [fAssignedTo, setFAssignedTo] = useState("");

  const [bIssue, setBIssue] = useState("");
  const [bRootCause, setBRootCause] = useState("");
  const [bActionTaken, setBActionTaken] = useState("");
  const [bCost, setBCost] = useState(0);
  const [bVendor, setBVendor] = useState("");
  const [bBillNumber, setBBillNumber] = useState("");
  const [bBillFile, setBBillFile] = useState<File | null>(null);
  const [bSparePartId, setBSparePartId] = useState("");
  const [bSpareQty, setBSpareQty] = useState(0);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage("");

    const [schedulesResult, breakdownsResult, sparePartsResult, usageResult] = await Promise.all([
      supabase.from("maintenance_schedules").select("*").order("next_due_date", { ascending: true }).limit(300),
      supabase.from("breakdown_logs").select("*").order("breakdown_date", { ascending: false }).limit(300),
      supabase.from("maintenance_spare_parts").select("*").order("part_name", { ascending: true }).limit(300),
      supabase.from("breakdown_spare_part_usage").select("id, breakdown_id, spare_part_id, quantity_used, amount, maintenance_spare_parts(part_code, part_name, unit)").order("created_at", { ascending: false }).limit(1000),
    ]);

    if (schedulesResult.error) setErrorMessage(schedulesResult.error.message);
    if (breakdownsResult.error) setErrorMessage((prev) => prev || breakdownsResult.error.message);
    if (sparePartsResult.error) setErrorMessage((prev) => prev || sparePartsResult.error.message);
    if (usageResult.error) setErrorMessage((prev) => prev || usageResult.error.message);

    const usageByBreakdown = new Map<string, SpareUsage[]>();
    for (const raw of (usageResult.data ?? []) as any[]) {
      const usage: SpareUsage = {
        id: String(raw.id),
        breakdown_id: String(raw.breakdown_id),
        spare_part_id: String(raw.spare_part_id),
        quantity_used: Number(raw.quantity_used ?? 0),
        amount: Number(raw.amount ?? 0),
        part_code: String(raw.maintenance_spare_parts?.part_code ?? ""),
        part_name: String(raw.maintenance_spare_parts?.part_name ?? ""),
        unit: String(raw.maintenance_spare_parts?.unit ?? "pcs"),
      };
      const arr = usageByBreakdown.get(usage.breakdown_id) ?? [];
      arr.push(usage);
      usageByBreakdown.set(usage.breakdown_id, arr);
    }

    setSchedules(
      ((schedulesResult.data ?? []) as any[]).map((row) => ({
        id: String(row.id),
        machine_id: String(row.machine_id ?? ""),
        machine_type: String(row.machine_type ?? "other"),
        maintenance_type: String(row.maintenance_type ?? "preventive"),
        description: row.description ?? null,
        frequency_type: String(row.frequency_type ?? "monthly"),
        next_due_date: String(row.next_due_date ?? ""),
        assigned_to: row.assigned_to ?? null,
        status: String(row.status ?? "scheduled"),
      })),
    );

    setBreakdowns(
      ((breakdownsResult.data ?? []) as any[]).map((row) => ({
        id: String(row.id),
        machine_id: String(row.machine_id ?? ""),
        machine_type: String(row.machine_type ?? "other"),
        breakdown_date: String(row.breakdown_date ?? ""),
        start_time: row.start_time ?? null,
        end_time: row.end_time ?? null,
        downtime_minutes: Number(row.downtime_minutes ?? 0),
        issue_description: String(row.issue_description ?? ""),
        root_cause: row.root_cause ?? null,
        action_taken: row.action_taken ?? null,
        spare_parts_used: row.spare_parts_used ?? null,
        cost: Number(row.cost ?? 0),
        status: String(row.status ?? "open"),
        reported_by: row.reported_by ?? null,
        resolved_by: row.resolved_by ?? null,
        vendor_name: row.vendor_name ?? null,
        bill_number: row.bill_number ?? null,
        bill_storage_bucket: row.bill_storage_bucket ?? null,
        bill_storage_path: row.bill_storage_path ?? null,
        bill_file_url: row.bill_file_url ?? null,
        usage: usageByBreakdown.get(String(row.id)) ?? [],
      })),
    );

    setSpareParts(
      ((sparePartsResult.data ?? []) as any[]).map((row) => ({
        id: String(row.id),
        part_code: String(row.part_code ?? ""),
        part_name: String(row.part_name ?? ""),
        machine_type: row.machine_type ?? null,
        unit: String(row.unit ?? "pcs"),
        current_stock: Number(row.current_stock ?? 0),
        reorder_level: Number(row.reorder_level ?? 0),
        average_rate: Number(row.average_rate ?? 0),
        location: row.location ?? null,
      })),
    );

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const getCompanyContext = async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error(userError?.message ?? "You must be logged in.");
    const { data: appUser, error: appUserError } = await supabase.from("app_users").select("company_id").eq("id", user.id).single();
    if (appUserError || !appUser?.company_id) throw new Error(appUserError?.message ?? "Company not found.");
    return { companyId: String(appUser.company_id), userId: String(user.id) };
  };

  const filteredSchedules = useMemo(() => schedules.filter((row) => filterStatus === "all" || row.status === filterStatus), [schedules, filterStatus]);

  const openBreakdowns = breakdowns.filter((row) => row.status === "open" || row.status === "in_progress").length;
  const overdueCount = schedules.filter((row) => row.status === "overdue").length;
  const totalDowntimeHours = breakdowns.reduce((sum, row) => sum + row.downtime_minutes, 0) / 60;
  const totalCost = breakdowns.reduce((sum, row) => sum + row.cost, 0);
  const lowSpareParts = spareParts.filter((part) => part.current_stock <= part.reorder_level).length;

  const openScheduleForm = () => {
    setFormMode("schedule");
    setShowForm(true);
    setErrorMessage("");
  };

  const openBreakdownForm = () => {
    setFormMode("breakdown");
    setShowForm(true);
    setErrorMessage("");
  };

  const handleAddSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    try {
      const { companyId } = await getCompanyContext();
      const payload = {
        company_id: companyId,
        machine_id: fMachine.trim(),
        machine_type: fMachineType,
        maintenance_type: fMaintenanceType,
        description: fDescription.trim(),
        frequency_type: fFrequency,
        next_due_date: fDueDate,
        assigned_to: fAssignedTo.trim() || null,
        status: "scheduled",
      };
      const { error } = await supabase.from("maintenance_schedules").insert(payload);
      if (error) throw error;
      setShowForm(false);
      setFMachine("");
      setFDescription("");
      setFAssignedTo("");
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save schedule.");
    }
  };

  const handleAddBreakdown = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    try {
      const { companyId } = await getCompanyContext();

      if (bCost > 0 && !bBillNumber.trim() && !bBillFile) {
        throw new Error("Enter bill number or upload bill file when a charge is logged.");
      }

      const selectedPart = spareParts.find((part) => part.id === bSparePartId);
      if (selectedPart && bSpareQty > selectedPart.current_stock) {
        throw new Error(`Only ${selectedPart.current_stock} ${selectedPart.unit} available for ${selectedPart.part_name}.`);
      }

      let billStoragePath: string | null = null;
      if (bBillFile) {
        const validation = validateUploadFile(bBillFile, maintenanceBillUploadRules);
        if (!validation.ok) throw new Error(validation.error ?? "Bill file is not allowed.");
        const safeName = bBillFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        billStoragePath = `${companyId}/breakdowns/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("maintenance-bills").upload(billStoragePath, bBillFile, { upsert: false });
        if (uploadError) throw uploadError;
      }

      const breakdownPayload = {
        company_id: companyId,
        machine_id: fMachine.trim(),
        machine_type: fMachineType,
        breakdown_date: new Date().toISOString().slice(0, 10),
        start_time: new Date().toISOString(),
        issue_description: bIssue.trim(),
        root_cause: bRootCause.trim() || null,
        action_taken: bActionTaken.trim() || null,
        spare_parts_used: selectedPart && bSpareQty > 0 ? `${selectedPart.part_name} x ${bSpareQty}` : null,
        cost: bCost,
        status: "open",
        reported_by: fAssignedTo.trim() || "Maintenance Team",
        vendor_name: bVendor.trim() || null,
        bill_number: bBillNumber.trim() || null,
        bill_storage_bucket: billStoragePath ? "maintenance-bills" : null,
        bill_storage_path: billStoragePath,
      };

      const { data: breakdownData, error: breakdownError } = await supabase.from("breakdown_logs").insert(breakdownPayload).select("id").single();
      if (breakdownError || !breakdownData?.id) throw new Error(breakdownError?.message ?? "Could not save breakdown.");

      if (selectedPart && bSpareQty > 0) {
        const { error: usageError } = await supabase.from("breakdown_spare_part_usage").insert({
          company_id: companyId,
          breakdown_id: breakdownData.id,
          spare_part_id: selectedPart.id,
          quantity_used: bSpareQty,
          notes: "Used during breakdown logging",
        });
        if (usageError) throw usageError;
      }

      setShowForm(false);
      setFMachine("");
      setBIssue("");
      setBRootCause("");
      setBActionTaken("");
      setBCost(0);
      setBVendor("");
      setBBillNumber("");
      setBBillFile(null);
      setBSparePartId("");
      setBSpareQty(0);
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save breakdown.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader title="Machine Maintenance" description="Schedules, breakdown logs, bill proof validation, and spare-part stock usage from live data." />
        <div className="flex gap-2">
          <Button onClick={openBreakdownForm} className="gap-2 bg-orange text-white hover:bg-orange/90">
            <Plus className="h-4 w-4" />
            Log Breakdown
          </Button>
          <Button onClick={openScheduleForm} className="gap-2 bg-slate-900 text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" />
            Add Schedule
          </Button>
        </div>
      </div>

      {errorMessage ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{errorMessage}</div> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Metric label="Overdue" value={overdueCount.toString()} icon={AlertTriangle} />
        <Metric label="Open Breakdowns" value={openBreakdowns.toString()} icon={CircleDot} />
        <Metric label="Downtime (hrs)" value={totalDowntimeHours.toFixed(1)} icon={Clock} />
        <Metric label="Maint Cost" value={`INR ${(totalCost / 1000).toFixed(0)}K`} icon={DollarSign} />
        <Metric label="Low Spares" value={lowSpareParts.toString()} icon={AlertTriangle} />
      </div>

      <div className="w-fit rounded-xl bg-slate-100 p-1">
        <div className="flex gap-1">
          {[
            { key: "schedules", label: "Maintenance Schedules", icon: Calendar },
            { key: "breakdowns", label: "Breakdown Log", icon: AlertTriangle },
            { key: "spares", label: "Spares in Maintenance", icon: DollarSign },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key as "schedules" | "breakdowns" | "spares")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
                tab === item.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "schedules" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {["all", "scheduled", "overdue", "in_progress", "completed", "cancelled"].map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize transition ${
                  filterStatus === status ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {status === "all" ? "All" : status.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                      <th className="px-5 py-3 font-medium">Machine</th>
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Description</th>
                      <th className="px-5 py-3 font-medium">Frequency</th>
                      <th className="px-5 py-3 font-medium">Due Date</th>
                      <th className="px-5 py-3 font-medium">Assigned</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSchedules.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <p className="text-xs font-bold text-slate-900">{row.machine_id}</p>
                          <p className="text-[10px] text-slate-500">{MACHINE_LABELS[row.machine_type] ?? row.machine_type}</p>
                        </td>
                        <td className="px-5 py-3 text-xs font-semibold capitalize">{row.maintenance_type.replace(/_/g, " ")}</td>
                        <td className="px-5 py-3 text-xs text-slate-700">{row.description || "-"}</td>
                        <td className="px-5 py-3 text-xs text-slate-600 capitalize">{row.frequency_type.replace(/_/g, " ")}</td>
                        <td className="px-5 py-3 text-xs font-mono font-bold text-slate-800">{row.next_due_date}</td>
                        <td className="px-5 py-3 text-xs text-slate-700">{row.assigned_to || "-"}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_STYLE[row.status] ?? "bg-slate-100 text-slate-700"}`}>{row.status.replace(/_/g, " ")}</span>
                        </td>
                      </tr>
                    ))}
                    {!filteredSchedules.length && !loading ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                          No schedules match this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "breakdowns" ? (
        <div className="space-y-4">
          {breakdowns.map((row) => (
            <Card key={row.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => setSelectedBreakdown(row)}>
              <CardContent className="p-5">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <p className="text-sm font-black text-slate-900">{row.machine_id}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_STYLE[row.status] ?? "bg-slate-100 text-slate-700"}`}>{row.status.replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {MACHINE_LABELS[row.machine_type] ?? row.machine_type} | {row.breakdown_date}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-red-600">{row.downtime_minutes > 0 ? `${(row.downtime_minutes / 60).toFixed(1)} hrs` : "Ongoing"}</p>
                    <p className="text-xs text-slate-500">INR {row.cost.toLocaleString("en-IN")}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-700">{row.issue_description}</p>
                {row.usage.length ? <p className="mt-1 text-[10px] font-bold text-orange">Spares deducted: {row.usage.map((usage) => `${usage.part_code} x ${usage.quantity_used}`).join(", ")}</p> : null}
              </CardContent>
            </Card>
          ))}
          {!breakdowns.length && !loading ? <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-semibold text-slate-500">No breakdown logs yet.</div> : null}
        </div>
      ) : null}

      {tab === "spares" ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                    <th className="px-5 py-3 font-medium">Part</th>
                    <th className="px-5 py-3 font-medium">Machine</th>
                    <th className="px-5 py-3 font-medium">Stock</th>
                    <th className="px-5 py-3 font-medium">Reorder</th>
                    <th className="px-5 py-3 font-medium">Avg Rate</th>
                    <th className="px-5 py-3 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {spareParts.map((part) => (
                    <tr key={part.id} className={part.current_stock <= part.reorder_level ? "bg-amber-50/50" : ""}>
                      <td className="px-5 py-3">
                        <p className="font-black text-slate-900">{part.part_code}</p>
                        <p className="text-xs font-semibold text-slate-500">{part.part_name}</p>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-700">{part.machine_type ? MACHINE_LABELS[part.machine_type] ?? part.machine_type : "-"}</td>
                      <td className="px-5 py-3 text-xs font-black text-slate-900">{part.current_stock} {part.unit}</td>
                      <td className="px-5 py-3 text-xs text-slate-600">{part.reorder_level} {part.unit}</td>
                      <td className="px-5 py-3 text-xs font-semibold">INR {part.average_rate.toLocaleString("en-IN")}</td>
                      <td className="px-5 py-3 text-xs text-slate-600">{part.location || "-"}</td>
                    </tr>
                  ))}
                  {!spareParts.length && !loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                        No spare parts configured yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {selectedBreakdown ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setSelectedBreakdown(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Breakdown Report</p>
                <p className="text-lg font-black">{selectedBreakdown.machine_id}</p>
              </div>
              <button onClick={() => setSelectedBreakdown(null)} className="rounded-lg p-2 transition hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-5 text-xs">
              <Field label="Issue" value={selectedBreakdown.issue_description} />
              <Field label="Root Cause" value={selectedBreakdown.root_cause || "-"} />
              <Field label="Action Taken" value={selectedBreakdown.action_taken || "-"} />
              <Field label="Vendor" value={selectedBreakdown.vendor_name || "-"} />
              <Field label="Bill Number" value={selectedBreakdown.bill_number || "-"} />
              <Field
                label="Bill Proof"
                value={
                  selectedBreakdown.bill_storage_path
                    ? `${selectedBreakdown.bill_storage_bucket || "maintenance-bills"} / ${selectedBreakdown.bill_storage_path}`
                    : selectedBreakdown.cost > 0
                      ? "Missing bill proof"
                      : "No external charge"
                }
              />
              <Field label="Reported By" value={selectedBreakdown.reported_by || "-"} />
              <Field label="Resolved By" value={selectedBreakdown.resolved_by || "-"} />
              <Field label="Status" value={selectedBreakdown.status.replace(/_/g, " ")} />
              {selectedBreakdown.usage.length ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Spare Usage</p>
                  {selectedBreakdown.usage.map((usage) => (
                    <p key={usage.id} className="text-xs text-slate-700">
                      {usage.part_code} - {usage.part_name}: {usage.quantity_used} {usage.unit} (INR {usage.amount.toLocaleString("en-IN")})
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-3xl bg-slate-900 p-5 text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{formMode === "schedule" ? "New Schedule" : "Breakdown Log"}</p>
                <p className="text-lg font-black">{formMode === "schedule" ? "Add Maintenance Task" : "Log Breakdown with Bill + Spares"}</p>
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-2 transition hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={formMode === "schedule" ? handleAddSchedule : handleAddBreakdown} className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Machine Name</label>
                  <input value={fMachine} onChange={(event) => setFMachine(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Press 1 (1800T)" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Machine Type</label>
                  <select value={fMachineType} onChange={(event) => setFMachineType(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {Object.entries(MACHINE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {formMode === "schedule" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Maintenance Type</label>
                      <select value={fMaintenanceType} onChange={(event) => setFMaintenanceType(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="preventive">Preventive</option>
                        <option value="corrective">Corrective</option>
                        <option value="inspection">Inspection</option>
                        <option value="calibration">Calibration</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Frequency</label>
                      <select value={fFrequency} onChange={(event) => setFFrequency(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="half_yearly">Half Yearly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                  </>
                ) : null}
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">{formMode === "schedule" ? "Description" : "Issue Description"}</label>
                  <input
                    value={formMode === "schedule" ? fDescription : bIssue}
                    onChange={(event) => (formMode === "schedule" ? setFDescription(event.target.value) : setBIssue(event.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    required
                  />
                </div>
                {formMode === "breakdown" ? (
                  <>
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-bold text-slate-700">Root Cause</label>
                      <input value={bRootCause} onChange={(event) => setBRootCause(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs font-bold text-slate-700">Action Taken</label>
                      <input value={bActionTaken} onChange={(event) => setBActionTaken(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </div>
                  </>
                ) : null}
                {formMode === "schedule" ? (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">Due Date</label>
                    <input type="date" value={fDueDate} onChange={(event) => setFDueDate(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                  </div>
                ) : null}
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">{formMode === "schedule" ? "Assigned To" : "Reported By"}</label>
                  <input value={fAssignedTo} onChange={(event) => setFAssignedTo(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
                {formMode === "breakdown" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">External Charges</label>
                      <input type="number" value={bCost} onChange={(event) => setBCost(Number(event.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Vendor</label>
                      <input value={bVendor} onChange={(event) => setBVendor(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Bill Number</label>
                      <input value={bBillNumber} onChange={(event) => setBBillNumber(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Bill File</label>
                      <input type="file" onChange={(event) => setBBillFile(event.target.files?.[0] ?? null)} className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" accept=".pdf,.png,.jpg,.jpeg,.webp" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Spare Part Used</label>
                      <select value={bSparePartId} onChange={(event) => setBSparePartId(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <option value="">No spare part</option>
                        {spareParts.map((part) => (
                          <option key={part.id} value={part.id}>
                            {part.part_code} - {part.part_name} ({part.current_stock} {part.unit})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-700">Quantity Used</label>
                      <input type="number" step="0.001" value={bSpareQty} onChange={(event) => setBSpareQty(Number(event.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-slate-900 text-white hover:bg-slate-800">
                  {formMode === "schedule" ? "Add Schedule" : "Log Breakdown"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof AlertTriangle }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-700" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        </div>
        <p className="text-xl font-black text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xs text-slate-800">{value}</p>
    </div>
  );
}
