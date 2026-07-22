"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, LayoutDashboard } from "lucide-react";
import {
  getCurrentModule,
  getIntraModuleNeighbors,
  getModulePageLabel,
  updateIntraModuleHistory,
  type IntraModuleHistory,
  type ModuleNavigationItem,
} from "@/lib/navigation/module-navigation";

export function ModuleNavigator({ items }: { items: ModuleNavigationItem[] }) {
  const pathname = usePathname();
  const currentModule = getCurrentModule(pathname, items);
  const [histories, setHistories] = useState<Record<string, IntraModuleHistory>>({});

  if (!currentModule) return null;

  const moduleHref = currentModule.item.href;
  let history = histories[moduleHref];
  if (!history || history.entries[history.currentIndex] !== pathname) {
    history = updateIntraModuleHistory(history, moduleHref, pathname);
    setHistories({ ...histories, [moduleHref]: history });
  }

  const navigation = getIntraModuleNeighbors(history);
  const pageLabel = getModulePageLabel(pathname, currentModule);

  return (
    <nav aria-label={`${currentModule.item.label} page navigation`} className="mb-5 grid grid-cols-2 gap-2 rounded-3xl border border-neutral-200 bg-white/80 p-2 shadow-sm backdrop-blur sm:grid-cols-[1fr_auto_1fr]">
      <HistoryLink direction="previous" href={navigation.previous} moduleLabel={currentModule.item.label} />
      <Link href={currentModule.item.href} className="order-first col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-2xl px-3 py-1 text-center transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange sm:order-none sm:col-span-1">
        <LayoutDashboard className="h-4 w-4 text-neutral-400" />
        <span>
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">{currentModule.item.label}</span>
          <span className="mt-0.5 block text-xs font-semibold text-neutral-700">{pageLabel} <span className="text-neutral-400">· Module overview</span></span>
        </span>
      </Link>
      <HistoryLink direction="next" href={navigation.next} moduleLabel={currentModule.item.label} />
    </nav>
  );
}

function HistoryLink({ direction, href, moduleLabel }: { direction: "previous" | "next"; href: string | null; moduleLabel: string }) {
  const isPrevious = direction === "previous";
  const label = isPrevious ? `Previous in ${moduleLabel}` : `Next in ${moduleLabel}`;
  const alignment = isPrevious ? "justify-start text-left" : "justify-end text-right";

  if (!href) {
    return (
      <span aria-disabled="true" className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 text-neutral-300 ${alignment}`}>
        {isPrevious ? <ArrowLeft className="h-4 w-4 shrink-0" /> : null}
        <span className="text-xs font-semibold">No {direction} page in this module</span>
        {!isPrevious ? <ArrowRight className="h-4 w-4 shrink-0" /> : null}
      </span>
    );
  }

  return (
    <Link href={href} title={label} className={`group flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-neutral-950 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${alignment}`}>
      {isPrevious ? <ArrowLeft className="h-4 w-4 shrink-0 transition group-hover:-translate-x-0.5" /> : null}
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400 group-hover:text-neutral-300">{label}</span>
        <span className="block truncate text-sm font-bold">{shortPath(href)}</span>
      </span>
      {!isPrevious ? <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" /> : null}
    </Link>
  );
}

function shortPath(href: string) {
  const segment = href.split("/").filter(Boolean).at(-1) ?? "Overview";
  if (segment.length > 18 || /\d/.test(segment)) return "Previous page";
  return segment.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
