"use client";

import { useEffect, useRef, useState } from "react";

/** Measure the existing shell so sticky controls also work with enlarged text. */
export function useWorkAreaOffsets() {
  const ref = useRef<HTMLDivElement>(null);
  const [offsets, setOffsets] = useState({ top: 0, bottom: 0, compactViewport: false });
  useEffect(() => {
    const main = ref.current?.closest("main");
    const header = main?.querySelector(":scope > header");
    const nav = main?.parentElement?.querySelector(":scope > aside");
    const update = () => {
      const viewport = window.visualViewport;
      const keyboard = Boolean(viewport && window.innerHeight - viewport.height > 150);
      const height = viewport?.height ?? window.innerHeight;
      setOffsets({
        top: header?.getBoundingClientRect().height ?? 0,
        bottom: window.matchMedia("(min-width: 1024px)").matches ? 0 : nav?.getBoundingClientRect().height ?? 0,
        compactViewport: keyboard || height < 500
      });
    };
    const observer = new ResizeObserver(update);
    if (header) observer.observe(header);
    if (nav) observer.observe(nav);
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, []);
  return { ref, ...offsets };
}
