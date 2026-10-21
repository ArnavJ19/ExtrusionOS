export type QuoteFormShortcut = "add-line" | "duplicate-line" | "save-draft";
export type InFlightGuard = { current: boolean };

export async function runWithInFlightGuard<T>(guard: InFlightGuard, action: () => Promise<T>): Promise<T | undefined> {
  if (guard.current) return undefined;
  guard.current = true;
  try {
    return await action();
  } finally {
    guard.current = false;
  }
}

const draftableQuoteStatuses = new Set(["draft", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired"]);

export function canSaveQuoteDraft(status: string, editing: boolean) {
  return !editing || draftableQuoteStatuses.has(status);
}

const shortcutKeys: Record<string, QuoteFormShortcut> = {
  a: "add-line",
  d: "duplicate-line",
  s: "save-draft",
};

export function getQuoteFormShortcut(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  targetIsContentEditable?: boolean;
}): QuoteFormShortcut | null {
  if (event.isComposing || event.repeat || event.defaultPrevented || event.targetIsContentEditable) return null;
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return null;
  return shortcutKeys[event.key.toLowerCase()] ?? null;
}

const copiedIdentityFields = new Set(["id", "quote_id", "company_id", "created_at", "updated_at"]);

export function duplicateQuoteDraftLine<T extends Record<string, unknown>>(line: T): T {
  return Object.fromEntries(Object.entries(line).filter(([key]) => !copiedIdentityFields.has(key))) as T;
}
