import { HomeWorkAction } from "@/components/modules/home-work/home-work-action";

// AP-041: start related work from this record (formerly a /tasks hub entry point).
export default async function DieWorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string }> }) {
  const [{ id }, { action }] = await Promise.all([params, searchParams]);
  return <HomeWorkAction kind="die" id={id} actionParam={action} />;
}
