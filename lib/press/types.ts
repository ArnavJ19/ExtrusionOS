// Read models returned by public.ap_press / ap_dies / ap_pm / ap_sampling (autopilot batch 2). Numbers arrive as JSON
// numbers; a value the database could not derive arrives as null and is shown blank, never as zero.

export type ShiftTarget = {
  slots: number; target_kg: number | null; target_pushes: number | null; die_changes: number; die_change_allowance_minutes: number;
  allowance_basis: "measured" | "setting"; maintenance_minutes: number; kg_unknown: boolean; pushes_unknown: boolean;
};
export type ShiftActual = { pushes: number; billet_kg: number; estimated_output_kg: number; pushes_without_estimate: number; last_push_at: string | null };
export type Shift = { code: string; starts_at: string; ends_at: string; target: ShiftTarget; actual: ShiftActual };

export type Expected = {
  good_pieces: number; good_kg: number; meters: number; butt_kg: number; crop_kg: number; saw_kg: number; cutoff_kg: number; recovery_percent: number | null;
  bundles: { per_bundle: number; full: number; loose: number } | null;
};

export type StationView = {
  kind: "station"; session_id: string; machine_id: string; machine_name: string; expires_at: string; now: string; idle_gap_minutes: number;
  running_jobs: { id: string; job_number: string | null }[];
  job: null | {
    id: string; job_number: string | null; planned_quantity_kg: number | null; pieces: number | null; die_number: string | null; profile_code: string | null;
    pushes: number; billet_kg: number | null; linked_billets: number; linked_remaining: number; expected: Expected | null; missing: string[]; blockers: string[];
    samples_open: number; undo: { push_id: string; seq: number; until: string } | null;
  };
  last_push: { at: string; operator: string | null; job_id: string } | null;
  idle: { since: string; minutes: number; interval_id: string | null; reason: string | null } | null;
  shift: Shift | null;
};

export type PushResult = { state: "recorded" | "replayed" | "double_tap"; id: string; seq: number; message?: string; expires_at?: string; samples_created?: number; die_change?: boolean };

export type JobExpected = {
  job_id: string; job_status: string; pushes: number; billet_kg: number | null; estimated_pushes: number; linked_billets: number; linked_billet_kg: number; linked_pushed: number;
  input_kg: number | null; input_basis: "linked_billets" | "pushes"; existing_scrap_kg: number; kg_per_m: number | null; cut_m: number | null; pieces_per_bundle: number | null;
  standard: { id: string; version: number; butt_length_mm: number; front_crop_mm: number; back_crop_mm: number; saw_kerf_mm: number; density_kg_m3: number; scope: string } | null;
  complete: boolean; expected: Expected | null; blockers: string[]; missing: string[];
};

export type SampleRow = {
  id: string; job_id: string; job_number: string | null; machine: string; profile_code: string | null; kind: string; occurrence_key: string; at_push: number | null;
  window_push: number | null; window_ends_at: string | null; due_at: string; blocks_release: boolean; status: "open" | "missed" | "recorded" | "waived";
  recorded_late: boolean | null; recorded_at: string | null; recorded_by: string | null; waive_reason: string | null; current_pushes: number;
};

export type JobSampling = { required: number; on_time: number; late: number; missed: number; open: number; waived: number; blocking_open: number; compliance_percent: number | null };

export type JobPressView = {
  job_id: string; status: string; expected: JobExpected;
  pushes: { count: number; voided: number; backfilled: number; first_at: string | null; last_at: string | null };
  cycle: { median_seconds: number | null; cycles: number; running_seconds: number };
  recovery_percent: number | null;
  derivation: null | { pushes: number; billet_kg: number; butt_kg: number; crop_kg: number; saw_kg: number; cutoff_kg: number; reject_kg: number; reject_pieces: number; reject_reason: string | null; good_kg: number; good_pieces: number; standard_version: number | null };
  die_change: null | { id: string; minutes: number; from_die: string | null };
  sampling: JobSampling;
  samples: { id: string; kind: string; occurrence_key: string; status: string; due_at: string; blocks_release: boolean; recorded_late: boolean | null }[];
  recent: { id: string; seq: number; at: string; source: string; billet_kg: number | null; basis: string | null; operator: string | null; voided: boolean }[];
};

export type DieCheck = { threshold_id: string; basis: string; service_event: string; warn_at: number; value: number | null; state: "ok" | "approaching" | "due" | "unknown"; due_in_pushes: number | null; die_type: string | null };
export type DieService = {
  die_id: string; die_number: string; die_type: string | null; die_status: string; avg_billet_kg_per_push: number | null; checks: DieCheck[]; state: "none" | "ok" | "approaching" | "due";
  service: Record<"nitriding" | "correction" | "any", { since: string | null; pushes: number; kg: number; runs: number; days: number | null }>;
  bookings: { id: string; service_event: "nitriding" | "correction"; scheduled_for: string; booked_at: string; booked_by: string | null }[];
  due_in_pushes: number | null; flag: "due_unbooked" | "due_booked" | "approaching" | null; can_book?: boolean; missing?: boolean;
};

export type PmPlanRow = {
  id: string; machine_id: string; machine: string; asset_kind: string; asset_label: string | null; task: string; basis: "running_hours" | "pushes"; interval_value: number; window_hours: number;
  safety_critical: boolean; status: string; counter: { since: string; running_hours: number; pushes: number; value: number; percent: number };
  state: "ok" | "approaching" | "due" | "retired"; scheduled: { id: string; window_start: string | null; window_end: string | null } | null;
  last_done: { done_at: string; counter_at_done: number | null; by: string | null } | null;
};

export const fmtKg = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits })} kg`;
export const fmtNum = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
export const fmtTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtClock = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—";
