import type { PanelLayout, PanelLayoutPanel, SystemType } from "./types.ts";

export type PreviewGeometryInput = {
  realWidthMm: number;
  realHeightMm: number;
  containerWidthPx?: number;
  containerHeightPx?: number;
  paddingPx?: number;
};

export type SafePreviewGeometry = {
  scale: number;
  originX: number;
  originY: number;
  drawWidth: number;
  drawHeight: number;
  valid: boolean;
  warnings: string[];
};

export type PreviewPanelRect = {
  key: string;
  panel: PanelLayoutPanel;
  x: number;
  y: number;
  width: number;
  height: number;
  glassX: number;
  glassY: number;
  glassWidth: number;
  glassHeight: number;
  centerX: number;
  centerY: number;
};

const MIN_DIMENSION_MM = 1;
const MIN_DRAW_SIZE_PX = 80;

function safeNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanRatio(value: unknown) {
  const ratio = safeNumber(value, 0);
  return ratio > 0 ? ratio : 0;
}

export function getSafePreviewGeometry(input: PreviewGeometryInput): SafePreviewGeometry {
  const warnings: string[] = [];
  const containerWidthPx = Math.max(240, safeNumber(input.containerWidthPx, 860));
  const containerHeightPx = Math.max(220, safeNumber(input.containerHeightPx, 440));
  const paddingPx = clamp(safeNumber(input.paddingPx, 56), 16, Math.min(containerWidthPx, containerHeightPx) / 3);
  const realWidthMm = safeNumber(input.realWidthMm, 0);
  const realHeightMm = safeNumber(input.realHeightMm, 0);

  if (realWidthMm <= 0 || realHeightMm <= 0) {
    return { scale: 1, originX: containerWidthPx / 2, originY: containerHeightPx / 2, drawWidth: 0, drawHeight: 0, valid: false, warnings: ["Preview dimensions must be greater than zero."] };
  }

  const safeWidthMm = Math.max(MIN_DIMENSION_MM, realWidthMm);
  const safeHeightMm = Math.max(MIN_DIMENSION_MM, realHeightMm);
  const availableWidth = Math.max(MIN_DRAW_SIZE_PX, containerWidthPx - paddingPx * 2);
  const availableHeight = Math.max(MIN_DRAW_SIZE_PX, containerHeightPx - paddingPx * 2);
  const scale = Math.min(availableWidth / safeWidthMm, availableHeight / safeHeightMm);

  if (!Number.isFinite(scale) || scale <= 0) {
    return { scale: 1, originX: paddingPx, originY: paddingPx, drawWidth: 0, drawHeight: 0, valid: false, warnings: ["Preview scale could not be calculated."] };
  }

  let drawWidth = safeWidthMm * scale;
  let drawHeight = safeHeightMm * scale;

  if (drawWidth < MIN_DRAW_SIZE_PX && drawHeight < MIN_DRAW_SIZE_PX) {
    const boost = Math.min(availableWidth / drawWidth, availableHeight / drawHeight, Math.max(MIN_DRAW_SIZE_PX / Math.max(drawWidth, drawHeight), 1));
    drawWidth *= boost;
    drawHeight *= boost;
    warnings.push("Preview was enlarged for readability.");
  }

  return {
    scale,
    originX: (containerWidthPx - drawWidth) / 2,
    originY: (containerHeightPx - drawHeight) / 2,
    drawWidth,
    drawHeight,
    valid: true,
    warnings
  };
}

export function normalizePreviewPanels(layout: PanelLayout | null | undefined, panelCountFallback: number, systemType: SystemType): PanelLayoutPanel[] {
  const existing = Array.isArray(layout?.panels) ? layout.panels : [];
  const validExisting = existing.filter((panel) => cleanRatio(panel.widthRatio) > 0);
  if (validExisting.length) return validExisting;

  const count = clamp(Math.round(safeNumber(panelCountFallback, systemType === "three_track_sliding_window" ? 3 : systemType.includes("sliding") ? 2 : 1)), 1, 12);
  return Array.from({ length: count }, (_, index) => {
    const type = systemType.includes("sliding") ? "sliding" : systemType.includes("door") ? "door_leaf" : systemType === "fixed_window" ? "fixed" : systemType === "top_hung_window" ? "top_hung" : "casement";
    return { index: index + 1, type, function: "glass", widthRatio: 1 / count, heightRatio: 1, openingDirection: type === "sliding" ? (index % 2 === 0 ? "sliding_left" : "sliding_right") : type === "fixed" ? "fixed" : index % 2 === 0 ? "left" : "right" };
  });
}

export function buildPreviewPanelRects(panels: PanelLayoutPanel[], innerX: number, innerY: number, innerWidth: number, innerHeight: number, insetPx: number): PreviewPanelRect[] {
  const safePanels = panels.length ? panels : normalizePreviewPanels(null, 1, "fixed_window");
  const ratioTotal = safePanels.reduce((sum, panel) => sum + cleanRatio(panel.widthRatio), 0) || safePanels.length;
  let cursorX = innerX;

  return safePanels.map((panel, index) => {
    const isLast = index === safePanels.length - 1;
    const width = isLast ? Math.max(0, innerX + innerWidth - cursorX) : Math.max(0, innerWidth * (cleanRatio(panel.widthRatio) || 1 / safePanels.length) / ratioTotal);
    const x = cursorX;
    cursorX += width;
    const inset = Math.min(Math.max(4, insetPx), Math.max(4, width / 4), Math.max(4, innerHeight / 4));
    const glassX = x + inset;
    const glassY = innerY + inset;
    const glassWidth = Math.max(0, width - inset * 2);
    const glassHeight = Math.max(0, innerHeight - inset * 2);

    return { key: `${panel.index}-${panel.type}-${index}`, panel, x, y: innerY, width, height: innerHeight, glassX, glassY, glassWidth, glassHeight, centerX: x + width / 2, centerY: innerY + innerHeight / 2 };
  });
}

export function hasNaNGeometry(values: Record<string, unknown>) {
  return Object.values(values).some((value) => typeof value === "number" && !Number.isFinite(value));
}
