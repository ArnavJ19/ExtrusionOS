import { redirect } from "next/navigation";

export default async function EditPaymentAliasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/invoices/${id}/edit`);
}
