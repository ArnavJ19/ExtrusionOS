"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { profileSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { updateProfileWithVersioning } from "@/lib/actions/die-actions";
import type { SessionContext } from "@/types/app";
import { emptyProfileForm, type ProfileFormValues } from "./types";
import { ProfileFormTabs } from "./profile-form-tabs";

type DieOption = { value: string; label: string };

export function ProfileFormClient({ context, profileId }: { context: SessionContext; profileId?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<ProfileFormValues>({ ...emptyProfileForm });
  const [dies, setDies] = useState<DieOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(profileId);

  function update(key: string, value: any) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadForm() {
    setLoading(true);
    setError(null);
    const [dieResult, profileResult] = await Promise.all([
      supabase.from("dies").select("id, die_number, die_status").eq("company_id", context.companyId).order("die_number"),
      profileId ? supabase.from("aluminium_profiles").select("*").eq("id", profileId).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null })
    ]);
    if (dieResult.error) throw dieResult.error;
    if (profileResult.error) throw profileResult.error;

    setDies((dieResult.data ?? []).map((d: any) => ({ value: d.id, label: `${d.die_number} (${d.die_status})` })));
    if (profileResult.data) {
      const d = profileResult.data;
      const merged: ProfileFormValues = {};
      for (const key of Object.keys(emptyProfileForm)) {
        if (key === "finish_options") {
          const raw = d[key];
          merged[key] = Array.isArray(raw) ? raw.join(", ") : raw ?? emptyProfileForm[key];
        } else if (typeof emptyProfileForm[key] === "boolean") {
          merged[key] = d[key] ?? emptyProfileForm[key];
        } else {
          merged[key] = d[key] ?? emptyProfileForm[key];
        }
      }
      setForm(merged);
    }
  }

  useEffect(() => {
    loadForm().catch((err) => {
      const msg = getErrorMessage(err, "Could not load profile form");
      setError(msg);
      toast.error(msg);
    }).finally(() => setLoading(false));
  }, [profileId]);

  async function submit() {
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check profile details");
    setSaving(true);

    // Duplicate check on profile_code
    let dupReq = supabase.from("aluminium_profiles").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("profile_code", parsed.data.profile_code);
    if (editing && profileId) dupReq = dupReq.neq("id", profileId);
    const dup = await dupReq;
    if (dup.error) { setSaving(false); return toast.error(getErrorMessage(dup.error)); }
    if ((dup.count ?? 0) > 0) { setSaving(false); return toast.error("Profile code already exists. Use a unique code for traceability."); }

    const payload = {
      ...parsed.data,
      primary_die_id: parsed.data.primary_die_id || null,
      backup_die_id: parsed.data.backup_die_id || null,
      company_id: context.companyId,
      created_by: context.userId
    };

    let resultId: string | undefined;

    if (editing && profileId) {
      // Use versioned server action for edits
      const versionResult = await updateProfileWithVersioning(profileId, payload);
      if (!versionResult.success) { setSaving(false); return toast.error(versionResult.error ?? "Could not save profile"); }
      resultId = profileId;
    } else {
      const result = await supabase.from("aluminium_profiles").insert(payload).select("id").single();
      if (result.error || !result.data) { setSaving(false); return toast.error(getErrorMessage(result.error, "Could not save profile")); }
      resultId = result.data.id;
    }
    setSaving(false);

    toast.success(editing ? "Profile updated" : "Profile added");
    router.push(`/profiles/${resultId}`);
    router.refresh();
  }

  if (loading) return <LoadingState title={editing ? "Loading profile" : "Preparing profile form"} description="Fetching dies and profile data." />;
  if (error) return <ErrorState description={error} onRetry={() => void loadForm()} />;

  return (
    <div className="space-y-6">
      <div>
        <Link href={editing && profileId ? `/profiles/${profileId}` : "/profiles"} className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> {editing ? "Back to Profile" : "Back to Profiles"}</Link>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">{editing ? "Edit Profile" : "Add Profile"}</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">Complete profile engineering, production, surface treatment, and costing data.</p>
      </div>

      <ProfileFormTabs form={form} update={update} dies={dies} />

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button type="button" disabled={saving} onClick={submit}>{saving ? "Saving..." : editing ? "Update Profile" : "Add Profile"}</Button>
      </div>
    </div>
  );
}
