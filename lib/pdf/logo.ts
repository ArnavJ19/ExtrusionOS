// Company logo for printed documents (companies.logo_url, set in Settings → Branding).
// Only two sources are accepted, so a logo URL can never make the server fetch arbitrary hosts:
//   * an image shipped with the app under /brand/ (read from public/brand on the server), or
//   * a file in this project's public Supabase Storage (https://<project>/storage/v1/object/public/…).
// A missing, unreachable or invalid logo never blocks a document: it is simply left out.

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export type LogoSource = { kind: "app"; path: string } | { kind: "storage"; url: string };

/** Classifies a logo URL; null when it is empty or not an allowed source. */
export function logoSource(logoUrl: unknown, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): LogoSource | null {
  const value = typeof logoUrl === "string" ? logoUrl.trim() : "";
  if (!value) return null;
  if (/^\/brand\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g)$/i.test(value) && !value.includes("..")) return { kind: "app", path: value };
  if (!supabaseUrl) return null;
  try {
    const url = new URL(value);
    const project = new URL(supabaseUrl);
    if (url.protocol === "https:" && url.host === project.host && url.pathname.startsWith("/storage/v1/object/public/") && !url.username && !url.password) {
      return { kind: "storage", url: url.toString() };
    }
  } catch {
    return null;
  }
  return null;
}

/** PNG or JPEG bytes of acceptable size, otherwise null. */
export function validLogoBytes(bytes: Uint8Array | null | undefined): Uint8Array | null {
  if (!bytes || bytes.length < 8 || bytes.length > LOGO_MAX_BYTES) return null;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return png || jpeg ? bytes : null;
}

export async function fetchLogo(url: string, timeoutMs = 5000): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > LOGO_MAX_BYTES) return null;
    return validLogoBytes(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Browser exports (Report Builder): app images are fetched from this origin. */
export async function loadLogoInBrowser(logoUrl: unknown, supabaseUrl?: string): Promise<Uint8Array | null> {
  const source = logoSource(logoUrl, supabaseUrl);
  if (!source) return null;
  return fetchLogo(source.kind === "app" ? source.path : source.url);
}
