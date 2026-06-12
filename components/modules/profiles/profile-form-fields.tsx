"use client";

// Reusable field primitives for the profile form tabs.

export function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}{required ? " *" : ""}</span><input className="form-input" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function NumField({ label, value, onChange, step = "any", min = 0, required }: { label: string; value: number | string; onChange: (v: any) => void; step?: string; min?: number; required?: boolean }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}{required ? " *" : ""}</span><input className="form-input" type="number" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><select className="form-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}

export function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <label className="block space-y-1.5"><span className="form-label">{label}</span><textarea className="form-input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-orange focus:ring-orange" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm font-bold text-slate-700">{label}</span>
    </label>
  );
}
