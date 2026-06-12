import { PackageOpen } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-[20px] border border-dashed border-neutral-300 bg-white p-8 text-center shadow-inner">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-50 text-neutral-500 shadow-sm ring-1 ring-neutral-200"><PackageOpen className="h-7 w-7" /></div>
      <p className="text-base font-bold tracking-tight text-neutral-950">{title}</p>
      <p className="mt-1 max-w-md text-sm font-medium text-neutral-500">{description}</p>
    </div>
  );
}
