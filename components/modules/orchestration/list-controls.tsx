import Link from "next/link";
import type { FloorText } from "@/lib/i18n/floor";

// Server-side search, filter and sort for the orchestration database pages: a plain GET form, so every change reloads
// page 1 from the database (no client paging over a partial list).
type Option = { value: string; label: string };
const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";

export function ListControls({ t, search, searchHint, hidden = {}, filter, sorts, sort, direction, checkbox, clearHref }: {
  t: FloorText; search: string; searchHint: string; hidden?: Record<string, string>;
  filter?: { name: string; label: string; value: string; options: Option[] };
  sorts: Option[]; sort: string; direction: "asc" | "desc";
  checkbox?: { name: string; label: string; checked: boolean };
  clearHref: string;
}) {
  return (
    <form method="get" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <label className="text-sm font-semibold">{t("list.search")}
        <input type="search" name="q" maxLength={80} defaultValue={search} placeholder={searchHint} className={field} /></label>
      {filter ? <label className="text-sm font-semibold">{filter.label}
        <select name={filter.name} defaultValue={filter.value} className={field}>{filter.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> : null}
      <label className="text-sm font-semibold">{t("list.sortBy")}
        <select name="sort" defaultValue={sort} className={field}>{sorts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <label className="text-sm font-semibold">{t("list.direction")}
        <select name="dir" defaultValue={direction} className={field}>
          <option value="asc">{t("list.dir.asc")}</option><option value="desc">{t("list.dir.desc")}</option></select></label>
      {checkbox ? <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name={checkbox.name} value="1" defaultChecked={checkbox.checked} className="h-5 w-5" />{checkbox.label}</label> : null}
      <div className="flex gap-2">
        <button type="submit" className="min-h-11 rounded-xl bg-charcoal px-4 text-sm font-bold text-white">{t("list.apply")}</button>
        <Link href={clearHref} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-bold">{t("list.clear")}</Link>
      </div>
    </form>
  );
}

/** A sortable column heading: the active column flips direction, another column starts descending. */
export function SortHeader({ label, field: name, sort, direction, href, t }: { label: string; field: string; sort: string; direction: "asc" | "desc"; href: (sort: string, dir: string) => string; t: FloorText }) {
  const active = sort === name;
  const next = active && direction === "desc" ? "asc" : "desc";
  return (
    <th scope="col" className="px-3 py-2 font-bold" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href(name, next)} className="inline-flex min-h-11 items-center gap-1 underline-offset-2 hover:underline" title={t("list.sortColumn", { column: label })}>
        {label}{active ? <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span> : null}
      </Link>
    </th>
  );
}
