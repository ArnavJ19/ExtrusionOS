import { HomeWorkAction } from "@/components/modules/home-work/home-work-action";

// AP-041: module work that is not about one record (formerly a /tasks hub entry point).
export default async function ModuleWorkPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const { action } = await searchParams;
  return <HomeWorkAction module="vendors" actionParam={action} />;
}
