import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";

type DataPageLayoutProps = {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function DataPageLayout({ title, description, backHref, backLabel, actions, children }: DataPageLayoutProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href={backHref} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 transition hover:text-neutral-950">
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-950">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-neutral-500">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <Card className="overflow-hidden">{children}</Card>
    </div>
  );
}
