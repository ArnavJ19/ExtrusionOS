"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type NumberTickerProps = {
  /** The target number to animate to */
  value: number;
  /** Duration in ms (default 800) */
  duration?: number;
  /** Decimal places (default 0) */
  decimals?: number;
  /** Prefix, e.g. "₹" */
  prefix?: string;
  /** Suffix, e.g. "%" or " kg" */
  suffix?: string;
  /** Format with Indian commas (default true) */
  formatted?: boolean;
  /** Additional className */
  className?: string;
  /** Delay before starting (ms) */
  delay?: number;
};

function formatIndian(n: number, decimals: number): string {
  const fixed = n.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  // Indian numbering: last 3, then groups of 2
  const sign = intPart.startsWith("-") ? "-" : "";
  const abs = intPart.replace("-", "");
  if (abs.length <= 3) return sign + abs + (decPart !== undefined ? "." + decPart : "");
  const last3 = abs.slice(-3);
  const rest = abs.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return sign + grouped + "," + last3 + (decPart !== undefined ? "." + decPart : "");
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function NumberTicker({ value, duration = 800, decimals = 0, prefix = "", suffix = "", formatted = true, className = "", delay = 0 }: NumberTickerProps) {
  const [display, setDisplay] = useState("0");
  const prevValue = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);
  const hasAnimated = useRef(false);
  const elRef = useRef<HTMLSpanElement>(null);

  const animate = useCallback((from: number, to: number) => {
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(progress);
      const current = from + (to - from) * eased;
      const text = formatted ? formatIndian(current, decimals) : current.toFixed(decimals);
      setDisplay(text);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevValue.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [duration, decimals, formatted]);

  // Intersection observer — animate only when in viewport
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const timer = setTimeout(() => animate(0, value), delay);
          return () => clearTimeout(timer);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []); // only on mount

  // Re-animate when value changes after initial animation
  useEffect(() => {
    if (!hasAnimated.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    animate(prevValue.current, value);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, animate]);

  return (
    <span ref={elRef} className={`tabular-nums ${className}`}>
      {prefix}{display}{suffix}
    </span>
  );
}

/**
 * Compact variant: formats large numbers as "12.4L", "3.2Cr" etc.
 */
export function CompactTicker({ value, className = "", prefix = "₹", duration = 800 }: { value: number; className?: string; prefix?: string; duration?: number }) {
  if (value >= 10_000_000) {
    return <NumberTicker value={value / 10_000_000} decimals={1} suffix=" Cr" prefix={prefix} duration={duration} className={className} />;
  }
  if (value >= 100_000) {
    return <NumberTicker value={value / 100_000} decimals={1} suffix=" L" prefix={prefix} duration={duration} className={className} />;
  }
  if (value >= 1000) {
    return <NumberTicker value={value / 1000} decimals={1} suffix="K" prefix={prefix} duration={duration} className={className} />;
  }
  return <NumberTicker value={value} prefix={prefix} duration={duration} className={className} />;
}
