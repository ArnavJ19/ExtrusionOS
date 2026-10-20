import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PdfFontLoader } from "./unicode-text.ts";

// Server-side font loader for PDF routes. next.config.ts traces public/fonts/pdf into the
// API route bundles so the files exist in serverless deployments.
export const nodeFontLoader: PdfFontLoader = async (file) => {
  if (!/^[a-z0-9-]+\.woff$/.test(file)) throw new Error("Invalid PDF font file name");
  return new Uint8Array(await readFile(join(process.cwd(), "public", "fonts", "pdf", file)));
};
