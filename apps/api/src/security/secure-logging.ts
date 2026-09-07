import type { FastifyServerOptions } from "fastify";

import { redactSensitiveData } from "./redaction.js";

const REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "authorization",
  "cookie",
  "set-cookie",
  "accessToken",
  "idToken",
  "graphToken",
  "refreshToken",
  "clientSecret",
  "clientAssertion",
  "oboAssertion",
  "claimsChallenge",
  "authenticateHeader",
  "tenantId",
  "objectId",
  "tid",
  "oid",
  "claims",
  "preferred_username",
  "username",
  "email",
  "displayName",
  "*.authorization",
  "*.cookie",
  "*.accessToken",
  "*.idToken",
  "*.graphToken",
  "*.refreshToken",
  "*.clientSecret",
  "*.clientAssertion",
  "*.oboAssertion",
  "*.claimsChallenge",
  "*.authenticateHeader",
  "*.tenantId",
  "*.objectId",
  "*.tid",
  "*.oid",
  "*.claims",
  "*.preferred_username",
  "*.username",
  "*.email",
  "*.displayName",
] as const;

export function createSecureLoggerOptions(
  nodeEnvironment: "development" | "test" | "production",
): Exclude<FastifyServerOptions["logger"], boolean | undefined> {
  return {
    level: nodeEnvironment === "test" ? "silent" : "info",
    redact: {
      paths: [...REDACTION_PATHS],
      censor: "[REDACTED]",
      remove: false,
    },
    formatters: {
      log(object) {
        const redacted = redactSensitiveData(object);
        return typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
          ? redacted as Record<string, unknown>
          : { value: "[REDACTED]" };
      },
    },
    serializers: {
      req(request: {
        id?: string;
        method?: string;
        routerPath?: string;
      }) {
        return {
          id: request.id,
          method: request.method,
          route: request.routerPath,
        };
      },
      res(response: { statusCode?: number }) {
        return { statusCode: response.statusCode };
      },
      err(error: { code?: unknown; name?: unknown }) {
        return {
          type: typeof error.name === "string" ? error.name : "Error",
          code: typeof error.code === "string" ? error.code : "INTERNAL_ERROR",
          message: "An internal error occurred.",
          stack: "",
        };
      },
    },
  };
}
