"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bot, Boxes, Building2, CalendarRange, CheckSquare, ClipboardCheck, Factory, FileArchive, FileText, FolderSearch, IndianRupee, PackageCheck, Palette, PlugZap, QrCode, Search, Settings, ShieldCheck, Shapes, Smartphone, Target, TrendingUp, Truck, Users, WandSparkles, Wrench, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const iconMap = {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  Building2,
  CalendarRange,
  CheckSquare,
  ClipboardCheck,
  Factory,
  FileArchive,
  FileText,
  FolderSearch,
  IndianRupee,
  PackageCheck,
  Palette,
  PlugZap,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Shapes,
  Smartphone,
  Target,
  TrendingUp,
  Truck,
  Users,
  WandSparkles,
  Wrench,
  Zap
};

export type NavIconName = keyof typeof iconMap;

type NavLinkProps = {
  href: string;
  label: string;
  icon: NavIconName;
  compact?: boolean;
  aliases?: string[];
};

export function NavLink({ href, label, icon, compact = false, aliases = [] }: NavLinkProps) {
  const pathname = usePathname();
  const activePaths = [href, ...aliases];
  const isActive = activePaths.some((path) => pathname === path || (path !== "/dashboard" && pathname.startsWith(`${path}/`)));
  const Icon = iconMap[icon];

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "group flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl px-2 py-2.5 text-sm font-semibold text-neutral-500 transition-all duration-200 hover:bg-white hover:text-neutral-950 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange sm:justify-start sm:px-3 lg:h-auto lg:w-full",
        isActive && "bg-white text-neutral-950 shadow-sm ring-1 ring-black/[0.04]"
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-xl bg-white/55 text-neutral-400 ring-1 ring-black/[0.04] transition-all duration-200 group-hover:bg-neutral-950 group-hover:text-white",
          isActive && "bg-neutral-950 text-white ring-neutral-950"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className={compact ? "sr-only sm:not-sr-only sm:truncate" : "truncate"}>{label}</span>
    </Link>
  );
}
