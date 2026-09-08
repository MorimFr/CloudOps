export type IdentityFailure = "admin" | "consent" | "cancelled" | "interaction";

/** Inspect identity errors transiently; return only an allowlisted classification. */
export function classifyIdentityFailure(error: unknown): IdentityFailure | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const fields = error as Record<string, unknown>;
  const codes = new Set<number>();
  for (const key of ["errorCodes", "error_codes"]) {
    const values = fields[key];
    if (Array.isArray(values)) {
      for (const value of values.slice(0, 16)) {
        if (typeof value === "number" || typeof value === "string") codes.add(Number(value));
      }
    }
  }
  if (typeof fields.errorNo === "string" || typeof fields.errorNo === "number") {
    codes.add(Number(fields.errorNo));
  }
  for (const key of ["errorCode", "errorMessage", "message"]) {
    const value = fields[key];
    if (typeof value !== "string") continue;
    for (const match of value.slice(0, 8192).matchAll(/\bAADSTS(\d+)\b/g)) codes.add(Number(match[1]));
  }
  const code = typeof fields.errorCode === "string" ? fields.errorCode.toLowerCase() : "";
  const subError = typeof fields.subError === "string" ? fields.subError.toLowerCase() : "";
  if (codes.has(90094) || codes.has(90095) || code === "admin_consent_required") return "admin";
  if (codes.has(65004) || code === "user_cancelled") return "cancelled";
  if (codes.has(65001) || code === "consent_required" || subError === "consent_required") return "consent";
  if (["interaction_required", "login_required", "claims_challenge_required"].includes(code)) return "interaction";
  return undefined;
}
