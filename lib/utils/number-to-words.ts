/**
 * Convert a number to Indian Rupee words following the Indian numbering system.
 * Example: 230000 → "Rupees Two Lakh Thirty Thousand Only"
 */

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"];

const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n: number): string {
  if (n < 20) return ones[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return tens[t] + (o ? " " + ones[o] : "");
}

function threeDigitWords(n: number): string {
  if (n === 0) return "";
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0 && r > 0) return ones[h] + " Hundred " + twoDigitWords(r);
  if (h > 0) return ones[h] + " Hundred";
  return twoDigitWords(r);
}

export function numberToWordsINR(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "Zero";

  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Rupees Zero Only";

  // Indian numbering: Crore (10^7), Lakh (10^5), Thousand (10^3), Hundred (10^2)
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const remainder = rupees % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(twoDigitWords(crore) + " Crore");
  if (lakh > 0) parts.push(twoDigitWords(lakh) + " Lakh");
  if (thousand > 0) parts.push(twoDigitWords(thousand) + " Thousand");
  if (remainder > 0) parts.push(threeDigitWords(remainder));

  let result = "Rupees " + parts.join(" ");

  if (paise > 0) {
    result += " and " + twoDigitWords(paise) + " Paise";
  }

  return result + " Only";
}
