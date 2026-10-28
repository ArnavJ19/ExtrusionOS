import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { BlueprintForm } from "@/components/modules/tasks/task-blueprints";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blueprintLoadSchema, canManageBlueprints } from "@/lib/workflow/task-blueprints";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// UPGRADE_EOS feature 61: create a blueprint, or edit one (?edit=<id>).
export default async function NewBlueprintPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canManageBlueprints(context.role)) redirect("/tasks/blueprints");
  const { edit } = await searchParams;
  let existing = null;
  if (edit && UUID.test(edit)) {
    const supabase = await createClient();
    const result = await supabase.rpc("task_blueprint_command", { p_command: "blueprint.load", p_payload: { blueprint_id: edit } });
    existing = result.error ? null : blueprintLoadSchema.safeParse(result.data).data?.blueprint ?? null;
    if (!existing) redirect("/tasks/blueprints");
  }
  return (
    <div className="space-y-5">
      <PageHeader title={existing ? `Edit blueprint · ${existing.title}` : "New task blueprint"} description="Prerequisites are enforced when work starts. Each save keeps a revision with its reason."
        actions={<Link href="/tasks/blueprints" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All blueprints</Link>} />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><BlueprintForm key={existing?.revision ?? "new"} blueprint={existing} /></section>
    </div>
  );
}
