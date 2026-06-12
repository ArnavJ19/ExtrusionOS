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
