import { ShieldX } from "lucide-react";
import { LogoutButton } from "@/components/layout/logout-button";

export default function AccessSuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4 py-12">
      <section className="w-full max-w-lg rounded-[28px] border border-neutral-200 bg-white p-8 text-center shadow-[0_24px_70px_rgba(17,17,17,0.08)] sm:p-10">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-50 text-rose-600">
          <ShieldX className="h-8 w-8" aria-hidden="true" />
        </span>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-neutral-400">ExtrusionOS access</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">Your access is suspended</h1>
        <p className="mt-4 text-sm font-medium leading-6 text-neutral-600">
          Your account is still registered, but it has been deactivated by your company administrator. Protected company data and workflows remain blocked.
        </p>
        <p className="mt-3 text-sm font-medium leading-6 text-neutral-500">
          Contact your ExtrusionOS owner or administrator if this was unexpected. Sign out before using a different account.
        </p>
        <div className="mt-8 flex justify-center">
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
