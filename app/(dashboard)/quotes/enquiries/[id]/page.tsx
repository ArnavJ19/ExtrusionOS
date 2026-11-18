import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { EnquiryRecord } from "@/components/modules/autopilot-batch9/enquiries";
import { getSessionContext } from "@/lib/auth";
import { ENQUIRY_ROLES } from "@/lib/autopilot-batch9/commands";

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(ENQUIRY_ROLES as readonly string[]).includes(context.role)) redirect("/quotes");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) redirect("/quotes/enquiries");
  return <div className="mx-auto max-w-5xl space-y-5">
    <PageHeader density="compact" title="Enquiry" description="Check the lines, map unknown codes once, then open the quotation." actions={<Link href="/quotes/enquiries" className="text-sm font-bold underline">All enquiries</Link>} />
    <EnquiryRecord id={id} canQuote={["owner", "admin"].includes(context.role)} />
  </div>;
}
