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
};

export function NavLink({ href, label, icon }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const Icon = iconMap[icon];

  return (
    <Link
      href={href}
      className={cn(
        "group flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-neutral-500 transition-all duration-200 hover:bg-white hover:text-neutral-950 hover:shadow-sm lg:w-full",
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
      <span className="truncate">{label}</span>
    </Link>
  );
}
