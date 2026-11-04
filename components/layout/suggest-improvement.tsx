"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { suggestionSourcePath } from "@/lib/workflow/improvement";

// NOV-059: report friction from the screen where it happens. Only the page path travels with the
// suggestion; query strings and form values are never attached.
export function SuggestImprovementLink() {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/tasks/improvement/new")) return null;
  const href = `/tasks/improvement/new?${new URLSearchParams({ action: "suggestion.submit", from: suggestionSourcePath(pathname) })}`;
  return <Link href={href} title="Suggest an improvement to this screen" aria-label="Suggest an improvement to this screen"
    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-300 hover:text-neutral-950">
    <Lightbulb className="h-4 w-4" aria-hidden="true" /></Link>;
}
