// AP-073: the customer rate card as data, a WhatsApp text and PDF rows. Only selling prices: family, alloy, finish and
// rate per kg (plus a per-area finishing charge where the finish is priced per sq ft or per metre). Never cost, margin,
// floor, supplier rate or internal note. The card states its validity date and that GST is extra.
export type RateCardLine = { families: string | null; alloy: string | null; finish: string; finish_label: string; rate_per_kg: number; finish_extra: { rate: number; basis: string } | null };
export type RateCard = { card_number: string; customer_name: string; rate_day: string; valid_until: string; gst_percent: number; lines: RateCardLine[];
  company: { name: string; gst_number?: string | null; city?: string | null; phone?: string | null; email?: string | null } };

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const basisLabel = (basis: string) => (basis === "per_sqft" ? "per sq ft" : basis === "per_meter" ? "per metre" : "per kg");

export function rateCardValidity(card: Pick<RateCard, "rate_day" | "valid_until">): string {
  return card.valid_until === card.rate_day ? `Valid for ${day(card.rate_day)} only` : `Valid ${day(card.rate_day)} to ${day(card.valid_until)}`;
}

/** Lines in a stable order: alloy, then mill finish first, then the other finishes by name. */
export function sortRateLines(lines: RateCardLine[]): RateCardLine[] {
  return [...lines].sort((a, b) => (a.alloy ?? "~").localeCompare(b.alloy ?? "~") || (a.finish === "mill_finish" ? -1 : b.finish === "mill_finish" ? 1 : a.finish_label.localeCompare(b.finish_label)));
}

export function rateLineText(line: RateCardLine): string {
  return `${line.finish_label}${line.alloy ? ` (${line.alloy})` : ""}: ${inr(line.rate_per_kg)}/kg${line.finish_extra ? ` + ${inr(line.finish_extra.rate)} ${basisLabel(line.finish_extra.basis)} finishing` : ""}`;
}

/** A WhatsApp-ready message. It is copied by the person; nothing is sent automatically. */
export function rateCardWhatsApp(card: RateCard): string {
  const groups = new Map<string, RateCardLine[]>();
  for (const line of sortRateLines(card.lines)) {
    const key = line.families ?? "All profiles";
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const body = [...groups.entries()].map(([families, lines]) => `*${families}*\n${lines.map(l => `• ${rateLineText(l)}`).join("\n")}`).join("\n\n");
  return [`*${card.company.name} — rate card ${card.card_number}*`, `For ${card.customer_name}`, rateCardValidity(card), "", body, "",
    `Rates are per kg of aluminium profile, ex-works, GST ${card.gst_percent}% extra. Final price on the quotation and invoice.`].join("\n");
}
