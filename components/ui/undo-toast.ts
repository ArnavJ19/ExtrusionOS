"use client";

// AP-093: an "Undo" toast for low-risk actions. The inverse is supplied by the screen and runs through that action's own
// authorised path; this only shows the offer for ten seconds and records that it was used. It imports no server module
// (the shared list page bundles it), so the record goes to /api/undo with fetch and is best effort.
import { toast } from "sonner";
import { UNDO_WINDOW_MS, isUndoable, type UndoKind } from "@/lib/undo/registry";

type UndoResult = { success: boolean; error?: string };

export async function recordUndo(kind: UndoKind, target: string, extra: Record<string, unknown> = {}): Promise<UndoResult> {
  try {
    const response = await fetch("/api/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, target, ...extra }) });
    const data = await response.json() as UndoResult;
    return typeof data?.success === "boolean" ? data : { success: false, error: "Undo is not available." };
  } catch {
    return { success: false, error: "Undo is not available. Check your connection." };
  }
}

/** Shows the result of a reversible action with an Undo button. A kind that is not registered gets a plain message. */
export function offerUndo(options: { kind: string; target: string; message: string; undo: () => Promise<UndoResult>; onUndone?: () => void }) {
  const { kind, target, message, undo, onUndone } = options;
  if (!isUndoable(kind)) { toast.success(message); return; }
  let used = false;
  toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        if (used) return;
        used = true;
        const result = await undo();
        if (!result.success) { toast.error(result.error ?? "This could not be undone. Change it back by hand."); return; }
        toast.success("Undone");
        onUndone?.();
        // The notification inverse is recorded by the database itself.
        if (kind !== "notification.read") void recordUndo(kind, target);
      }
    }
  });
}
