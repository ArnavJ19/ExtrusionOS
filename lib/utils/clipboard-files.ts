// AP-099: files from a paste or a drop. Clipboard images have no useful name ("image.png"), so they get a dated name.

export type FileLike = { name: string; type: string; size: number };
type ItemLike = { kind: string; type: string; getAsFile: () => File | null };
type TransferLike = { items?: ArrayLike<ItemLike> | null; files?: ArrayLike<File> | null };

/** Every file in the transfer (items first, which is where browsers put pasted screenshots). */
export function transferFiles(transfer: TransferLike | null | undefined): File[] {
  if (!transfer) return [];
  const out: File[] = [];
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  if (!out.length) out.push(...Array.from(transfer.files ?? []));
  return out;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/** A pasted screenshot is named pasted-YYYYMMDD-HHMMSS.png (IST); a named file keeps its name. */
export function pastedFileName(file: FileLike, now: Date = new Date()): string {
  const generic = !file.name || /^(image|blob|clipboard|unknown)(\.\w+)?$/i.test(file.name);
  if (!generic) return file.name;
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString();
  const stamp = `${ist.slice(0, 10).replace(/-/g, "")}-${ist.slice(11, 19).replace(/:/g, "")}`;
  return `pasted-${stamp}.${EXT[file.type] ?? "png"}`;
}

/** Renames a pasted file when its name is generic; returns the original object otherwise. */
export function namedFile(file: File, now: Date = new Date()): File {
  const name = pastedFileName(file, now);
  return name === file.name ? file : new File([file], name, { type: file.type, lastModified: now.getTime() });
}
