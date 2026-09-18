import Link from "next/link";

export function MobilePagination({ path, page, pageSize, totalCount }: { path: string; page: number; pageSize: number; totalCount: number }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold" aria-label="Mobile queue pages">
      {page > 1 ? <Link className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700" href={`${path}?page=${page - 1}`}>Previous</Link> : <span className="px-3 py-2 text-slate-300">Previous</span>}
      <span className="text-slate-500">Page {page} of {totalPages}</span>
      {page < totalPages ? <Link className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700" href={`${path}?page=${page + 1}`}>Next</Link> : <span className="px-3 py-2 text-slate-300">Next</span>}
    </nav>
  );
}
