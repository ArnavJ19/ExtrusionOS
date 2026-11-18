// AP-093: the registry of actions that may offer "Undo" for a few seconds. Only low-risk actions whose inverse is the
// same kind of action belong here (move a task back, restore a saved view, mark a notification unread). Anything that
// posts stock, money or a quality decision, numbers a document or tells a customer something is corrected through its own
// correction workflow and must never be registered: a test checks this list against those words.
export const UNDO_WINDOW_MS = 10_000;

export const UNDOABLE = {
  "task.status": { label: "Task status", inverse: "Move the task back to its previous status" },
  "saved_view.delete": { label: "Saved view", inverse: "Save the view again with the same name, filters and default" },
  "saved_view.default": { label: "Default view", inverse: "Restore the previous default view" },
  "notification.read": { label: "Notification", inverse: "Mark the notification unread again" }
} as const;
export type UndoKind = keyof typeof UNDOABLE;
export const UNDO_KIND_KEYS = Object.keys(UNDOABLE) as [UndoKind, ...UndoKind[]];

/** Words that mark a posting action. A kind containing one of these is refused. */
export const NEVER_UNDOABLE = ["stock", "inventory", "invoice", "payment", "receipt", "credit", "debit", "ledger", "dispatch", "quality", "qc", "release", "ncr", "number", "series", "period", "customer_message"] as const;

export function isUndoable(kind: string): kind is UndoKind {
  return Object.prototype.hasOwnProperty.call(UNDOABLE, kind) && !NEVER_UNDOABLE.some(word => kind.includes(word));
}

/** Task statuses a person can move between from the task board; the previous one is what Undo restores. */
export const TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export function taskUndoTarget(previous: string, next: string): TaskStatus | null {
  if (previous === next || !(TASK_STATUSES as readonly string[]).includes(previous)) return null;
  return previous as TaskStatus;
}
