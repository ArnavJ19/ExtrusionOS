"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type StatusCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  badges?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function StatusCard({ title, subtitle, href, badges, meta, actions, className }: StatusCardProps) {
  const [expanded, setExpanded] = useState(false);

  const content = (
    <div className={cn("group rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:shadow-md", className)}>
      <div 
        className="flex cursor-pointer items-start justify-between gap-2"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-bold leading-snug text-neutral-950 break-words">{title}</p>
          {subtitle ? <p className="mt-1 line-clamp-2 text-xs font-medium text-neutral-500 break-words">{subtitle}</p> : null}
        </div>
        <div className="mt-0.5 shrink-0 text-neutral-400 group-hover:text-neutral-950">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </div>
      
      {badges && !expanded ? <div className="mt-2 flex flex-wrap gap-1">{badges}</div> : null}

      {expanded && (
        <div className="mt-3 animate-in fade-in slide-in-from-top-2">
          {badges ? <div className="mb-3 flex flex-wrap gap-1">{badges}</div> : null}
          {meta ? <div className="grid gap-2 text-xs font-semibold text-neutral-600">{meta}</div> : null}
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
          {href ? (
            <Link 
              href={href} 
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-100 py-1.5 text-xs font-bold text-neutral-600 transition hover:bg-neutral-950 hover:text-white"
            >
              View Details <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );

  return content;
}
