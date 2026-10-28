import { commercialReviewAction } from "@/lib/actions/commercial-review";
import { CommercialReviewPanel } from "@/components/modules/quotes/commercial-review";
import { PageHeader } from "@/components/layout/page-header";
import { quotePartyAction } from "@/lib/actions/quote-party";
import { QuotePartyPanel } from "@/components/modules/quotes/quote-party";
import { getSessionContext } from "@/lib/auth";
import { LinkedDocumentsPanel } from "@/components/modules/shared/linked-documents";

export default async function QuoteCommercialReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await commercialReviewAction({ command: "quote.review", quote_id: id });
  const context = await getSessionContext();
  const party = result.success && ["owner","admin","sales","sales_manager","accounts"].includes(context.role) ? await quotePartyAction({command:"party.load",quote_id:id}) : null;
  return <div className="space-y-5"><PageHeader title="Review quotation" description="Check saved quantities, tax, billing basis and the accepted order source." />
    {result.success && result.kind === "review" ? <CommercialReviewPanel key={result.data.fingerprint} initial={result.data} /> : <p role="alert">{result.success ? "Review unavailable" : result.error}</p>}
    {party?.success && party.kind==="party" ? <QuotePartyPanel quoteId={id} initial={party.data} canEdit={["owner","admin"].includes(context.role)} /> : party && !party.success ? <p role="alert">{party.error}</p> : null}
    {result.success ? <LinkedDocumentsPanel key={`${context.companyId}:${context.userId}:${context.role}:${id}`} entityType="quote" entityId={id} canLink={["owner","admin"].includes(context.role)}/> : null}
  </div>;
}
