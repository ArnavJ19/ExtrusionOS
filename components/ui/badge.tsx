import { cn } from "@/lib/utils/cn";
import { CheckCircle2, Circle, Clock3, LoaderCircle, OctagonAlert } from "lucide-react";
import { getStatusPresentation } from "@/lib/ui/status-presentation";

const icons = { neutral: Circle, active: LoaderCircle, waiting: Clock3, blocked: OctagonAlert, completed: CheckCircle2 };

export function Badge({ value, className }: { value: string; className?: string }) {
  const presentation = getStatusPresentation(value);
  const Icon = icons[presentation.family];
  return <span data-status={value} data-status-family={presentation.family} className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide", presentation.className, className)}><Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="[overflow-wrap:anywhere]">{presentation.labelText}</span></span>;
}
