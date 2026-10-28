type Choice = { value: string; label: string };

export function WorkListControls({ search = "", sort, sorts, filter, filterName = "status", filters, hidden = {} }: {
  search?: string; sort: string; sorts: Choice[]; filter?: string; filterName?: string; filters?: Choice[]; hidden?: Record<string, string>;
}) {
  return <form method="get" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <label className="text-sm font-semibold">Search records<input className="form-input" type="search" name="search" maxLength={80} defaultValue={search} /></label>
    {filters ? <label className="text-sm font-semibold">Filter<select className="form-input" name={filterName} defaultValue={filter}>{filters.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label> : null}
    <label className="text-sm font-semibold">Sort<select className="form-input" name="sort" defaultValue={sort}>{sorts.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
    <button className="self-end rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white" type="submit">Apply view</button>
  </form>;
}
