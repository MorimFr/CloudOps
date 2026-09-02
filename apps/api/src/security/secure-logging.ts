import type { FastifyServerOptions } from "fastify";

const REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "authorization",
  "cookie",
  "set-cookie",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "*.authorization",
  "*.cookie",
  "*.accessToken",
  "*.refreshToken",
  "*.clientSecret",
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
