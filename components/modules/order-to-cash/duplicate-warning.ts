"use client";

// AP-097: shown when the server found a record that looks like the one being saved. The person opens the existing record
// or saves anyway (the server logs that choice); nothing is saved until they choose.
import { toast } from "sonner";
import type { DuplicateMatch } from "@/lib/order-to-cash/duplicates";

export type Duplicated = { success: false; error: string; duplicates?: DuplicateMatch[] };

export function hasDuplicates(result: unknown): result is Duplicated & { duplicates: DuplicateMatch[] } {
  return Boolean(result && typeof result === "object" && (result as Duplicated).success === false && Array.isArray((result as Duplicated).duplicates)
    && (result as Duplicated).duplicates!.length > 0);
}

export function warnDuplicates(matches: DuplicateMatch[], saveAnyway: () => void, open?: (href: string) => void) {
  const first = matches[0];
  toast.warning(`Possible duplicate: ${first.label}`, {
    id: "ap-duplicate",
    duration: 30000,
    description: matches.map(m => `${m.label}: ${m.why}`).join(" · "),
    action: { label: "Save anyway", onClick: saveAnyway },
    cancel: { label: "Open existing", onClick: () => (open ? open(first.href) : window.location.assign(first.href)) }
  });
}
