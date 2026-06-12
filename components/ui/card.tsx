"use client";

import { HTMLAttributes, useState, createContext, useContext } from "react";
import { cn } from "@/lib/utils/cn";
import { ChevronDown, ChevronRight } from "lucide-react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[20px] border border-[#eaeaea] bg-white shadow-[0_18px_45px_rgba(17,17,17,0.035)] transition-all duration-300", className)} {...props} />;
}

const CollapsibleContext = createContext<{ isExpanded: boolean; toggle: () => void } | null>(null);

export function CardHeader({ className, collapsible, isExpanded, onToggle, ...props }: HTMLAttributes<HTMLDivElement> & { collapsible?: boolean; isExpanded?: boolean; onToggle?: () => void }) {
  const ctx = useContext(CollapsibleContext);
  const _collapsible = collapsible ?? !!ctx;
  const _isExpanded = isExpanded ?? ctx?.isExpanded ?? true;
  const _onToggle = onToggle ?? ctx?.toggle;

  if (_collapsible) {
    return (
      <button 
        type="button" 
        onClick={_onToggle}
        className={cn("flex w-full items-center justify-between border-b border-neutral-100 p-5 text-left hover:bg-slate-50/50 transition-colors rounded-t-[20px]", className)} 
        {...(props as any)}
      >
        {props.children}
        <div className="ml-4 shrink-0 rounded-full bg-slate-100 p-1.5 text-slate-500 transition-transform">
          {_isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
    );
  }
  return <div className={cn("border-b border-neutral-100 p-5", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(CollapsibleContext);
  if (ctx && !ctx.isExpanded) return null;

  return <div className={cn("p-5 sm:p-6 transition-all duration-300", className)} {...props} />;
}

export function CollapsibleCard({ className, children, defaultExpanded = true, ...props }: HTMLAttributes<HTMLDivElement> & { defaultExpanded?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  return (
    <CollapsibleContext.Provider value={{ isExpanded, toggle: () => setIsExpanded(!isExpanded) }}>
      <Card className={cn("overflow-hidden h-fit", className)} {...props}>
        {children}
      </Card>
    </CollapsibleContext.Provider>
  );
}
