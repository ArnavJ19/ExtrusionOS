// AP-048: reads the closed outlines of an extrusion profile from a DXF drawing (in-house; no dependency). Supported:
// LWPOLYLINE (with arc bulges), POLYLINE/VERTEX, LINE, ARC and CIRCLE in the ENTITIES section. Loose lines and arcs are
// joined end to end into loops. Loops are nested: the outermost loop is the section, loops inside it are voids, loops
// inside a void are material again. The net area (mm²) and the outer perimeter (mm) are returned; kg/m is area x alloy
// density, computed in the database from the alloy master. Anything that cannot be read stays null with a warning.

export type Point = { x: number; y: number };
export type Segment = { a: Point; b: Point; bulge: number };
export type Loop = { segments: Segment[]; area: number; perimeter: number; depth: number; bbox: [number, number, number, number] };
export type DxfGeometry = {
  units: "mm" | "inch" | "unknown"; outer_area_mm2: number; void_area_mm2: number; net_area_mm2: number; outer_perimeter_mm: number;
  void_count: number; loop_count: number; entity_count: number; warnings: string[]; loops: Loop[];
};
export type DxfResult = { ok: true; geometry: DxfGeometry } | { ok: false; error: string; warnings: string[]; entity_count: number };

const TOLERANCE = 0.01; // mm: endpoints closer than this are the same point

/** Group-code/value pairs of a DXF text file. */
export function dxfPairs(text: string): [number, string][] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) return [];
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

function headerUnits(pairs: [number, string][]): number | null {
  const at = pairs.findIndex(([code, value]) => code === 9 && value === "$INSUNITS");
  if (at < 0) return null;
  const next = pairs.slice(at + 1, at + 3).find(([code]) => code === 70);
  return next ? Number(next[1]) : null;
}

function arcSegment(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Segment {
  let sweep = (endDeg - startDeg) % 360;
  if (sweep <= 0) sweep += 360;
  const s = (startDeg * Math.PI) / 180, e = (endDeg * Math.PI) / 180;
  return { a: { x: cx + r * Math.cos(s), y: cy + r * Math.sin(s) }, b: { x: cx + r * Math.cos(e), y: cy + r * Math.sin(e) }, bulge: Math.tan((sweep * Math.PI) / 180 / 4) };
}

type Raw = { closedLoops: Segment[][]; loose: Segment[]; entityCount: number; unsupported: Set<string> };

function readEntities(pairs: [number, string][]): Raw {
  const out: Raw = { closedLoops: [], loose: [], entityCount: 0, unsupported: new Set() };
  const start = pairs.findIndex(([code, value], i) => code === 0 && value === "SECTION" && pairs[i + 1]?.[0] === 2 && pairs[i + 1]?.[1] === "ENTITIES");
  if (start < 0) return out;
  let i = start + 2;
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "ENDSEC") break;
    if (code !== 0) { i++; continue; }
    const type = value; const body: [number, string][] = [];
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) { body.push(pairs[i]); i++; }
    out.entityCount++;
    const get = (c: number) => { const f = body.find(([k]) => k === c); return f ? num(f[1]) : NaN; };
    if (type === "LINE") {
      out.loose.push({ a: { x: get(10), y: get(20) }, b: { x: get(11), y: get(21) }, bulge: 0 });
    } else if (type === "ARC") {
      out.loose.push(arcSegment(get(10), get(20), get(40), get(50), get(51)));
    } else if (type === "CIRCLE") {
      const cx = get(10), cy = get(20), r = get(40);
      out.closedLoops.push([{ a: { x: cx + r, y: cy }, b: { x: cx - r, y: cy }, bulge: 1 }, { a: { x: cx - r, y: cy }, b: { x: cx + r, y: cy }, bulge: 1 }]);
    } else if (type === "LWPOLYLINE") {
      const closed = (get(70) & 1) === 1; const vertices: { p: Point; bulge: number }[] = [];
      for (const [k, v] of body) {
        if (k === 10) vertices.push({ p: { x: num(v), y: NaN }, bulge: 0 });
        else if (k === 20 && vertices.length) vertices[vertices.length - 1].p.y = num(v);
        else if (k === 42 && vertices.length) vertices[vertices.length - 1].bulge = num(v);
      }
      pushPolyline(out, vertices, closed);
    } else if (type === "POLYLINE") {
      const closed = (get(70) & 1) === 1; const vertices: { p: Point; bulge: number }[] = [];
      while (i < pairs.length && pairs[i][0] === 0 && pairs[i][1] === "VERTEX") {
        i++; const v: [number, string][] = [];
        while (i < pairs.length && pairs[i][0] !== 0) { v.push(pairs[i]); i++; }
        const g = (c: number) => { const f = v.find(([k]) => k === c); return f ? num(f[1]) : NaN; };
        vertices.push({ p: { x: g(10), y: g(20) }, bulge: Number.isFinite(g(42)) ? g(42) : 0 });
      }
      if (i < pairs.length && pairs[i][1] === "SEQEND") { i++; while (i < pairs.length && pairs[i][0] !== 0) i++; }
      pushPolyline(out, vertices, closed);
    } else if (!["TEXT", "MTEXT", "DIMENSION", "HATCH", "POINT", "LEADER", "MLEADER", "ATTDEF", "VIEWPORT"].includes(type)) {
      out.unsupported.add(type);
    }
  }
  return out;
}

