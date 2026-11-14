// AP-092: browser calls for saved views. They go to /api/saved-views with fetch (no server module in the page bundle);
// any failure, including an older server without the route, is reported as a result, never thrown.
export type SavedView = { id: string; name: string; query: string; is_default: boolean; updated_at?: string };
type Result<T> = { success: true; data: T } | { success: false; error: string; unavailable?: boolean };

async function call<T>(command: string, payload: Record<string, unknown>): Promise<Result<T>> {
  try {
    const response = await fetch("/api/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, payload }) });
    const data = await response.json() as Result<T>;
    if (!data || typeof data !== "object" || typeof (data as { success?: unknown }).success !== "boolean") return { success: false, error: "Saved views are not available.", unavailable: true };
    return data;
  } catch {
    return { success: false, error: "Saved views are not available. Check your connection and retry.", unavailable: true };
  }
}

export const listViewsAction = (pageKey: string) => call<{ views: SavedView[] }>("list", { page_key: pageKey });
export const defaultViewAction = (pageKey: string) => call<{ view: SavedView | null }>("default", { page_key: pageKey });
export const saveViewAction = (input: { page_key: string; name: string; query: string; make_default?: boolean }) => call<SavedView>("save", input);
export const setDefaultViewAction = (id: string) => call<{ id: string }>("set_default", { id });
export const clearDefaultViewAction = (pageKey: string) => call<{ cleared: boolean }>("clear_default", { page_key: pageKey });
export const deleteViewAction = (id: string) => call<{ deleted: boolean }>("delete", { id });
