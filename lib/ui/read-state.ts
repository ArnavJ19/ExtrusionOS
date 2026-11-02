export type ReadFailure = "denied" | "failed";

export function classifyReadFailure(error: unknown): ReadFailure {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return ["42501", "PGRST301", "PGRST302"].includes(code) ? "denied" : "failed";
}

export function readStateMessage(state: "empty" | "filtered" | ReadFailure | "partial") {
  switch (state) {
    case "empty": return { title: "No records yet", description: "There are no accessible records in this database. Create a first record if your role permits it." };
    case "filtered": return { title: "No matching records", description: "No accessible records match these filters. Remove a filter or clear all filters to widen this view." };
    case "denied": return { title: "Access unavailable", description: "Your current session cannot read this view. Check your sign-in or ask your administrator to review your access." };
    case "partial": return { title: "Some information is unavailable", description: "The last successful records are shown below. A refresh failed; check the source before acting." };
    default: return { title: "Records could not be loaded", description: "The source did not return a usable result. This does not mean there are no records or no stock. Your filters are retained; retry the read." };
  }
}
