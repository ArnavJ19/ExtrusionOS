import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { labelize } from "@/types/app";

export function ModuleDisabled({ moduleName, title }: { moduleName: string; title: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-72 flex-col items-center justify-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange/10 text-orange ring-1 ring-orange/20">
          <Lock className="h-6 w-6" />
        </div>
        <p className="mt-5 text-xl font-black tracking-tight text-slate-950">{title} is disabled</p>
        <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-slate-500">
          The {labelize(moduleName)} module is switched off for this company. Owner or admin users can enable it from Enterprise Foundation without changing existing data.
        </p>
        <Link href="/settings/enterprise" className="mt-5 inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">
          Open Enterprise Foundation
        </Link>
      </CardContent>
    </Card>
  );
}
