export const STAGING_MUTATION_CONFIRMATION = "seed-isolated-staging-fixtures";

export type StagingEnvironment = {
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

export function readStagingEnvironment(): StagingEnvironment {
  if (!stagingOptInRequested()) {
    throw new StagingGateError(
      `Staging E2E is disabled. Set E2E_STAGING_ENABLED=true and E2E_STAGING_MUTATION_CONFIRM=${STAGING_MUTATION_CONFIRMATION}.`,
    );
  }

  const baseUrl = normalizedUrl(requireValue("E2E_STAGING_BASE_URL"));
  const supabaseUrl = normalizedUrl(requireValue("E2E_STAGING_SUPABASE_URL"));
  const serviceRoleKey = requireValue("E2E_STAGING_SUPABASE_SERVICE_ROLE_KEY");
  const projectRef = requireValue("E2E_STAGING_PROJECT_REF");
  const primaryEmail = requireValue("E2E_STAGING_PRIMARY_EMAIL").toLowerCase();
  const primaryPassword = requireValue("E2E_STAGING_PRIMARY_PASSWORD");
  const secondaryEmail = requireValue("E2E_STAGING_SECONDARY_EMAIL").toLowerCase();
  const secondaryPassword = requireValue("E2E_STAGING_SECONDARY_PASSWORD");

  const appUrl = new URL(baseUrl);
  if (appUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(appUrl.hostname)) {
    throw new StagingGateError("E2E_STAGING_BASE_URL must be a remote HTTPS staging deployment.");
  }

  const databaseUrl = new URL(supabaseUrl);
  const actualProjectRef = databaseUrl.hostname.split(".")[0];
  if (databaseUrl.protocol !== "https:" || !databaseUrl.hostname.endsWith(".supabase.co")) {
    throw new StagingGateError("E2E_STAGING_SUPABASE_URL must be an HTTPS Supabase project URL.");
  }
  if (actualProjectRef !== projectRef) {
    throw new StagingGateError("E2E_STAGING_PROJECT_REF does not match E2E_STAGING_SUPABASE_URL.");
  }
  if (primaryEmail === secondaryEmail) {
    throw new StagingGateError("Primary and secondary staging users must be different accounts.");
  }

  const currentProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const currentServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (currentProjectUrl && normalizedUrl(currentProjectUrl) === supabaseUrl) {
    throw new StagingGateError("The staging Supabase URL matches the app's currently configured project; refusing to mutate it.");
  }
  if (currentServiceKey && currentServiceKey === serviceRoleKey) {
    throw new StagingGateError("The dedicated staging key matches SUPABASE_SERVICE_ROLE_KEY; refusing implicit current-project access.");
  }

  return {
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
