import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

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
      <PageHeader title={title} description={description} backHref={backHref} backLabel={backLabel} actions={actions} />
      <Card className="overflow-hidden">{children}</Card>
    </div>
  );
}
