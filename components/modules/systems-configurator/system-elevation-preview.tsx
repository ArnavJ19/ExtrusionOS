import type { PanelLayout, SystemType } from "@/lib/systems-configurator/types";
import { buildPreviewPanelRects, getSafePreviewGeometry, normalizePreviewPanels } from "@/lib/systems-configurator/preview-geometry";

type SystemElevationPreviewProps = {
  realWidthMm: number;
  realHeightMm: number;
  systemType?: SystemType | string | null;
  panelLayout?: PanelLayout | null;
  panelCount?: number;
  trackCount?: number;
  designReference?: string | null;
  viewDirection?: string | null;
  className?: string;
};

const VIEWBOX_WIDTH = 920;
const VIEWBOX_HEIGHT = 560;
const DRAW_AREA_WIDTH = 820;
const DRAW_AREA_HEIGHT = 390;
const DRAW_AREA_OFFSET_X = 50;
const DRAW_AREA_OFFSET_Y = 62;

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function titleize(value?: string | null) {
  return (value ?? "system").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function Arrow({ x, y, width, height, direction }: { x: number; y: number; width: number; height: number; direction?: string }) {
  const horizontal = direction?.includes("sliding");
  if (!horizontal) {
    const leftHinged = direction === "left";
    const startX = leftHinged ? x + 14 : x + width - 14;
    const endX = leftHinged ? x + width - 18 : x + 18;
    return <path d={`M${startX} ${y + 16} L${endX} ${y + height - 18} Q${x + width / 2} ${y + height * 0.18} ${endX} ${y + 20}`} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />;
  }

  const left = direction === "sliding_left";
  const yMid = y + height * (left ? 0.68 : 0.32);
  const start = left ? x + width - 22 : x + 22;
  const end = left ? x + 22 : x + width - 22;
  const head = left ? 1 : -1;
  return <path d={`M${start} ${yMid} L${end} ${yMid} M${end} ${yMid} L${end + head * 12} ${yMid - 9} M${end} ${yMid} L${end + head * 12} ${yMid + 9}`} fill="none" stroke="#f97316" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />;
}

export function SystemElevationPreview({ realWidthMm, realHeightMm, systemType, panelLayout, panelCount = 1, trackCount = 1, designReference, viewDirection, className }: SystemElevationPreviewProps) {
  const widthMm = safeNumber(realWidthMm);
  const heightMm = safeNumber(realHeightMm);
  const normalizedSystemType = (systemType || "custom") as SystemType;
  const geometry = getSafePreviewGeometry({ realWidthMm: widthMm, realHeightMm: heightMm, containerWidthPx: DRAW_AREA_WIDTH, containerHeightPx: DRAW_AREA_HEIGHT, paddingPx: 26 });

  if (!systemType) return <PreviewState className={className} title="Select a system type to generate the elevation preview." />;
  if (widthMm <= 0 || heightMm <= 0 || !geometry.valid) return <PreviewState className={className} title="Preview cannot be generated because dimensions are invalid." subtitle="Enter width and height greater than 0 mm." />;

  const originX = DRAW_AREA_OFFSET_X + geometry.originX;
  const originY = DRAW_AREA_OFFSET_Y + geometry.originY;
  const frameThickness = clamp(Math.min(geometry.drawWidth, geometry.drawHeight) * 0.055, 10, 24);
  const innerX = originX + frameThickness;
  const innerY = originY + frameThickness;
  const innerWidth = Math.max(1, geometry.drawWidth - frameThickness * 2);
  const innerHeight = Math.max(1, geometry.drawHeight - frameThickness * 2);
  const panels = normalizePreviewPanels(panelLayout, panelCount, normalizedSystemType);
  const glassInset = clamp(Math.min(innerWidth, innerHeight) * 0.07, 10, 24);
  const panelRects = buildPreviewPanelRects(panels, innerX, innerY, innerWidth, innerHeight, glassInset);
  const mullions = Array.isArray(panelLayout?.mullions) ? panelLayout.mullions : [];
  const transoms = Array.isArray(panelLayout?.transoms) ? panelLayout.transoms : [];
  const isSliding = normalizedSystemType.includes("sliding");
  const isDoor = normalizedSystemType.includes("door");
  const isFixed = normalizedSystemType === "fixed_window";
  const dimensionY = Math.min(VIEWBOX_HEIGHT - 58, originY + geometry.drawHeight + 44);
  const dimensionX = Math.min(VIEWBOX_WIDTH - 46, originX + geometry.drawWidth + 42);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} className="h-full min-h-[280px] w-full" role="img" aria-label={`${titleize(normalizedSystemType)} elevation preview`}>
        <defs>
          <linearGradient id="systemGlass" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stopColor="#eef7ff" /><stop offset="100%" stopColor="#cfe8f7" /></linearGradient>
          <pattern id="meshHatch" patternUnits="userSpaceOnUse" width="10" height="10"><path d="M0 10 L10 0 M-2 2 L2 -2 M8 12 L12 8" stroke="#94a3b8" strokeWidth="1" opacity="0.55" /></pattern>
          <filter id="softFrameShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.12" /></filter>
        </defs>

        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} rx="28" fill="#f8fafc" />
        <rect x={originX} y={originY} width={geometry.drawWidth} height={geometry.drawHeight} rx="6" fill="#d1d5db" stroke="#0f172a" strokeWidth="2" filter="url(#softFrameShadow)" />
        <rect x={innerX} y={innerY} width={innerWidth} height={innerHeight} rx="3" fill="#f1f5f9" stroke="#475569" strokeWidth="1.5" />

        {isSliding ? Array.from({ length: Math.max(1, Math.round(safeNumber(trackCount, 1))) }).map((_, index) => {
          const y = innerY + innerHeight - 10 - index * 9;
          return <line key={`track-${index}`} x1={innerX + 8} y1={y} x2={innerX + innerWidth - 8} y2={y} stroke="#64748b" strokeWidth="2" opacity="0.5" />;
        }) : null}

        {panelRects.map((rect, index) => {
          const mesh = rect.panel.function === "mesh" || rect.panel.type === "mesh";
          const openable = !isFixed && rect.panel.type !== "fixed" && !mesh;
          return (
            <g key={rect.key}>
              {index > 0 ? <rect x={rect.x - 3} y={innerY - 4} width="6" height={innerHeight + 8} rx="2" fill="#475569" /> : null}
              <rect x={rect.x + 3} y={rect.y + 3} width={Math.max(0, rect.width - 6)} height={Math.max(0, rect.height - 6)} rx="4" fill="#e5e7eb" stroke="#64748b" strokeWidth="2" />
              <rect x={rect.x + 9} y={rect.y + 9} width={Math.max(0, rect.width - 18)} height={Math.max(0, rect.height - 18)} rx="3" fill="none" stroke="#cbd5e1" strokeWidth="2" />
              <rect x={rect.glassX} y={rect.glassY} width={rect.glassWidth} height={rect.glassHeight} rx="3" fill={mesh ? "url(#meshHatch)" : "url(#systemGlass)"} stroke="#94a3b8" strokeWidth="1.5" />
              <rect x={rect.glassX + 5} y={rect.glassY + 5} width={Math.max(0, rect.glassWidth - 10)} height={Math.max(0, rect.glassHeight - 10)} rx="2" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.8" />
              {mesh ? <rect x={rect.glassX} y={rect.glassY} width={rect.glassWidth} height={rect.glassHeight} rx="3" fill="none" stroke="#64748b" strokeDasharray="4 4" strokeWidth="1" /> : null}
              {isSliding && index > 0 ? <rect x={rect.x - 5} y={rect.y + 10} width="10" height={rect.height - 20} rx="3" fill="#334155" opacity="0.82" /> : null}
              {openable ? <Arrow x={rect.glassX} y={rect.glassY} width={rect.glassWidth} height={rect.glassHeight} direction={rect.panel.openingDirection} /> : null}
              {isDoor && openable ? <circle cx={rect.x + rect.width * 0.78} cy={rect.y + rect.height * 0.52} r="5" fill="#f97316" stroke="#7c2d12" strokeWidth="1" /> : null}
              <text x={rect.centerX} y={rect.centerY + 5} textAnchor="middle" fontSize="18" fontWeight="800" fill="#334155" opacity="0.78">P{rect.panel.index}</text>
            </g>
          );
        })}

        {mullions.map((mullion, index) => {
          const x = innerX + innerWidth * clamp(safeNumber(mullion.xRatio, 0), 0, 1);
          return <rect key={`mullion-${mullion.index ?? index}`} x={x - 4} y={innerY - 2} width="8" height={innerHeight + 4} rx="2" fill="#334155" opacity="0.86" />;
        })}
        {transoms.map((transom, index) => {
          const y = innerY + innerHeight * clamp(safeNumber(transom.yRatio, 0), 0, 1);
          return <rect key={`transom-${transom.index ?? index}`} x={innerX - 2} y={y - 4} width={innerWidth + 4} height="8" rx="2" fill="#334155" opacity="0.86" />;
        })}

        {isDoor ? <rect x={originX} y={originY + geometry.drawHeight - frameThickness * 0.65} width={geometry.drawWidth} height={frameThickness * 0.65} fill="#64748b" opacity="0.9" /> : null}

        <DimensionLine x1={originX} y1={dimensionY} x2={originX + geometry.drawWidth} y2={dimensionY} label={`${Math.round(widthMm)} mm`} horizontal />
        <DimensionLine x1={dimensionX} y1={originY} x2={dimensionX} y2={originY + geometry.drawHeight} label={`${Math.round(heightMm)} mm`} />

        <text x="34" y="38" fontSize="16" fontWeight="900" fill="#0f172a">{designReference || "Elevation"}</text>
        <text x="34" y="60" fontSize="12" fontWeight="700" fill="#64748b">{titleize(normalizedSystemType)} · {titleize(viewDirection || "inside_view")}</text>
      </svg>
      {geometry.warnings.length ? <p className="mt-2 text-xs font-semibold text-amber-700">{geometry.warnings.join(" ")}</p> : null}
    </div>
  );
}

