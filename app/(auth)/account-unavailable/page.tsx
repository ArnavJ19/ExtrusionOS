import { TriangleAlert } from "lucide-react";
import { LogoutButton } from "@/components/layout/logout-button";

export default function AccountUnavailablePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4 py-12">
      <section className="w-full max-w-lg rounded-[28px] border border-neutral-200 bg-white p-8 text-center shadow-[0_24px_70px_rgba(17,17,17,0.08)] sm:p-10">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 text-amber-600">
          <TriangleAlert className="h-8 w-8" aria-hidden="true" />
        </span>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-neutral-400">ExtrusionOS account</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-950">Account details are temporarily unavailable</h1>
        <p className="mt-4 text-sm font-medium leading-6 text-neutral-600">
          Your login is valid, but the company profile could not be loaded. No onboarding or company data changes were made.
        </p>
        <p className="mt-3 text-sm font-medium leading-6 text-neutral-500">Try again shortly. If this continues, contact your administrator.</p>
        <div className="mt-8 flex justify-center">
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
