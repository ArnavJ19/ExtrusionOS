import Link from "next/link";
import { Camera, Keyboard, QrCode, ShieldCheck } from "lucide-react";

export default function MobileScanPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-3xl bg-slate-950 p-6 text-white"><QrCode className="h-8 w-8 text-orange" /><h1 className="mt-3 text-2xl font-black">Scan Die or Bundle</h1><p className="mt-1 text-sm font-medium text-slate-300">Camera-first workflow with manual fallback for low-end Android phones.</p></div>
      <Link href="/scan" className="flex w-full flex-col items-center justify-center rounded-3xl bg-orange p-10 text-white shadow-xl active:scale-[0.99]"><Camera className="h-16 w-16" /><span className="mt-4 text-xl font-black">Open Scanner Workspace</span><span className="mt-1 text-sm font-bold opacity-90">Scan QR, barcode, die tag, or bundle label</span></Link>
      <div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-3"><Keyboard className="h-6 w-6 text-orange" /><p className="font-black text-slate-950">Manual code search</p></div><p className="mt-2 text-sm font-medium leading-6 text-slate-600">Use the main scan workspace for manual lookup and verified scan results. This mobile shortcut intentionally avoids a separate unverified search flow.</p><Link href="/scan" className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-black text-white">Go to Scan Workspace</Link></div>
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-emerald-700" /><p className="font-black text-emerald-950">Verified results only</p></div><p className="mt-2 text-sm font-medium text-emerald-800">Scan results appear after a real code lookup in the main scanner.</p></div>
    </div>
  );
}
