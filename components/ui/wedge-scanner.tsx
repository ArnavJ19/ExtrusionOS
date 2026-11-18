"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { resolveScanAction } from "@/lib/actions/scan";
import { WEDGE_PAGE_EVENT, WEDGE_PENDING_KEY, emptyWedge, feedWedge } from "@/lib/qr/wedge";
import { SCAN_FIELD_EVENT, type ScanFieldEvent } from "@/components/ui/recent-scope";

const editable = (element: Element | null) => Boolean(element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  || element instanceof HTMLSelectElement || (element as HTMLElement).isContentEditable));

// AP-025: a USB scanner in keyboard-wedge mode works on every screen. A fast burst that starts with the ExtrusionOS label
// prefix and ends with Enter is a scan:
// - in a field that accepts scans (bundle, die, billet lot selectors), the label fills that field;
// - in any other text field, nothing is intercepted (the characters stay where the person put the cursor);
// - with no field focused, the record opens (through the same authorised lookup the scan page uses).
export function WedgeScanner() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useRef(emptyWedge());
  const busy = useRef(false);
  const where = useRef(pathname);
  useEffect(() => { where.current = pathname; }, [pathname]);

  useEffect(() => {
    async function deliver(raw: string, target: Element | null) {
      if (busy.current) return;
      busy.current = true;
      try {
        const field = target?.closest("[data-scan-accept]") ?? (target?.matches("[data-scan-accept]") ? target : null);
        if (field) {
          const result = await resolveScanAction(raw);
          const detail: ScanFieldEvent = result.ok ? { ok: true, entityType: result.entityType, entityId: result.entityId, label: `${result.entityTypeLabel} ${result.label}` } : { ok: false, error: result.error };
          field.dispatchEvent(new CustomEvent(SCAN_FIELD_EVENT, { detail }));
          return;
        }
        if (editable(target)) return;
        if (where.current === "/scan") { window.dispatchEvent(new CustomEvent(WEDGE_PAGE_EVENT, { detail: raw })); return; }
        const result = await resolveScanAction(raw);
        if (!result.ok) { toast.error(result.error); return; }
        const open = result.actions.find(action => action.label.startsWith("Open")) ?? result.actions[0];
        if (open) { toast.success(`Scanned ${result.entityTypeLabel} ${result.label}`); router.push(open.href); return; }
        try { window.sessionStorage.setItem(WEDGE_PENDING_KEY, raw); } catch { /* the scan page asks for the code instead */ }
        router.push("/scan");
      } catch { toast.error("The scan could not be checked. Retry, or type the code."); }
      finally { busy.current = false; }
    }
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const step = feedWedge(state.current, event.key, event.timeStamp || performance.now());
      state.current = step.state;
      if (step.scan) {
        const target = document.activeElement;
        const scanField = target?.closest("[data-scan-accept]");
        // A scan ending in a scan field or on the page itself is consumed so Enter does not submit a form or pick a row.
        if (scanField || !editable(target)) { event.preventDefault(); event.stopPropagation(); }
        void deliver(step.scan, target);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router]);
  return null;
}
