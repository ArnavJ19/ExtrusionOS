"use client";

import { Button } from "@/components/ui/button";
export default function CommercialError({ reset }: { reset: () => void }) {
  return <section className="space-y-3 rounded-2xl border bg-white p-6"><h2 className="font-bold">Commercial and planning records could not be loaded</h2><p role="alert" className="text-sm text-slate-700">Retry the read. After an interrupted submission, check the original request in the retained action panel before submitting another action.</p><Button type="button" variant="secondary" onClick={reset}>Retry this read</Button></section>;
}
