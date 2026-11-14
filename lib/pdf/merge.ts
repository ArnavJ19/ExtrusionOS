// AP-091: one PDF from several generated documents, in the order given, so selected records print in one action.
import { PDFDocument } from "pdf-lib";

export const MAX_BATCH_DOCUMENTS = 50;

export async function mergePdfs(parts: Uint8Array[], title: string) {
  if (!parts.length) throw new Error("Nothing to merge.");
  const out = await PDFDocument.create();
  out.setTitle(title); out.setCreator("ExtrusionOS"); out.setProducer("ExtrusionOS");
  for (const part of parts) {
    const source = await PDFDocument.load(part);
    const pages = await out.copyPages(source, source.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return out.save();
}
