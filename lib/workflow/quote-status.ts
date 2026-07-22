import type { QuoteStatus } from "@/types/app";

const quickQuoteTransitions: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ["internal_review"],
  internal_review: ["draft", "approved_for_sending"],
  approved_for_sending: ["draft", "sent"],
  sent: ["draft", "customer_approved", "customer_rejected", "expired"],
  customer_approved: [],
  customer_rejected: [],
  expired: [],
  converted_to_order: []
};

export function getAllowedQuoteStatusTransitions(status: QuoteStatus): readonly QuoteStatus[] {
  return quickQuoteTransitions[status] ?? [];
}

export function canTransitionQuoteStatus(from: QuoteStatus, to: QuoteStatus): boolean {
  return getAllowedQuoteStatusTransitions(from).includes(to);
}
