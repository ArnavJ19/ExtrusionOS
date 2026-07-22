"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/utils/errors";
import { onboardingSchema } from "@/lib/validations/schemas";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    const supabase = createClient();
    const result = mode === "login" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) return toast.error(getErrorMessage(result.error));
    if (mode === "login") {
      await supabase.rpc("record_current_login_event", { p_event_type: "login_success" });
    }
    toast.success(mode === "login" ? "Logged in" : "Account created");
    router.replace(mode === "login" ? "/dashboard" : "/onboarding");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-charcoal p-4">
      <Card className="w-full max-w-md border-white/10">
        <CardContent className="p-8">
          <div className="mb-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange">ExtrusionOS Pro</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">{mode === "login" ? "Login" : "Create account"}</h1>
            <p className="mt-2 text-sm text-slate-600">Quotation accuracy, die tracking, production visibility, and dispatch control for aluminium extrusion MSMEs.</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="form-label">Email</span>
              <input className="form-input" name="email" type="email" required autoComplete="email" />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Password</span>
              <input className="form-input" name="password" type="password" minLength={6} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </label>
            <Button disabled={loading} className="w-full" type="submit">{loading ? "Please wait..." : mode === "login" ? "Login" : "Sign up"}</Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-600">
            {mode === "login" ? "New to ExtrusionOS?" : "Already have an account?"} <Link className="font-semibold text-orange" href={mode === "login" ? "/signup" : "/login"}>{mode === "login" ? "Sign up" : "Login"}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function OnboardingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const parsed = onboardingSchema.safeParse({
      full_name: String(form.get("full_name") || ""),
      phone: String(form.get("phone") || ""),
      name: String(form.get("name") || ""),
      legal_name: String(form.get("legal_name") || ""),
      gst_number: String(form.get("gst_number") || ""),
      city: String(form.get("city") || ""),
      state: String(form.get("state") || ""),
      billing_address: String(form.get("billing_address") || "")
    });
    if (!parsed.success) {
      setLoading(false);
      return toast.error(parsed.error.issues[0]?.message ?? "Please check company details");
    }
    const supabase = createClient();
    const { error: onboardingError } = await supabase.rpc("onboard_company_atomic", {
      p_company: {
        name: parsed.data.name,
        legal_name: parsed.data.legal_name,
        gst_number: parsed.data.gst_number,
        city: parsed.data.city,
        state: parsed.data.state,
        billing_address: parsed.data.billing_address
      },
      p_profile: {
        full_name: parsed.data.full_name,
        phone: parsed.data.phone
      }
    });
    setLoading(false);
    if (onboardingError) return toast.error(getErrorMessage(onboardingError, "Could not finish onboarding"));
    toast.success("Company created");
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8] p-4">
      <div className="mx-auto max-w-3xl py-10">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange">Company onboarding</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Create your extrusion company workspace</h1>
        </div>
        <Card>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label">Your name</span><input className="form-input" name="full_name" required /></label>
              <label className="block space-y-1.5"><span className="form-label">Phone</span><input className="form-input" name="phone" /></label>
              <label className="block space-y-1.5 sm:col-span-2"><span className="form-label">Company name</span><input className="form-input" name="name" required /></label>
              <label className="block space-y-1.5 sm:col-span-2"><span className="form-label">Legal name</span><input className="form-input" name="legal_name" /></label>
              <label className="block space-y-1.5"><span className="form-label">GST number</span><input className="form-input" name="gst_number" /></label>
              <label className="block space-y-1.5"><span className="form-label">City</span><input className="form-input" name="city" /></label>
              <label className="block space-y-1.5"><span className="form-label">State</span><input className="form-input" name="state" /></label>
              <label className="block space-y-1.5 sm:col-span-2"><span className="form-label">Billing address</span><textarea className="form-input min-h-24" name="billing_address" /></label>
              <div className="sm:col-span-2"><Button disabled={loading} type="submit">{loading ? "Creating..." : "Create workspace"}</Button></div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
