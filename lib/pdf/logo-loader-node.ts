import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchLogo, logoSource, validLogoBytes } from "./logo.ts";

// Server-side company logo loader for PDF routes and server actions. App images are read from
// public/brand (traced into the PDF bundles by next.config.ts); storage logos are fetched from
// this project's public Supabase Storage only. Returns null instead of failing the document.
type LogoQueryClient = {
  from: (table: "companies") => {
    select: (columns: "logo_url") => { eq: (column: "id", value: string) => { maybeSingle: () => PromiseLike<{ data: { logo_url?: string | null } | null }> } };
  };
};

/** Logo of the signed-in user's company (companyId always comes from the server session). */
export async function companyLogo(supabase: unknown, companyId: string): Promise<Uint8Array | null> {
  try {
    const { data } = await (supabase as LogoQueryClient).from("companies").select("logo_url").eq("id", companyId).maybeSingle();
    return loadCompanyLogo(data?.logo_url);
  } catch {
    return null;
  }
}

export async function loadCompanyLogo(logoUrl: unknown): Promise<Uint8Array | null> {
  const source = logoSource(logoUrl);
  if (!source) return null;
  if (source.kind === "storage") return fetchLogo(source.url);
  try {
    const file = source.path.replace(/^\/brand\//, "");
    return validLogoBytes(new Uint8Array(await readFile(join(process.cwd(), "public", "brand", file))));
  } catch {
    return null;
  }
}
