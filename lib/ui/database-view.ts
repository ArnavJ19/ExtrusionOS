import { makeViewState, type WorkspaceViewState } from "../preferences/workspace-preferences.ts";

export type DatabaseViewRules = {
  statuses?: readonly string[];
  secondary?: readonly { value: string; label: string }[];
  sortable: readonly string[];
  defaultSort: { column: string; direction: "asc" | "desc" };
  dates: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Normalize URL and saved-view inputs before passing them to the bounded server query. */
export function parseDatabaseView(params: URLSearchParams, rules: DatabaseViewRules, initialStatus = ""): WorkspaceViewState {
  const state = makeViewState(params);
  const status = params.has("status") ? state.status : initialStatus;
  const dateFrom = rules.dates && validDate(state.dateFrom) ? state.dateFrom : "";
  const dateTo = rules.dates && validDate(state.dateTo) ? state.dateTo : "";
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const defaultColumn = rules.sortable.includes(rules.defaultSort.column) ? rules.defaultSort.column : rules.sortable[0] ?? rules.defaultSort.column;
  return {
    ...state,
    status: rules.statuses?.includes(status) ? status : "",
    secondary: rules.secondary?.some((option) => option.value === state.secondary) ? state.secondary : "",
    dateFrom: invalidRange ? "" : dateFrom,
    dateTo: invalidRange ? "" : dateTo,
    sort: rules.sortable.includes(state.sort) ? state.sort : defaultColumn,
    direction: params.get("direction") === "asc" || params.get("direction") === "desc" ? state.direction : !params.has("direction") && rules.sortable.includes(state.sort) ? "asc" : rules.defaultSort.direction,
    relationFilters: Object.fromEntries(Object.entries(state.relationFilters).filter(([, value]) => uuid.test(value)))
  };
}

export function databaseFilterChips(state: WorkspaceViewState, labels: { status: string; secondary?: string; secondaryOptions?: readonly { value: string; label: string }[]; date?: string }) {
  const readable = (value: string) => value.replace(/_/g, " ");
  return [
    ...(state.search ? [{ key: "search", label: `Search: ${state.search}` }] : []),
    ...(state.status ? [{ key: "status", label: `${labels.status}: ${readable(state.status)}` }] : []),
    ...(state.secondary ? [{ key: "secondary", label: `${labels.secondary ?? "Type"}: ${labels.secondaryOptions?.find((option) => option.value === state.secondary)?.label ?? readable(state.secondary)}` }] : []),
    ...(state.dateFrom ? [{ key: "dateFrom", label: `${labels.date ?? "Date"} from ${state.dateFrom}` }] : []),
    ...(state.dateTo ? [{ key: "dateTo", label: `${labels.date ?? "Date"} to ${state.dateTo}` }] : []),
    ...Object.keys(state.relationFilters).map((field) => ({ key: field, label: `Connected ${readable(field.replace(/_id$/, ""))}` }))
  ];
}
