import { createHmac, randomBytes } from "node:crypto";

export const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MICROSOFT_CONSUMER_TENANT_ID =
  "9188040d-6c67-4c5b-b112-36a304b66dad";

export interface AuthenticatedPrincipal {
  readonly tenantId: string;
  readonly objectId: string;
  readonly ownerKey: string;
}

const ownerKeySecret = randomBytes(32);

export function isGuid(value: unknown): value is string {
  return typeof value === "string" && GUID_PATTERN.test(value);
}

export function createAuthenticatedPrincipal(
  tenantId: string,
  objectId: string,
): AuthenticatedPrincipal {
  const normalizedTenantId = tenantId.toLowerCase();
  const normalizedObjectId = objectId.toLowerCase();
  const ownerKey = createHmac("sha256", ownerKeySecret)
    .update(normalizedTenantId, "utf8")
    .update("\0", "utf8")
    .update(normalizedObjectId, "utf8")
    .digest("base64url");

  return Object.freeze({
    tenantId: normalizedTenantId,
    objectId: normalizedObjectId,
    ownerKey,
  });
}
