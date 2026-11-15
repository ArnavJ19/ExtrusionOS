import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EnquiryList, PasteEnquiry } from "@/components/modules/autopilot-batch9/enquiries";
import { getSessionContext } from "@/lib/auth";
import { ENQUIRY_ROLES } from "@/lib/autopilot-batch9/commands";

// AP-008: WhatsApp enquiries read into draft quotation lines.
export default async function EnquiriesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(ENQUIRY_ROLES as readonly string[]).includes(context.role)) redirect("/quotes");
  return <div className="space-y-5">
    <PageHeader title="WhatsApp enquiries" description="Paste the customer's message; the lines are read for you with how sure the reader is about each one." actions={<Link href="/quotes" className="text-sm font-bold underline">Back to quotations</Link>} />
    <PasteEnquiry />
    <EnquiryList />
  </div>;
}
