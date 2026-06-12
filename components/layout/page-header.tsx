import { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">ExtrusionOS Pro</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-neutral-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
