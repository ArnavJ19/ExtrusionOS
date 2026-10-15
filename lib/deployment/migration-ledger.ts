export type LocalMigration = { version: string; name: string; file: string };
type HostedMigration = { version: string; name: string | null };
type LedgerSnapshot = { migration_ledger_present: boolean; migrations: HostedMigration[] };

export function buildMigrationManifest(files: readonly string[]): LocalMigration[] {
  if (files.length === 0) throw new Error("The checkout migration inventory is empty.");
  return [...files].sort().map((file) => {
    const match = /^(\d+)_([a-zA-Z0-9_]+)\.sql$/.exec(file);
    if (!match) throw new Error("A checkout migration has an invalid filename.");
    return { version: match[1], name: match[2], file };
  });
}

function parseLedgerSnapshot(value: unknown): LedgerSnapshot | null {
  if (value === null || value === undefined) return null;
  // Supabase SQL Editor can export a single result row as a JSON array.
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object") {
    value = value[0].migration_ledger;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid migration ledger snapshot.");
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.migration_ledger_present !== "boolean") throw new Error("Migration ledger presence must be explicit.");
  if (!snapshot.migration_ledger_present) return { migration_ledger_present: false, migrations: [] };
  if (!Array.isArray(snapshot.migrations)) throw new Error("Migration ledger rows must be an array.");
  const migrations = snapshot.migrations.map((row: unknown): HostedMigration => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid migration ledger row.");
    const entry = row as Record<string, unknown>;
    // Numeric JSON values lose leading zeros and can lose timestamp precision.
    if (typeof entry.version !== "string" || !/^\d+$/.test(entry.version)) throw new Error("Migration ledger versions must be digit strings.");
    if (entry.name !== undefined && entry.name !== null && (typeof entry.name !== "string" || !/^[a-zA-Z0-9_]+$/.test(entry.name))) {
      throw new Error("Invalid migration ledger name.");
    }
    return { version: entry.version, name: typeof entry.name === "string" ? entry.name : null };
  });
  return { migration_ledger_present: true, migrations };
}

function groupByVersion<T extends { version: string }>(entries: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const group = groups.get(entry.version) ?? [];
    group.push(entry);
    groups.set(entry.version, group);
  }
  return groups;
}

export function reconcileMigrationLedger(files: readonly string[], snapshot: unknown) {
  const local = buildMigrationManifest(files);
  const localByVersion = groupByVersion(local);
  const ledger = parseLedgerSnapshot(snapshot);
  const collisions = [...localByVersion.entries()].filter(([, group]) => group.length > 1)
    .map(([version, group]) => ({ version, files: group.map((entry) => entry.file) }));
  const available = ledger?.migration_ledger_present === true;
  const hosted = available ? ledger.migrations : [];
  const hostedByVersion = groupByVersion(hosted);
  const duplicateHostedVersions = [...hostedByVersion.entries()].filter(([, group]) => group.length > 1)
    .map(([version]) => version).sort();
  const pending = available ? local.filter((entry) => !hostedByVersion.has(entry.version)) : [];
  const unknownHosted = hosted.filter((entry) => !localByVersion.has(entry.version));
  const nameMismatches = hosted.filter((entry) => entry.name !== null && localByVersion.has(entry.version)
    && !localByVersion.get(entry.version)?.some((candidate) => candidate.name === entry.name));
  const matched = local.filter((entry) => {
    const rows = hostedByVersion.get(entry.version);
    if (rows?.length !== 1) return false;
    return rows[0].name === entry.name || (rows[0].name === null && localByVersion.get(entry.version)?.length === 1);
  });
  const lastKnownApplied = [...hostedByVersion.keys()].filter((version) => localByVersion.has(version)).sort().at(-1);
  const gapsBeforeApplied = pending.filter((entry) => lastKnownApplied !== undefined && entry.version < lastKnownApplied);
  const blocked = collisions.length > 0 || duplicateHostedVersions.length > 0 || pending.length > 0
    || unknownHosted.length > 0 || nameMismatches.length > 0;
  return {
    status: !available ? "unavailable" as const : blocked ? "blocked" as const : "ledger_matches" as const,
    evidence: "Version/name metadata only; migration contents, baseline schema/RLS, replay, grants, JWTs and workflows remain separate checks.",
    local_file_count: local.length,
    local_version_count: localByVersion.size,
    hosted_row_count: available ? hosted.length : null,
    matched_file_count: matched.length,
    local_version_collisions: collisions,
    duplicate_hosted_versions: duplicateHostedVersions,
    pending,
    gaps_before_applied: gapsBeforeApplied,
    unknown_hosted: unknownHosted,
    name_mismatches: nameMismatches
  };
}
