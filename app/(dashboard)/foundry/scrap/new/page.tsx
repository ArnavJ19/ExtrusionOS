import { redirect } from "next/navigation";

// Incoming scrap is received only through the guided procedure (presence, visual verification, material details).
export default function NewAluminiumScrapPage() {
  redirect("/foundry/scrap/receive");
}
