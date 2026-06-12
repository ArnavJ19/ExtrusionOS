import test from "node:test";
import assert from "node:assert/strict";
import { buildPreviewPanelRects, getSafePreviewGeometry, hasNaNGeometry, normalizePreviewPanels } from "../preview-geometry.ts";

test("preview geometry preserves aspect ratio", () => {
  const geometry = getSafePreviewGeometry({ realWidthMm: 1500, realHeightMm: 1200, containerWidthPx: 860, containerHeightPx: 440, paddingPx: 50 });
  assert.equal(geometry.valid, true);
  assert.equal(Math.round((geometry.drawWidth / geometry.drawHeight) * 1000), Math.round((1500 / 1200) * 1000));
});

test("preview geometry handles missing and zero dimensions", () => {
  assert.equal(getSafePreviewGeometry({ realWidthMm: 0, realHeightMm: 1200 }).valid, false);
  assert.equal(getSafePreviewGeometry({ realWidthMm: 1500, realHeightMm: 0 }).valid, false);
  assert.equal(getSafePreviewGeometry({ realWidthMm: Number.NaN, realHeightMm: 1200 }).valid, false);
});

test("preview geometry handles very wide windows and tall doors", () => {
  const wide = getSafePreviewGeometry({ realWidthMm: 6000, realHeightMm: 900, containerWidthPx: 860, containerHeightPx: 440 });
  const tall = getSafePreviewGeometry({ realWidthMm: 900, realHeightMm: 2400, containerWidthPx: 860, containerHeightPx: 440 });
  assert.equal(wide.valid, true);
  assert.equal(tall.valid, true);
  assert.equal(wide.drawWidth <= 860, true);
  assert.equal(tall.drawHeight <= 440, true);
});

test("sliding panel layout sums to full width", () => {
  const panels = normalizePreviewPanels(null, 3, "three_track_sliding_window");
  const rects = buildPreviewPanelRects(panels, 100, 80, 600, 260, 18);
  const totalWidth = rects.reduce((sum, rect) => sum + rect.width, 0);
  assert.equal(Math.round(totalWidth), 600);
  assert.equal(Math.round(rects[rects.length - 1].x + rects[rects.length - 1].width), 700);
});

test("glass rectangles stay inside panels and no NaN values are returned", () => {
  const panels = normalizePreviewPanels(null, 2, "two_track_sliding_window");
  const rects = buildPreviewPanelRects(panels, 100, 80, 600, 260, 18);
  for (const rect of rects) {
    assert.equal(rect.glassX >= rect.x, true);
    assert.equal(rect.glassY >= rect.y, true);
    assert.equal(rect.glassX + rect.glassWidth <= rect.x + rect.width, true);
    assert.equal(rect.glassY + rect.glassHeight <= rect.y + rect.height, true);
    assert.equal(hasNaNGeometry(rect), false);
  }
});

test("negative dimensions are rejected", () => {
  const geometry = getSafePreviewGeometry({ realWidthMm: -1500, realHeightMm: 1200 });
  assert.equal(geometry.valid, false);
  assert.equal(geometry.warnings.length > 0, true);
});
