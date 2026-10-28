import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectForm } from "@/components/modules/customers/customer-projects";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageProjects, projectDetailSchema } from "@/lib/workflow/customer-projects";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditCustomerProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (context.dealerId || !canManageProjects(context.role)) redirect(`/customers/projects/${UUID.test(id) ? id : ""}`);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const result = await supabase.rpc("customer_project_command", { p_command: "project.load", p_payload: { project_id: id } });
  if (result.error?.message === "Project is unavailable") notFound();
  if (result.error) throw new Error("The project could not be loaded. Refresh to retry.");
  const { project } = projectDetailSchema.parse(result.data);
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${project.name}`}
        description="Changes are rejected if someone else saved the project after you opened it."
        actions={<Link href={`/customers/projects/${project.id}`} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Back to project</Link>}
      />
      <ProjectForm project={project} />
    </div>
  );
}
