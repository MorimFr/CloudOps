const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 12;

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "clientassertion",
  "password",
  "secret",
  "token",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[-_.]/g, "");
}

export function isSensitiveLogKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password")
  );
}

export function redactSensitiveData(value: unknown): unknown {
  const visited = new WeakSet<object>();

  function visit(current: unknown, depth: number): unknown {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      return current;
    }

    if (typeof current === "bigint") {
      return current.toString();
    }

    if (
      typeof current === "undefined" ||
      typeof current === "symbol" ||
      typeof current === "function"
    ) {
      return undefined;
    }

    if (Buffer.isBuffer(current) || current instanceof Uint8Array) {
      return REDACTED;
    }

    if (depth >= MAX_REDACTION_DEPTH) {
      return "[TRUNCATED]";
    }

    if (typeof current !== "object") {
      return String(current);
    }

    if (visited.has(current)) {
      return "[CIRCULAR]";
    }
    visited.add(current);

    if (Array.isArray(current)) {
      return current.map((entry) => visit(entry, depth + 1));
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(current)) {
      redacted[key] = isSensitiveLogKey(key)
        ? REDACTED
        : visit(entry, depth + 1);
    }
    return redacted;
  }

  return visit(value, 0);
}

export { REDACTED };