function DimensionLine({ x1, y1, x2, y2, label, horizontal = false }: { x1: number; y1: number; x2: number; y2: number; label: string; horizontal?: boolean }) {
  const labelX = (x1 + x2) / 2;
  const labelY = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#64748b" strokeWidth="1.5" />
      {horizontal ? <><line x1={x1} y1={y1 - 8} x2={x1} y2={y1 + 8} stroke="#64748b" strokeWidth="1.5" /><line x1={x2} y1={y2 - 8} x2={x2} y2={y2 + 8} stroke="#64748b" strokeWidth="1.5" /><text x={labelX} y={y1 + 24} textAnchor="middle" fontSize="14" fontWeight="900" fill="#0f172a">{label}</text></> : <><line x1={x1 - 8} y1={y1} x2={x1 + 8} y2={y1} stroke="#64748b" strokeWidth="1.5" /><line x1={x2 - 8} y1={y2} x2={x2 + 8} y2={y2} stroke="#64748b" strokeWidth="1.5" /><text x={labelX + 23} y={labelY} textAnchor="middle" fontSize="14" fontWeight="900" fill="#0f172a" transform={`rotate(90 ${labelX + 23} ${labelY})`}>{label}</text></>}
    </g>
  );
}

function PreviewState({ title, subtitle, className }: { title: string; subtitle?: string; className?: string }) {
  return <div className={`flex min-h-[280px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center ${className ?? ""}`}><div><p className="text-sm font-black text-slate-800">{title}</p>{subtitle ? <p className="mt-2 text-sm font-semibold text-slate-500">{subtitle}</p> : null}</div></div>;
}
