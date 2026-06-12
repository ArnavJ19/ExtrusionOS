import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-neutral-950 text-white shadow-sm hover:bg-neutral-800 hover:shadow-md",
        variant === "secondary" && "border border-neutral-200 bg-white text-neutral-950 shadow-sm hover:border-neutral-300 hover:bg-neutral-50",
        variant === "danger" && "bg-[#f43f5e] text-white shadow-sm hover:bg-rose-600",
        variant === "ghost" && "text-neutral-600 hover:bg-white hover:text-neutral-950",
        className
      )}
      {...props}
    />
  );
}
