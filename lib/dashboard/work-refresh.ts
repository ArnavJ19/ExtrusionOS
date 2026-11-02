import type { MyWork, WorkQueue } from "./my-work.ts";

export function mergeWorkRefresh(previous: MyWork, next: MyWork): MyWork {
  const merge = (fresh: WorkQueue, old?: WorkQueue): WorkQueue => fresh.error && fresh.errorKind !== "denied" && old?.items.length
    ? { ...fresh, items: old.items, hasMore: old.hasMore, error: `${fresh.error} Previous entries are shown for reference and may have changed.` }
    : fresh;
  return { ...next, assigned: merge(next.assigned, previous.assigned), unassigned: merge(next.unassigned, previous.unassigned),
    departments: next.departments.map((queue) => merge(queue, previous.departments.find((old) => old.key === queue.key))) };
}

export function markWorkRefreshUnavailable(work: MyWork): MyWork {
  const mark = (queue: WorkQueue): WorkQueue => ({ ...queue, errorKind: "unavailable", error: "Refresh could not be confirmed. Previous entries are shown for reference; reload before continuing." });
  return { ...work, assigned: mark(work.assigned), unassigned: mark(work.unassigned), departments: work.departments.map(mark) };
}
