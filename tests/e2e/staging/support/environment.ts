export const STAGING_MUTATION_CONFIRMATION = "seed-isolated-staging-fixtures";

export type StagingEnvironment = {
  target: "remote" | "local";
  baseUrl: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  projectRef: string;
  primaryEmail: string;
  primaryPassword: string;
  secondaryEmail: string;
  secondaryPassword: string;
  creditDispatchId?: string;
};

export class StagingGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagingGateError";
  }
}

export function stagingOptInRequested() {
  return process.env.E2E_STAGING_ENABLED === "true"
    && process.env.E2E_STAGING_MUTATION_CONFIRM === STAGING_MUTATION_CONFIRMATION;
}

function requireValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new StagingGateError(`Missing ${name}.`);
  return value;
}

function normalizedUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function parseUrl(value: string, name: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new StagingGateError(`${name} must be a valid URL.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new StagingGateError(`${name} must not contain credentials, query parameters or a fragment.`);
  }
  return parsed;
}

export function readStagingEnvironment(): StagingEnvironment {
  if (!stagingOptInRequested()) {
    throw new StagingGateError(
      `Staging E2E is disabled. Set E2E_STAGING_ENABLED=true and E2E_STAGING_MUTATION_CONFIRM=${STAGING_MUTATION_CONFIRMATION}.`,
    );
  }

  const target = process.env.E2E_STAGING_TARGET?.trim() || "remote";
  if (target !== "remote" && target !== "local") {
    throw new StagingGateError("E2E_STAGING_TARGET must be remote or local.");
  }
  const baseUrl = normalizedUrl(requireValue("E2E_STAGING_BASE_URL"));
  const supabaseUrl = normalizedUrl(requireValue("E2E_STAGING_SUPABASE_URL"));
  const serviceRoleKey = requireValue("E2E_STAGING_SUPABASE_SERVICE_ROLE_KEY");
  const projectRef = requireValue("E2E_STAGING_PROJECT_REF");
  const primaryEmail = requireValue("E2E_STAGING_PRIMARY_EMAIL").toLowerCase();
  const primaryPassword = requireValue("E2E_STAGING_PRIMARY_PASSWORD");
  const secondaryEmail = requireValue("E2E_STAGING_SECONDARY_EMAIL").toLowerCase();
  const secondaryPassword = requireValue("E2E_STAGING_SECONDARY_PASSWORD");

  const appUrl = parseUrl(baseUrl, "E2E_STAGING_BASE_URL");
  const databaseUrl = parseUrl(supabaseUrl, "E2E_STAGING_SUPABASE_URL");
  if (databaseUrl.pathname !== "/") {
    throw new StagingGateError("E2E_STAGING_SUPABASE_URL must be a project origin without a path.");
  }
  if (target === "local") {
    // Local mutation opt-in accepts only separate, explicitly ported loopback services.
    const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"];
    for (const url of [appUrl, databaseUrl]) {
      if (url.protocol !== "http:" || !loopbackHosts.includes(url.hostname) || !url.port) {
        throw new StagingGateError("Local staging requires HTTP loopback URLs with explicit ports.");
      }
    }
    if (appUrl.port === databaseUrl.port) {
      throw new StagingGateError("Local application and Supabase must use separate ports.");
    }
  } else {
    if (appUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)) {
      throw new StagingGateError("E2E_STAGING_BASE_URL must be a remote HTTPS staging deployment.");
    }
    const actualProjectRef = databaseUrl.hostname.split(".")[0];
    if (databaseUrl.protocol !== "https:" || !databaseUrl.hostname.endsWith(".supabase.co")) {
      throw new StagingGateError("E2E_STAGING_SUPABASE_URL must be an HTTPS Supabase project URL.");
    }
    if (actualProjectRef !== projectRef) {
      throw new StagingGateError("E2E_STAGING_PROJECT_REF does not match E2E_STAGING_SUPABASE_URL.");
    }
  }
  if (primaryEmail === secondaryEmail) {
    throw new StagingGateError("Primary and secondary staging users must be different accounts.");
  }

  const currentProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const currentServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (currentProjectUrl) {
    const currentUrl = parseUrl(currentProjectUrl, "NEXT_PUBLIC_SUPABASE_URL");
    const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"];
    const sameLocalPort = target === "local" && loopbackHosts.includes(currentUrl.hostname)
      && currentUrl.port === databaseUrl.port;
    if (currentUrl.origin === databaseUrl.origin || sameLocalPort) {
      throw new StagingGateError("The staging Supabase URL matches the app's currently configured project; refusing to mutate it.");
    }
  }
  if (currentServiceKey && currentServiceKey === serviceRoleKey) {
    throw new StagingGateError("The dedicated staging key matches SUPABASE_SERVICE_ROLE_KEY; refusing implicit current-project access.");
  }

  return {
    target,
    baseUrl,
    supabaseUrl,
    serviceRoleKey,
    projectRef,
    primaryEmail,
    primaryPassword,
    secondaryEmail,
    secondaryPassword,
    creditDispatchId: process.env.E2E_STAGING_CREDIT_DISPATCH_ID?.trim() || undefined,
  };
}
