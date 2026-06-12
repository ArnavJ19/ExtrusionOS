"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/access/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: String(form.get("password") || "") })
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not accept invite");
    toast.success("Invite accepted. You can now log in.");
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-charcoal p-4">
      <Card className="w-full max-w-md border-white/10">
        <CardContent className="p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange">ExtrusionOS Pro</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Accept invite</h1>
          <p className="mt-2 text-sm text-slate-600">Set your password to join your company or dealership workspace.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block space-y-1.5"><span className="form-label">Password</span><input className="form-input" name="password" type="password" minLength={6} required autoComplete="new-password" /></label>
            <Button disabled={loading} className="w-full" type="submit">{loading ? "Accepting..." : "Accept invite"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
