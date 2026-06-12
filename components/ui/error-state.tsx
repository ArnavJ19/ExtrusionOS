import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title?: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
};

export function ErrorState({ title = "Could not load data", description = "Something went wrong while fetching this page. Please try again.", retryLabel = "Retry", onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-[20px] border border-red-200 bg-red-50/70 p-8 text-center shadow-inner">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-red-600 shadow-sm ring-1 ring-red-200">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <p className="text-base font-bold tracking-tight text-neutral-950">{title}</p>
      <p className="mt-1 max-w-md text-sm font-medium text-neutral-600">{description}</p>
      {onRetry ? <Button className="mt-5" type="button" variant="secondary" onClick={onRetry}>{retryLabel}</Button> : null}
    </div>
  );
}
