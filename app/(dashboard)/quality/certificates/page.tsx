import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CertificateCoverage, CertificatesClient } from "@/components/modules/autopilot-batch8/certificates";
import { getSessionContext } from "@/lib/auth";
import { MTC_READERS } from "@/lib/autopilot-batch8/commands";

// AP-020: billet mill test certificates, and the billet batches whose chemistry is not yet traced to one.
export default async function CertificatesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(MTC_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Mill test certificates" description="Billet chemistry read from supplier certificates and checked against the alloy specification." actions={<Link href="/quality" className="text-sm font-bold underline">Back to quality</Link>} />
    <CertificatesClient />
    <CertificateCoverage />
  </div>;
}
