import { redirect } from "next/navigation";
import { WallClient } from "@/components/modules/intelligence/wall";
import { getSessionContext } from "@/lib/auth";
import { WALL_ROLES } from "@/lib/intelligence/commands";

// FS-36: production-office wall view; refreshes itself.
export default async function ProductionWallPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(WALL_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-4"><h1 className="text-3xl font-black">Presses now</h1><WallClient /></div>;
}
