import { redirect } from "next/navigation";

// Posted supplier payments are immutable. Corrections are a reversal (on the payment's
// detail page) followed by a new payment, so the original evidence is never overwritten.
export default async function EditExpensePaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/expenses/payments/${id}`);
}