function pushPolyline(out: Raw, vertices: { p: Point; bulge: number }[], closed: boolean) {
  const good = vertices.filter(v => Number.isFinite(v.p.x) && Number.isFinite(v.p.y));
  if (good.length < 2) return;
  const segments: Segment[] = [];
  for (let k = 0; k < good.length - 1; k++) segments.push({ a: good[k].p, b: good[k + 1].p, bulge: good[k].bulge || 0 });
  const first = good[0].p, last = good[good.length - 1].p;
  if (closed && dist(first, last) > TOLERANCE) segments.push({ a: last, b: first, bulge: good[good.length - 1].bulge || 0 });
  if (closed || dist(first, last) <= TOLERANCE) out.closedLoops.push(segments);
  else out.loose.push(...segments);
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
const reverse = (s: Segment): Segment => ({ a: s.b, b: s.a, bulge: -s.bulge });

/** Joins loose segments end to end into closed loops; returns the loops and how many segments were left open. */
export function chainSegments(loose: Segment[]): { loops: Segment[][]; open: number } {
  const remaining = loose.filter(s => [s.a.x, s.a.y, s.b.x, s.b.y, s.bulge].every(Number.isFinite) && dist(s.a, s.b) > 1e-9);
  const loops: Segment[][] = []; let open = 0;
  while (remaining.length) {
    const chain = [remaining.shift()!];
    let grew = true;
    while (grew && dist(chain[0].a, chain[chain.length - 1].b) > TOLERANCE) {
      grew = false;
      const end = chain[chain.length - 1].b;
      for (let k = 0; k < remaining.length; k++) {
        const s = remaining[k];
        if (dist(s.a, end) <= TOLERANCE) { chain.push(s); remaining.splice(k, 1); grew = true; break; }
        if (dist(s.b, end) <= TOLERANCE) { chain.push(reverse(s)); remaining.splice(k, 1); grew = true; break; }
      }
    }
    if (dist(chain[0].a, chain[chain.length - 1].b) <= TOLERANCE) loops.push(chain); else open += chain.length;
  }
  return { loops, open };
}

/** Signed area (counter-clockwise positive) and length of a loop, arcs included exactly. */
export function loopMeasure(segments: Segment[]): { area: number; perimeter: number } {
  let area = 0, perimeter = 0;
  for (const s of segments) {
    area += (s.a.x * s.b.y - s.b.x * s.a.y) / 2;
    const chord = dist(s.a, s.b);
    if (!s.bulge) { perimeter += chord; continue; }
    const theta = 4 * Math.atan(Math.abs(s.bulge));
    const r = chord / (2 * Math.sin(theta / 2));
    area += Math.sign(s.bulge) * (r * r * (theta - Math.sin(theta))) / 2;
    perimeter += r * theta;
  }
  return { area, perimeter };
}

/** Points along a loop (arcs flattened) for containment tests and the preview. */
export function flatten(segments: Segment[], steps = 12): Point[] {
  const points: Point[] = [];
  for (const s of segments) {
    points.push(s.a);
    if (!s.bulge) continue;
    const theta = 4 * Math.atan(s.bulge);
    const chord = dist(s.a, s.b), r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // The centre sits on the chord's left normal at (chord / 2)(1 - b²) / (2b) from its midpoint (negative: to the right).
    const offset = (chord / 2) * (1 - s.bulge * s.bulge) / (2 * s.bulge);
    const nx = -(s.b.y - s.a.y) / chord, ny = (s.b.x - s.a.x) / chord;
    const cx = (s.a.x + s.b.x) / 2 + nx * offset, cy = (s.a.y + s.b.y) / 2 + ny * offset;
    const start = Math.atan2(s.a.y - cy, s.a.x - cx);
    for (let k = 1; k < steps; k++) {
      const angle = start + (theta * k) / steps;
      points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
  }
  return points;
}

function inside(point: Point, polygon: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function isRectangle(segments: Segment[]) {
  if (segments.length !== 4 || segments.some(s => s.bulge)) return false;
  return segments.every(s => Math.abs(s.a.x - s.b.x) < TOLERANCE || Math.abs(s.a.y - s.b.y) < TOLERANCE);
}

export function readDxf(text: string): DxfResult {
  const pairs = dxfPairs(text);
  if (!pairs.length) return { ok: false, error: "This file is not a text DXF drawing. Export the section as DXF (ASCII).", warnings: [], entity_count: 0 };
  const warnings: string[] = [];
  const unitCode = headerUnits(pairs);
  const units: DxfGeometry["units"] = unitCode === 4 ? "mm" : unitCode === 1 ? "inch" : "unknown";
  const scale = unitCode === 1 ? 25.4 : unitCode === 5 ? 10 : unitCode === 6 ? 1000 : 1;
  if (unitCode !== 4 && unitCode !== 1 && unitCode !== 5 && unitCode !== 6) warnings.push("The drawing does not record its units; it was read as millimetres.");
  const raw = readEntities(pairs);
  if (raw.unsupported.has("INSERT")) warnings.push("The drawing uses blocks (INSERT); outlines inside blocks were not read. Explode blocks before exporting.");
  for (const type of raw.unsupported) if (type !== "INSERT") warnings.push(`${type} entities were ignored.`);
  const chained = chainSegments(raw.loose);
  if (chained.open) warnings.push(`${chained.open} line or arc segment(s) do not close into an outline and were ignored.`);
  const scaled = [...raw.closedLoops, ...chained.loops].map(loop => loop.map(s => ({ a: { x: s.a.x * scale, y: s.a.y * scale }, b: { x: s.b.x * scale, y: s.b.y * scale }, bulge: s.bulge })));
  const valid = scaled.filter(loop => loop.every(s => [s.a.x, s.a.y, s.b.x, s.b.y, s.bulge].every(Number.isFinite)));
  if (!valid.length) return { ok: false, error: "No closed outline was found in the drawing.", warnings, entity_count: raw.entityCount };
  let loops: Loop[] = valid.map(segments => {
    const m = loopMeasure(segments); const pts = flatten(segments);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { segments, area: Math.abs(m.area), perimeter: m.perimeter, depth: 0, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as Loop["bbox"] };
  }).filter(l => l.area > 1e-6);
  const flat = loops.map(l => flatten(l.segments));
  loops.forEach((loop, k) => { loop.depth = loops.filter((other, m) => m !== k && other.area > loop.area && inside(flat[k][0], flat[m])).length; });
  // A drawing frame: one rectangle around everything, with outlines two levels down. It is ignored, with a warning.
  const top = loops.filter(l => l.depth === 0);
  const innerShare = top.length === 1 ? loops.filter(l => l.depth === 1).reduce((sum, l) => sum + l.area, 0) / top[0].area : 1;
  // A hollow section's void fills most of its outline; a drawing frame holds a small section well inside it.
  if (top.length === 1 && isRectangle(top[0].segments) && loops.some(l => l.depth === 1) && (innerShare < 0.15 || (innerShare < 0.5 && loops.some(l => l.depth >= 2)))) {
    warnings.push("A rectangular frame around the section was taken as the drawing border and ignored. Check the preview.");
    loops = loops.filter(l => l !== top[0]).map(l => ({ ...l, depth: l.depth - 1 }));
  }
  const outers = loops.filter(l => l.depth === 0);
  if (outers.length > 1) warnings.push(`${outers.length} separate outlines were found and added together. If the drawing shows more than one view, keep only the section.`);
  const outerArea = loops.filter(l => l.depth % 2 === 0).reduce((sum, l) => sum + l.area, 0);
  const voidArea = loops.filter(l => l.depth % 2 === 1).reduce((sum, l) => sum + l.area, 0);
  const net = outerArea - voidArea;
  if (net <= 0) return { ok: false, error: "The outlines do not enclose any material.", warnings, entity_count: raw.entityCount };
  const perimeter = outers.reduce((sum, l) => sum + l.perimeter, 0);
  const width = Math.max(...outers.map(l => l.bbox[2])) - Math.min(...outers.map(l => l.bbox[0]));
  if (units === "unknown" && (width > 1000 || width < 2)) warnings.push(`The section is ${round(width, 1)} mm wide when read as millimetres; check the drawing units.`);
  return { ok: true, geometry: { units, outer_area_mm2: round(outerArea, 4), void_area_mm2: round(voidArea, 4), net_area_mm2: round(net, 4), outer_perimeter_mm: round(perimeter, 4),
    void_count: loops.filter(l => l.depth % 2 === 1).length, loop_count: loops.length, entity_count: raw.entityCount, warnings, loops } };
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Theoretical kg/m from net area (mm²) and density (kg/m³), as the database computes it. */
export function kgPerMetre(netAreaMm2: number, densityKgM3: number): number {
  return round(netAreaMm2 * 1e-6 * densityKgM3, 4);
}

/** A small SVG of the outlines (material grey, voids white), y axis up as in the drawing. */
export function geometrySvg(geometry: Pick<DxfGeometry, "loops">, size = 320): string {
  const loops = geometry.loops;
  if (!loops.length) return "";
  const minX = Math.min(...loops.map(l => l.bbox[0])), minY = Math.min(...loops.map(l => l.bbox[1]));
  const maxX = Math.max(...loops.map(l => l.bbox[2])), maxY = Math.max(...loops.map(l => l.bbox[3]));
  const span = Math.max(maxX - minX, maxY - minY) || 1, pad = span * 0.05;
  const fmt = (n: number) => String(round(n, 3));
  const path = loops.map(l => {
    const pts = flatten(l.segments, 16);
    return `M${pts.map(p => `${fmt(p.x)} ${fmt(-p.y)}`).join("L")}Z`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${fmt(minX - pad)} ${fmt(-maxY - pad)} ${fmt(span + 2 * pad)} ${fmt(span + 2 * pad)}"><path d="${path}" fill="#9ca3af" fill-rule="evenodd" stroke="#111827" stroke-width="${fmt(span / 300)}"/></svg>`;
}
