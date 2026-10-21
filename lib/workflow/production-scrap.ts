// Completion scrap categories (EXOS-AUD-006). Must match the categories accepted by
// public.complete_production_job_with_scrap_atomic.
export const PRODUCTION_SCRAP_CATEGORIES = [
  { value: "butt_end", label: "Butt end kg", recoverable: true },
  { value: "front_back_end", label: "Front / back end kg", recoverable: true },
  { value: "saw_cut", label: "Saw cut kg", recoverable: true },
  { value: "rejects", label: "Press rejects kg", recoverable: true },
  { value: "unrecoverable_loss", label: "Unrecoverable loss kg (dross, oxidation)", recoverable: false }
] as const;

export type ProductionScrapCategory = (typeof PRODUCTION_SCRAP_CATEGORIES)[number]["value"];
