import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** NOV-081: "compact" drops the product eyebrow and tightens spacing on database, create and detail routes so records start higher on the screen. */
export function PageHeader({ title, description, actions, backHref, backLabel, status, density = "default" }: { title: string; description?: string; actions?: ReactNode; backHref?: string; backLabel?: string; status?: ReactNode; density?: "default" | "compact" }) {
  const compact = density === "compact";
  return (
    <div className={`${compact ? "mb-4 gap-3" : "mb-6 gap-4"} flex flex-col sm:flex-row sm:items-end sm:justify-between`}>
      <div className="min-w-0 flex-1">
        {backHref ? <Link href={backHref} className="mb-2 inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-semibold text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"><ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />{backLabel ?? "Back to overview"}</Link> : compact ? null : <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">ExtrusionOS Pro</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className={`${compact ? "text-2xl" : "mt-1 text-3xl"} min-w-0 font-bold tracking-tight text-neutral-950 [overflow-wrap:anywhere]`}>{title}</h1>{status}</div>
        {description ? <p className={`${compact ? "mt-1" : "mt-2"} max-w-3xl text-sm font-medium leading-6 text-neutral-500`}>{description}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 [&>*]:max-w-full [&_button]:whitespace-normal [&_a]:whitespace-normal">{actions}</div> : null}
    </div>
  );
}
