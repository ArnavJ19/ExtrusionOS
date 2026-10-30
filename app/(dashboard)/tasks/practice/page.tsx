import { getSessionContext } from "@/lib/auth";
import { PracticeWorkspace } from "@/components/modules/practice-workspace";

export default async function PracticePage() {
  const context = await getSessionContext();
  return <PracticeWorkspace key={`${context.companyId}:${context.userId}`} />;
}
