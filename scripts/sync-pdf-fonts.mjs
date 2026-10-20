// Copies the Noto Sans subsets used by PDF documents into public/fonts/pdf so both the
// server PDF routes (read from disk) and browser report exports (fetched) use the same
// files. Run after upgrading the @fontsource packages: node scripts/sync-pdf-fonts.mjs
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDF_FONT_FILES } from "../lib/pdf/font-catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "fonts", "pdf");
mkdirSync(target, { recursive: true });
for (const file of PDF_FONT_FILES) {
  const match = file.match(/^(noto-sans-[a-z]+)-/);
  if (!match) throw new Error(`Unexpected font file ${file}`);
  const source = join(root, "node_modules", "@fontsource", match[1], "files", file);
  if (!existsSync(source)) throw new Error(`Missing ${source}. Install the @fontsource devDependencies first.`);
  copyFileSync(source, join(target, file));
  console.log(`copied ${file}`);
}
