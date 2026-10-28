// Copies the Noto Sans subsets used by PDF documents into public/fonts/pdf so both the
// server PDF routes (read from disk) and browser report exports (fetched) use the same
// files, and removes subsets the catalogue no longer uses. Run after upgrading the
// @fontsource packages: node --experimental-strip-types scripts/sync-pdf-fonts.mjs
import { copyFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDF_FONT_SOURCES } from "../lib/pdf/font-catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "fonts", "pdf");
mkdirSync(target, { recursive: true });
for (const { file, fontPackage } of PDF_FONT_SOURCES) {
  const source = join(root, "node_modules", "@fontsource", fontPackage, "files", file);
  if (!existsSync(source)) throw new Error(`Missing ${source}. Install the @fontsource devDependencies first.`);
  copyFileSync(source, join(target, file));
  console.log(`copied ${file}`);
}
const catalogued = new Set(PDF_FONT_SOURCES.map(({ file }) => file));
for (const file of readdirSync(target).filter((name) => name.endsWith(".woff") && !catalogued.has(name))) {
  rmSync(join(target, file));
  console.log(`removed unused ${file}`);
}
