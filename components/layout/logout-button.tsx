"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button onClick={logout} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950">
      <LogOut className="h-4 w-4" /> Logout
    </button>
  );
}
