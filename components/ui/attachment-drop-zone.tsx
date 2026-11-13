"use client";

import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { namedFile, transferFiles } from "@/lib/utils/clipboard-files";
import { cn } from "@/lib/utils/cn";

// AP-099: one attachment area for records. Click to choose a file, drop a file on it, or click it and press Ctrl+V to
// attach a screenshot or an image copied from WhatsApp Web. The file goes through the same checks as a chosen file
// (type, size and the company-scoped upload), because the caller's onFile does the upload.
export function AttachmentDropZone({ onFile, accept, disabled = false, busy = false, label, hint, capture, className, children }: {
  onFile: (file: File) => void | Promise<void>; accept: string; disabled?: boolean; busy?: boolean; label: string; hint?: string;
  capture?: "environment" | "user"; className?: string; children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const off = disabled || busy;

  function take(files: File[], how: "pasted" | "dropped" | "chosen") {
    if (off) return;
    const file = files[0];
    if (!file) { setNote(how === "pasted" ? "The clipboard has no image or file. Copy an image first, then press Ctrl+V here." : null); return; }
    setNote(files.length > 1 ? `Attaching the first of ${files.length} files.` : null);
    void onFile(namedFile(file));
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div
        role="button"
        tabIndex={off ? -1 : 0}
        aria-disabled={off || undefined}
        aria-label={`${label}. Click to choose a file, drop a file, or press Ctrl+V to paste an image.`}
        className={cn("flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange",
          over ? "border-orange bg-orange/10" : "border-slate-300 bg-aluminium/30 hover:border-orange hover:bg-orange/5", off && "cursor-not-allowed opacity-60")}
        onClick={() => { if (!off) input.current?.click(); }}
        onKeyDown={(event) => { if (!off && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); input.current?.click(); } }}
        onPaste={(event) => { if (off) return; const files = transferFiles(event.clipboardData); if (files.length) event.preventDefault(); take(files, "pasted"); }}
        onDragOver={(event) => { if (off) return; event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); setOver(false); take(transferFiles(event.dataTransfer), "dropped"); }}
      >
        <Upload className="h-5 w-5 text-slate-500" aria-hidden="true" />
        <span className="text-sm font-bold text-slate-700">{busy ? "Uploading..." : label}</span>
        <span className="text-xs text-slate-500">{hint ?? "Click, drop a file, or click here and press Ctrl+V to paste a screenshot."}</span>
        {children}
        <input ref={input} type="file" className="hidden" accept={accept} capture={capture} disabled={off} tabIndex={-1}
          onChange={(event) => { take(Array.from(event.target.files ?? []), "chosen"); event.target.value = ""; }} />
      </div>
      {note ? <p role="status" className="text-xs font-semibold text-amber-800">{note}</p> : null}
    </div>
  );
}
