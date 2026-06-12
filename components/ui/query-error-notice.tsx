import { AlertTriangle } from "lucide-react";

export function QueryErrorNotice({ messages }: { messages: string[] }) {
  const uniqueMessages = Array.from(new Set(messages.filter(Boolean)));
  if (uniqueMessages.length === 0) return null;

  return (
    <div className="mb-6 rounded-3xl border border-orange/30 bg-orange/10 p-4 text-sm text-slate-800 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white text-orange ring-1 ring-orange/20">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div>
          <p className="font-black text-slate-950">Some company data could not be loaded</p>
          <p className="mt-1 font-medium text-slate-600">The page is showing available data only. Refresh or check permissions if this continues.</p>
          <div className="mt-2 space-y-1">
            {uniqueMessages.slice(0, 3).map((message) => <p key={message} className="text-xs font-semibold text-slate-600">{message}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}
