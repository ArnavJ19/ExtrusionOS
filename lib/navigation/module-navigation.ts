export type ModuleNavigationItem = {
  href: string;
  label: string;
  aliases?: string[];
};

export type CurrentModule = {
  item: ModuleNavigationItem;
  matchedPrefix: string;
};

export type IntraModuleHistory = {
  moduleHref: string;
  entries: string[];
  currentIndex: number;
};

function matchesPrefix(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

export function getCurrentModule(pathname: string, items: ModuleNavigationItem[]): CurrentModule | null {
  let current: CurrentModule | null = null;

  for (const item of items) {
    for (const prefix of [item.href, ...(item.aliases ?? [])]) {
      if (!matchesPrefix(pathname, prefix)) continue;
      if (current && current.matchedPrefix.length >= prefix.length) continue;
      current = { item, matchedPrefix: prefix };
    }
  }

  return current;
}

export function updateIntraModuleHistory(
  history: IntraModuleHistory | undefined,
  moduleHref: string,
  pathname: string,
): IntraModuleHistory {
  if (!history || history.moduleHref !== moduleHref) {
    return { moduleHref, entries: [pathname], currentIndex: 0 };
  }

  if (history.entries[history.currentIndex] === pathname) return history;

  const existingIndex = history.entries.indexOf(pathname);
  if (existingIndex >= 0) return { ...history, currentIndex: existingIndex };

  const entries = [...history.entries.slice(0, history.currentIndex + 1), pathname];
  return { ...history, entries, currentIndex: entries.length - 1 };
}

export function getIntraModuleNeighbors(history: IntraModuleHistory) {
  return {
    previous: history.entries[history.currentIndex - 1] ?? null,
    next: history.entries[history.currentIndex + 1] ?? null,
  };
}

export function getModulePageLabel(pathname: string, module: CurrentModule) {
  const relativePath = pathname.slice(module.matchedPrefix.length).replace(/^\//, "");
  if (!relativePath) return "Overview";

  const segments = relativePath.split("/");
  const finalSegment = segments.at(-1) ?? "";
  if (finalSegment === "database") return "Database";
  if (finalSegment === "new") return "Create new";
  if (finalSegment === "edit") return "Edit record";
  if (segments.length === 1 && !looksLikeRecordId(finalSegment)) return labelize(finalSegment);
  if (segments.length > 1 && !looksLikeRecordId(finalSegment)) return labelize(finalSegment);
  return "Record details";
}

function looksLikeRecordId(segment: string) {
  return /\d/.test(segment) || segment.length > 20;
}

function labelize(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
