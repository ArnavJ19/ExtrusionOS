// Unicode coverage for PDF text beyond the WinAnsi set of the built-in Helvetica font.
// Each script maps to Noto Sans subsets (SIL Open Font License) copied to public/fonts/pdf.

export type PdfScript = "latin_ext" | "devanagari" | "bengali" | "gurmukhi" | "gujarati" | "oriya" | "tamil" | "telugu" | "kannada" | "malayalam";

type ScriptFont = { script: PdfScript; ranges: [number, number][]; regular: string; bold: string };

const font = (family: string, subset: string) => ({
  regular: `noto-sans-${family}-${subset}-400-normal.woff`,
  bold: `noto-sans-${family}-${subset}-700-normal.woff`
});

export const PDF_SCRIPT_FONTS: ScriptFont[] = [
  // Devanagari also carries the rupee sign and the joiners used inside Indic clusters.
  { script: "devanagari", ranges: [[0x0900, 0x097f], [0x1cd0, 0x1cff], [0xa8e0, 0xa8ff], [0x20b9, 0x20b9], [0x20a8, 0x20a8], [0x200c, 0x200d], [0x25cc, 0x25cc]], ...font("devanagari", "devanagari") },
  { script: "bengali", ranges: [[0x0980, 0x09ff]], ...font("bengali", "bengali") },
  { script: "gurmukhi", ranges: [[0x0a00, 0x0a7f]], ...font("gurmukhi", "gurmukhi") },
  { script: "gujarati", ranges: [[0x0a80, 0x0aff]], ...font("gujarati", "gujarati") },
  { script: "oriya", ranges: [[0x0b00, 0x0b7f]], ...font("oriya", "oriya") },
  { script: "tamil", ranges: [[0x0b80, 0x0bff]], ...font("tamil", "tamil") },
  { script: "telugu", ranges: [[0x0c00, 0x0c7f]], ...font("telugu", "telugu") },
  { script: "kannada", ranges: [[0x0c80, 0x0cff]], ...font("kannada", "kannada") },
  { script: "malayalam", ranges: [[0x0d00, 0x0d7f]], ...font("malayalam", "malayalam") },
  // Accented Latin names (Latin Extended-A/B and additional) outside WinAnsi.
  { script: "latin_ext", ranges: [[0x0100, 0x024f], [0x1e00, 0x1eff], [0x2c60, 0x2c7f], [0xa720, 0xa7ff]], ...font("devanagari", "latin-ext") }
];

/**
 * Embedded Latin base face (Noto Sans, tabular lining figures). Embedding it instead of relying on
 * the viewer's built-in Helvetica gives identical metrics in every viewer and correct copy/paste.
 */
export const PDF_BASE_FONT = font("devanagari", "latin");

export const PDF_FONT_FILES = [PDF_BASE_FONT.regular, PDF_BASE_FONT.bold, ...PDF_SCRIPT_FONTS.flatMap((entry) => [entry.regular, entry.bold])];

export function scriptForCodePoint(codePoint: number): PdfScript | null {
  for (const entry of PDF_SCRIPT_FONTS) {
    if (entry.ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) return entry.script;
  }
  return null;
}

export function scriptFont(script: PdfScript) {
  const entry = PDF_SCRIPT_FONTS.find((candidate) => candidate.script === script);
  if (!entry) throw new Error(`No PDF font for ${script}`);
  return entry;
}
