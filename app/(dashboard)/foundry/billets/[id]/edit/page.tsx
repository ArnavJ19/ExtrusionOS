import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function FoundryBilletEditPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await getSessionContext();
  redirect(`/foundry/billets/${params.id}`);
}
