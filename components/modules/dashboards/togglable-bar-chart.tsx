"use client";

import React, { useMemo, useState } from "react";
import { Maximize2, X, Calendar, BarChart3 } from "lucide-react";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils/format";

type DataPoint = { date: string; value: number };

type Props = {
  data: DataPoint[];
  title: string;
  subtitle?: string;
  valueType: "currency" | "weight" | "count";
  color?: string;
  hoverColor?: string;
};

export function TogglableBarChart({ data, title, subtitle, valueType, color = "#4f46e5", hoverColor = "#6366f1" }: Props) {
  const [view, setView] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [isEnlarged, setIsEnlarged] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Group data
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const grouped: Record<string, { key: string; label: string; value: number; timestamp: number }> = {};

    data.forEach((item) => {
      if (!item.date) return;
      const date = new Date(item.date);
      if (isNaN(date.getTime())) return;

      let groupKey = "";
      let label = "";
      let timestamp = 0;

      if (view === "weekly") {
        // Get Monday of the week
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(date.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        
        groupKey = monday.toISOString().slice(0, 10);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        label = `${monday.getDate()} ${months[monday.getMonth()]}`;
        timestamp = monday.getTime();
      } else if (view === "monthly") {
        const year = date.getFullYear();
        const month = date.getMonth();
        groupKey = `${year}-${String(month + 1).padStart(2, "0")}`;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        label = `${months[month]} ${String(year).slice(-2)}`;
        timestamp = new Date(year, month, 1).getTime();
      } else {
        const year = date.getFullYear();
        groupKey = String(year);
        label = String(year);
        timestamp = new Date(year, 0, 1).getTime();
      }

      if (!grouped[groupKey]) {
        grouped[groupKey] = { key: groupKey, label, value: 0, timestamp };
      }
      grouped[groupKey].value += Number(item.value ?? 0);
    });

    const sorted = Object.values(grouped).sort((a, b) => a.timestamp - b.timestamp);

    // Limit standard view to keep it clean, enlarged view shows all
    if (!isEnlarged) {
      if (view === "weekly") return sorted.slice(-10);
      if (view === "monthly") return sorted.slice(-12);
      return sorted.slice(-5);
    }
    return sorted;
  }, [data, view, isEnlarged]);

  const maxValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    const max = Math.max(...chartData.map((d) => d.value));
    return max === 0 ? 100 : max * 1.15; // 15% padding on top
  }, [chartData]);

  const formatValue = (val: number, compact = false) => {
    if (valueType === "currency") {
      return compact ? formatCompactCurrency(val) : formatCurrency(val);
    }
    if (valueType === "weight") {
      return compact 
        ? `${(val / 1000).toFixed(1)} MT` 
        : `${Math.round(val).toLocaleString("en-IN")} kg`;
    }
    return val.toLocaleString("en-IN");
  };

  const renderChartBody = (height: number) => {
    const width = 600; // base width for SVG viewBox
    const paddingLeft = 62;
    const paddingRight = 22;
    const paddingTop = 25;
    const paddingBottom = 35;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const visibleSlots = Math.max(chartData.length, isEnlarged ? 8 : 6);
    const slotWidth = chartWidth / visibleSlots;
    const barWidth = chartData.length > 0 ? Math.min(slotWidth * 0.64, isEnlarged ? 54 : 48) : 20;
    const startOffset = (chartWidth - slotWidth * chartData.length) / 2;

    // Y ticks
    const yTicks = 4;
    const yTickValues = Array.from({ length: yTicks + 1 }).map((_, i) => (maxValue / yTicks) * i);

    return (
      <div className="relative h-full w-full select-none">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="none" className="overflow-visible">
          {/* Horizontal Gridlines */}
          {yTickValues.map((val, i) => {
            const y = height - paddingBottom - (val / maxValue) * chartHeight;
            return (
              <g key={i}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                <text x={paddingLeft - 8} y={y + 4} textAnchor="end" className="text-[10px] font-medium fill-slate-400 font-sans">
                  {formatValue(val, true)}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {chartData.map((d, index) => {
            const barHeight = (d.value / maxValue) * chartHeight;
            const x = paddingLeft + startOffset + index * slotWidth + (slotWidth - barWidth) / 2;
            const y = height - paddingBottom - barHeight;

            const isHovered = hoveredIndex === index;

            return (
              <g key={d.key}>
                {/* Visual bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 2)}
                  rx={Math.min(barWidth / 3, 5)}
                  fill={isHovered ? hoverColor : color}
                  className="transition-all duration-200 cursor-pointer ease-out"
                  onMouseEnter={() => {
                    setTooltipPos({ x: ((x + barWidth / 2) / width) * 100, y: (y / height) * 100 });
                    setHoveredIndex(index);
                  }}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
                
                {/* X axis Label */}
                <text
                  x={x + barWidth / 2}
                  y={height - paddingBottom + 16}
                  textAnchor="middle"
                  className="text-[9px] font-semibold fill-slate-500 font-sans"
                >
                  {d.label}
                </text>
              </g>
            );
          })}

          {/* X-axis base line */}
          <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} stroke="#e2e8f0" strokeWidth="1.5" />
        </svg>

        {/* Custom Tooltip */}
        {hoveredIndex !== null && chartData[hoveredIndex] && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-lg transition-all duration-150 ease-out"
            style={{ left: `${tooltipPos.x}%`, top: `${tooltipPos.y}%` }}
          >
            <div className="text-[10px] text-slate-400 font-bold mb-0.5">{chartData[hoveredIndex].label}</div>
            <div className="text-sm font-extrabold font-mono">{formatValue(chartData[hoveredIndex].value)}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-[24px] border border-[#eaeaea] bg-white p-5 shadow-[0_18px_45px_rgba(17,17,17,0.035)]">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4.5 w-4.5 text-slate-500" />
            <h3 className="text-sm font-bold tracking-tight text-neutral-800">{title}</h3>
          </div>
          {subtitle && <p className="text-xs font-medium text-neutral-400 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* View selectors */}
          <div className="flex items-center rounded-xl bg-slate-50 p-1 border border-slate-100">
            {(["weekly", "monthly", "yearly"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition capitalize ${
                  view === v
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Enlarge button */}
          <button
            onClick={() => setIsEnlarged(true)}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50"
            title="Enlarge Chart"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chart container */}
      <div className="h-[220px] w-full flex items-center justify-center">
        {chartData.length > 0 ? (
          renderChartBody(220)
        ) : (
          <div className="text-xs font-semibold text-slate-400 flex flex-col items-center gap-2 py-8">
            <Calendar className="h-6 w-6 text-slate-300" />
            No transaction data available
          </div>
        )}
      </div>

      {/* Enlarged modal */}
      {isEnlarged && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 md:p-8 animate-in fade-in duration-200">
          <div 
            className="relative w-full max-w-4xl rounded-[28px] border border-[#eaeaea] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <div>
                <h3 className="text-lg font-black text-neutral-900">{title}</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1">Full Historical Analysis ({view} breakdown)</p>
              </div>
              <div className="flex items-center gap-3">
                {/* View selectors */}
                <div className="flex items-center rounded-xl bg-slate-50 p-1 border border-slate-100">
                  {(["weekly", "monthly", "yearly"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`rounded-lg px-3 py-1 text-xs font-bold transition capitalize ${
                        view === v
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setIsEnlarged(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            {/* Modal Chart body */}
            <div className="h-[400px] w-full flex items-center justify-center">
              {chartData.length > 0 ? (
                renderChartBody(400)
              ) : (
                <div className="text-xs font-semibold text-slate-400 py-16">
                  No transaction data available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
