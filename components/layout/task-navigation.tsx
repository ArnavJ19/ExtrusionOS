"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ChevronDown, Ellipsis } from "lucide-react";
import { NavLink, type NavIconName } from "./nav-link";
import type { TaskNavigationModel } from "@/lib/navigation/task-navigation";

export function TaskNavigation({ model, desktopShortcuts, mobileShortcuts }: { model: TaskNavigationModel; desktopShortcuts?: React.ReactNode; mobileShortcuts?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const panelReady = panelPosition !== null;
  const panelId = "task-navigation-more";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const firstDestination = panelRef.current.querySelector<HTMLElement>('nav[aria-label="More task destinations"] a[href]');
    firstDestination?.focus();
  }, [open, panelReady]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    }
    function positionPanel() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(352, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      const openUp = !desktop || window.innerHeight - rect.bottom < 360;
      setPanelPosition({
        left,
        width,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(160, Math.min(544, rect.top - 24)) }
          : { top: rect.bottom + 8, maxHeight: Math.max(160, Math.min(544, window.innerHeight - rect.bottom - 24)) })
      });
    }
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), summary')]
      .filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      triggerRef.current?.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      const focusableOutsidePanel = [...document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.offsetParent !== null && !panelRef.current?.contains(element));
      const triggerIndex = focusableOutsidePanel.indexOf(triggerRef.current!);
      (triggerIndex >= 0 ? focusableOutsidePanel[triggerIndex + 1] : undefined)?.focus();
      setOpen(false);
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col lg:flex-none" ref={rootRef}>
      <nav aria-label="Primary task navigation" className="flex min-w-0 gap-1.5 overflow-x-auto lg:block lg:overflow-visible">
        {model.primary.map((item) => <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon as NavIconName} aliases={item.aliases} compact />)}
        {model.more.length ? (
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2.5 text-sm font-semibold text-neutral-600 shadow-sm transition hover:border-neutral-300 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange lg:mt-3 lg:min-h-10 lg:w-full lg:justify-between"
          >
            <span className="flex items-center gap-2"><Ellipsis className="h-4 w-4" /><span>More</span></span>
            <ChevronDown className={`hidden h-4 w-4 transition-transform lg:block ${open ? "rotate-180" : ""}`} />
          </button>
        ) : null}
      </nav>
      {desktopShortcuts ? <div className="hidden lg:block">{desktopShortcuts}</div> : null}
      {open && panelPosition ? createPortal(
        <div
          id={panelId}
          ref={panelRef}
          onKeyDown={handlePanelKeyDown}
          style={{ position: "fixed", left: panelPosition.left, top: panelPosition.top, bottom: panelPosition.bottom, width: panelPosition.width, maxHeight: panelPosition.maxHeight }}
          className="z-[100] overflow-y-auto rounded-3xl border border-neutral-200 bg-white p-3 shadow-2xl"
        >
          {mobileShortcuts ? <div className="mb-3 lg:hidden">{mobileShortcuts}</div> : null}
          <nav aria-label="More task destinations" className="space-y-3" onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a[href]")) setOpen(false);
          }}>
            {model.more.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">{group.label}</h2>
                <div className="space-y-1">{group.items.map((item) => <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon as NavIconName} aliases={item.aliases} />)}</div>
              </section>
            ))}
          </nav>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
