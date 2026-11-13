// AP-082: QR modules for printing the IRP's signed QR on the invoice PDF. The encoder is the Project Nayuki generator
// that qrcode.react bundles (lib/qr/qrcodegen.js, vendored because React rendering is not allowed in route handlers);
// a test checks that the modules match what qrcode.react draws for the same text. Dark runs per row become rectangles
// that pdf-lib draws.
// @ts-expect-error -- vendored JavaScript module without type declarations
import qrcodegen from "../qr/qrcodegen.js";

export type QrRuns = { size: number; runs: { x: number; y: number; w: number }[] };
type Generator = { QrCode: { Ecc: Record<string, unknown>; encodeSegments: (segs: unknown, ecl: unknown) => { size: number; getModules: () => boolean[][] } }; QrSegment: { makeSegments: (text: string) => unknown } };
const gen = qrcodegen as Generator;
const LEVELS = { L: "LOW", M: "MEDIUM", Q: "QUARTILE", H: "HIGH" } as const;

export function qrModules(value: string, level: keyof typeof LEVELS = "M"): boolean[][] | null {
  if (!value) return null;
  try { return gen.QrCode.encodeSegments(gen.QrSegment.makeSegments(value), gen.QrCode.Ecc[LEVELS[level]]).getModules(); } catch { return null; }
}

export function qrRuns(value: string, level: keyof typeof LEVELS = "M"): QrRuns | null {
  const modules = qrModules(value, level);
  if (!modules) return null;
  const runs: QrRuns["runs"] = [];
  modules.forEach((row, y) => {
    let start: number | null = null;
    row.forEach((dark, x) => {
      if (dark && start === null) start = x;
      if ((!dark || x === row.length - 1) && start !== null) { runs.push({ x: start, y, w: (dark ? x + 1 : x) - start }); start = null; }
    });
  });
  return { size: modules.length, runs };
}
