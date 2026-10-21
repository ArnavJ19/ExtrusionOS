"use client";

import { useEffect, useRef, useState } from "react";
import { Expand, X } from "lucide-react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/browser";
import { getApprovedProfileImagePath, isApprovedProfileImageType } from "@/lib/profiles/selection";

export type ProfilePreviewData = {
  id: string;
  profile_code: string;
  profile_name: string;
  section_weight_kg_per_m: number | null;
  section_number?: string | null;
  section_code?: string | null;
  section_name?: string | null;
  circumscribing_circle_diameter_mm?: number | null;
  nominal_wall_thickness_mm?: number | null;
  number_of_voids?: number | null;
  drawing_revision?: string | null;
  drawing_approval_status?: string | null;
  cross_section_image_url?: string | null;
};

export function ProfilePreview({ profile, companyId }: { profile: ProfilePreviewData | null; companyId: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const imageObjectUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    imageObjectUrl.current = null;
    setImageUrl(null);
    setEnlarged(false);
    setImageUnavailable(false);
    if (!profile) return;

    const path = getApprovedProfileImagePath(profile.cross_section_image_url, profile.drawing_approval_status, companyId);
    if (!path) {
      setImageUnavailable(true);
      return;
    }

    void (async () => {
      try {
        const { data, error } = await createClient().storage.from("documents").download(path);
        if (error || !data || !isApprovedProfileImageType(data.type)) throw error ?? new Error("Approved cross-section is not a supported image.");
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        imageObjectUrl.current = objectUrl;
        setImageUrl(objectUrl);
      } catch {
        if (!cancelled) setImageUnavailable(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (imageObjectUrl.current === objectUrl) imageObjectUrl.current = null;
    };
  }, [companyId, profile]);

  useEffect(() => {
    if (!enlarged) return;
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    function manageDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") setEnlarged(false);
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", manageDialogKeys);
    return () => {
      window.removeEventListener("keydown", manageDialogKeys);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [enlarged]);

  if (!profile) return null;
  const dimensions = [
    profile.section_number ? `Section ${profile.section_number}` : null,
    profile.section_code ? `Code ${profile.section_code}` : null,
    profile.circumscribing_circle_diameter_mm ? `CCD ${profile.circumscribing_circle_diameter_mm} mm` : null,
    profile.nominal_wall_thickness_mm ? `Wall ${profile.nominal_wall_thickness_mm} mm` : null,
    profile.number_of_voids != null ? `${profile.number_of_voids} voids` : null,
  ].filter(Boolean);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black text-slate-950">{profile.profile_code} · {profile.profile_name}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">{dimensions.length ? dimensions.join(" · ") : "Dimensions not captured"}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">Section weight: {profile.section_weight_kg_per_m ?? "Not captured"} kg/m · Drawing revision: {profile.drawing_revision || "Not captured"}</p>
        </div>
        {imageUrl ? <button type="button" onClick={() => setEnlarged(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50" aria-label={`Enlarge approved cross-section for ${profile.profile_code}`}><Expand className="h-4 w-4" /> Enlarge</button> : null}
      </div>
      {imageUrl ? <Image unoptimized width={1200} height={900} src={imageUrl} alt={`Approved cross-section for ${profile.profile_code}, drawing revision ${profile.drawing_revision || "not captured"}`} className="mt-3 h-36 w-full rounded-lg border border-slate-200 bg-white object-contain p-2" onError={() => { if (imageObjectUrl.current === imageUrl) { URL.revokeObjectURL(imageUrl); imageObjectUrl.current = null; setImageUrl(null); setImageUnavailable(true); } }} /> : imageUnavailable ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">Approved cross-section artwork unavailable for this profile.</p> : <p className="mt-3 text-sm font-semibold text-slate-500">Loading approved cross-section…</p>}
      {enlarged && imageUrl ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-label={`Approved cross-section for ${profile.profile_code}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setEnlarged(false); }}><div ref={dialogRef} tabIndex={-1} className="relative w-full max-w-4xl rounded-2xl bg-white p-4"><button ref={closeButtonRef} type="button" className="absolute right-3 top-3 rounded-lg p-2 text-slate-700 hover:bg-slate-100" onClick={() => setEnlarged(false)} aria-label="Close enlarged cross-section"><X className="h-5 w-5" /></button><p className="mb-3 pr-12 font-black text-slate-950">{profile.profile_code} · {profile.profile_name} · Rev {profile.drawing_revision || "Not captured"}</p><Image unoptimized width={1600} height={1200} src={imageUrl} alt={`Approved cross-section for ${profile.profile_code}`} className="max-h-[80vh] w-full object-contain" /></div></div> : null}
    </div>
  );
}
