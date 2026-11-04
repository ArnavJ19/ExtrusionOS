export const QR_PAYLOAD_PREFIX = "EO" as const;

export const qrEntityTypes = [
  "profile",
  "die",
  "billet_batch",
  "inventory_batch",
  "inventory_item",
  "order",
  "quote",
  "production_job",
  "dispatch_package",
  "dispatch",
  "certificate",
  "machine",
  "maintenance",
  "document",
] as const;

export type QrEntityType = (typeof qrEntityTypes)[number];

export type QrPayload = {
  companyId: string;
  entityType: QrEntityType;
  entityId: string;
  nonce: string;
};

export function isQrEntityType(value: string): value is QrEntityType {
  return (qrEntityTypes as readonly string[]).includes(value);
}

export function buildQrPayload(payload: QrPayload): string {
  return [QR_PAYLOAD_PREFIX, payload.companyId, payload.entityType, payload.entityId, payload.nonce].join(":");
}

export function parseQrPayload(value: string): QrPayload | null {
  const [prefix, companyId, entityType, entityId, ...nonceParts] = value.split(":");
  const nonce = nonceParts.join(":");
  if (prefix !== QR_PAYLOAD_PREFIX || !companyId || !entityId || !nonce || !entityType || !isQrEntityType(entityType)) {
    return null;
  }
  return { companyId, entityType, entityId, nonce };
}

// NOV-017: versioned payloads. Version 2 carries only the entity type, its stable internal id and a
// nonce; company identity is resolved from the signed-in session, never from the label.
export const QR_PAYLOAD_V2_PREFIX = "EO2" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildQrPayloadV2(entityType: QrEntityType, entityId: string, nonce: string): string {
  return [QR_PAYLOAD_V2_PREFIX, entityType, entityId, nonce].join(":");
}

export type ScanInput =
  | { kind: "v1"; payload: QrPayload; raw: string }
  | { kind: "v2"; entityType: QrEntityType; entityId: string; raw: string }
  | { kind: "uuid"; entityId: string; raw: string }
  | { kind: "value"; raw: string }
  | { kind: "rejected"; reason: string };

/** Every scanned or typed value is untrusted: links, scripts, control characters and unknown versions are refused. */
export function parseScanInput(value: string): ScanInput {
  const raw = (value ?? "").trim();
  if (!raw) return { kind: "rejected", reason: "Scan or type a code." };
  if (raw.length > 200) return { kind: "rejected", reason: "This code is too long to be an ExtrusionOS label." };
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { kind: "rejected", reason: "This code contains control characters. Rescan the label." };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|vbscript|file|mailto|tel|intent):/i.test(raw)) return { kind: "rejected", reason: "This is a link, not an ExtrusionOS label. Links from labels are never opened." };
  if (/\s/.test(raw)) return { kind: "rejected", reason: "Codes do not contain spaces. Rescan the label or type it again." };
  const head = raw.split(":")[0];
  if (head === QR_PAYLOAD_V2_PREFIX) {
    const [, entityType, entityId, nonce, ...rest] = raw.split(":");
    if (!entityType || !isQrEntityType(entityType) || !UUID.test(entityId ?? "") || !nonce || rest.length) return { kind: "rejected", reason: "This version 2 label is damaged or incomplete. Reprint it." };
    return { kind: "v2", entityType, entityId: entityId.toLowerCase(), raw };
  }
  if (/^EO\d+$/.test(head) && head !== QR_PAYLOAD_PREFIX) return { kind: "rejected", reason: `Label version ${head.slice(2)} is not supported by this application.` };
  if (head === QR_PAYLOAD_PREFIX) {
    const payload = parseQrPayload(raw);
    if (!payload || !UUID.test(payload.entityId) || !UUID.test(payload.companyId)) return { kind: "rejected", reason: "This label is damaged or incomplete. Reprint it." };
    return { kind: "v1", payload, raw };
  }
  if (UUID.test(raw)) return { kind: "uuid", entityId: raw.toLowerCase(), raw };
  if (!/^[A-Za-z0-9:_\-/.]+$/.test(raw)) return { kind: "rejected", reason: "This code has characters ExtrusionOS labels never use." };
  return { kind: "value", raw };
}
