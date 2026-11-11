"use client";

// AP-028: "due in ~N pushes" under the die selector on the production job form. Reads public.ap_dies through the form's
// own browser client (the database takes the company and role from the session); a read failure shows nothing.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { DieService } from "@/lib/press/types";

export function dieServiceSummary(service: Pick<DieService, "state" | "flag" | "due_in_pushes" | "bookings" | "checks">) {
  if (!service.checks.length) return "No approved service interval for this die family.";
  if (service.flag === "due_unbooked") return "Service due now and not booked.";
  if (service.flag === "due_booked") return `Service due; booked for ${service.bookings[0]?.scheduled_for ?? "a date"}.`;
  if (service.due_in_pushes !== null) return `Service due in ~${service.due_in_pushes} pushes.`;
  return service.state === "approaching" ? "Approaching its service interval." : "Within its service interval.";
}

export function DieServiceHint({ dieId }: { dieId: string }) {
  const [text, setText] = useState<{ tone: string; message: string } | null>(null);
  useEffect(() => {
    let current = true;
    let request: PromiseLike<{ data: unknown; error: unknown }>;
    try {
      const client = createClient();
      if (typeof client?.rpc !== "function") return () => { current = false; };
      request = client.rpc("ap_dies", { p_command: "service", p_payload: { die_id: dieId } });
    } catch { return () => { current = false; }; }
    void Promise.resolve(request).then(({ data, error }) => {
      if (!current) return;
      const service = data as DieService | null;
      if (error || !service || service.missing || !Array.isArray(service.checks)) { setText(null); return; }
      setText({ tone: service.flag?.startsWith("due") ? "text-rose-800" : service.flag === "approaching" ? "text-amber-900" : "text-neutral-600", message: dieServiceSummary(service) });
    }).catch(() => { if (current) setText(null); });
    return () => { current = false; };
  }, [dieId]);
  return text ? <p className="text-xs font-semibold text-neutral-700" role="status"><span className={text.tone}>Die service: {text.message}</span></p> : null;
}
