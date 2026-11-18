import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { CertificateUpload } from "@/components/modules/autopilot-batch8/certificates";
import { getSessionContext } from "@/lib/auth";
import { MTC_UPLOADERS } from "@/lib/autopilot-batch8/commands";

export default async function NewCertificatePage({ searchParams }: { searchParams: Promise<{ receipt_line?: string; batch?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(MTC_UPLOADERS as readonly string[]).includes(context.role)) redirect("/quality/certificates");
  const query = await searchParams;
  const line = z.string().uuid().safeParse(query.receipt_line); const batch = z.string().uuid().safeParse(query.batch);
  if (!line.success && !batch.success) redirect("/quality/certificates");
  return <div className="mx-auto max-w-3xl space-y-5">
    <PageHeader density="compact" title="Read a mill test certificate" description="The certificate is kept with the material; the values become a draft that quality confirms." actions={<Link href="/quality/certificates" className="text-sm font-bold underline">All certificates</Link>} />
    <CertificateUpload companyId={context.companyId} {...(line.success ? { receiptLineId: line.data } : { billetBatchId: batch.success ? batch.data : undefined })} />
  </div>;
}
