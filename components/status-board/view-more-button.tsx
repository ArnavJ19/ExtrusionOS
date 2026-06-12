import Link from "next/link";

export function ViewMoreButton({ href, label = "View More" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:border-orange hover:text-orange">
      {label}
    </Link>
  );
}
