export function getLocalDevelopmentSupabaseOrigin(environment: string | undefined, configuredUrl: string | undefined): string | null {
  if (environment !== "development" || !configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (!["http:", "https:"].includes(url.protocol)
      || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || !url.port || url.pathname !== "/" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
