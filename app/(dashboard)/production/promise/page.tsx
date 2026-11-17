import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PromiseClient } from "@/components/modules/intelligence/promise";
import { getSessionContext } from "@/lib/auth";
import { PROMISE_ROLES } from "@/lib/intelligence/commands";
import { loadOptions } from "@/lib/intelligence/options";

// FS-26 stage: promise-date calculator and breakdown re-flow.
export default async function PromisePage() {
  const context = await getSessionContext();
  if (context.dealerId || !(PROMISE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  const { profiles } = await loadOptions(["profiles"]);
  return <div className="space-y-5">
    <PageHeader title="Promise dates" description="The earliest realistic dispatch for a profile and quantity, and the orders now at risk on a press that has stopped." />
    <PromiseClient profiles={profiles} />
  </div>;
}
