import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { CertificateDetail } from "@/components/modules/autopilot-batch8/certificates";
import { getSessionContext } from "@/lib/auth";
import { MTC_READERS } from "@/lib/autopilot-batch8/commands";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(MTC_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) redirect("/quality/certificates");
  return <div className="mx-auto max-w-4xl space-y-5">
    <PageHeader density="compact" title="Mill test certificate" description="Check each value against the certificate, then confirm. Out-of-specification material goes to the incoming quality decision." actions={<Link href="/quality/certificates" className="text-sm font-bold underline">All certificates</Link>} />
    <CertificateDetail id={id} role={context.role} />
  </div>;
}
