import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import { ZodError } from "zod";

import { loadConfig, type ApiConfig } from "./config.js";
import { CloudOpsError } from "./errors.js";
import { EntraAuth } from "./auth/entra-auth.js";
import {
  EntraTokenValidator,
  MicrosoftOrganizationsKeyProvider,
  type ApiTokenValidator,
} from "./auth/token-validator.js";
import {
  MsalOboService,
  type GraphTokenBroker,
} from "./auth/obo-service.js";
import { registerAssessmentRoutes } from "./routes/assessments.js";
import { registerExecutionRoutes } from "./routes/executions.js";
import { registerHealthRoute } from "./routes/health.js";
import { createSecureLoggerOptions } from "./security/secure-logging.js";
import {
  createDefaultAssessmentRegistry,
  type AssessmentRegistry,
} from "./services/assessment-registry.js";
import { ExecutionManager } from "./services/execution-manager.js";
import {
  PowerShellRuntime,
  type AssessmentRuntime,
} from "./services/powershell-runtime.js";

export interface BuildAppOptions {
  readonly config?: Partial<ApiConfig>;
  readonly logger?: FastifyServerOptions["logger"];
  readonly registry?: AssessmentRegistry;
  readonly runtime?: AssessmentRuntime;
  readonly executionManager?: ExecutionManager;
  readonly tokenValidator?: ApiTokenValidator;
  readonly graphTokenBroker?: GraphTokenBroker;
}

const INTERNAL_AUTH_CONTEXT_ALLOWANCE_BYTES = 68 * 1_024;

function mergedConfig(overrides: Partial<ApiConfig> | undefined): ApiConfig {
  return { ...loadConfig(), ...overrides };
}

function hasErrorField(error: unknown, field: string): boolean {
  return typeof error === "object" && error !== null && field in error;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function clientErrorStatusCode(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("statusCode" in error) ||
    typeof error.statusCode !== "number"
  ) {
    return undefined;
  }

  return error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : undefined;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = mergedConfig(options.config);
  // Fail closed before allocating Fastify/auth/runtime resources or listening.
  const registry = options.registry ?? createDefaultAssessmentRegistry(config.engineRoot);
  const app = Fastify({
    logger:
      options.logger === undefined
        ? createSecureLoggerOptions(config.nodeEnv)
        : options.logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: config.bodyLimitBytes,
    trustProxy: false,
    requestIdHeader: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, origin === undefined || origin === config.webOrigin);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    exposedHeaders: ["www-authenticate"],
    credentials: false,
    maxAge: 600,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (
      request.url.startsWith("/api/v1/") &&
      !reply.hasHeader("Cache-Control")
    ) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  const runtime =
    options.runtime ??
    new PowerShellRuntime({
      executable: config.powershellExecutable,
      maxArtifactBytes: config.maxArtifactBytes,
      // The internal context also carries a bounded delegated Graph token and
      // server-owned identifiers that are not part of the public body limit.
      maxContextBytes:
        config.bodyLimitBytes + INTERNAL_AUTH_CONTEXT_ALLOWANCE_BYTES,
      healthCacheMs: config.powershellHealthCacheMs,
    });
  const tokenValidator =
    options.tokenValidator ??
    new EntraTokenValidator({
      audience: config.entraApiClientId,
      authorizedParty: config.entraWebClientId,
      keyProvider: new MicrosoftOrganizationsKeyProvider(),
    });
  const auth = new EntraAuth(tokenValidator);
  auth.register(app);

  const graphTokenBroker =
    options.graphTokenBroker ??
    (options.executionManager
      ? undefined
      : new MsalOboService({
          clientId: config.entraApiClientId,
          clientSecret: config.entraApiClientSecret,
        }));
  const executionManager =
    options.executionManager ??
    new ExecutionManager({
      registry,
      runtime,
      artifactTtlMs: config.artifactTtlMs,
      maxConcurrentExecutions: config.maxConcurrentExecutions,
      graphTokenTimeoutMs: config.oboTimeoutMs,
      ...(graphTokenBroker ? { graphTokenBroker } : {}),
      onLifecycleEvent: (event) => {
        app.log.info(event, "Execution lifecycle event");
      },
    });

  registerHealthRoute(app, runtime);
  registerAssessmentRoutes(app, registry, executionManager, auth);
  registerExecutionRoutes(app, executionManager, auth);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource does not exist.",
      },
    });
  });

  app.setErrorHandler(async (error, _request, reply) => {
    let statusCode = 500;
    let code = "INTERNAL_ERROR";
    let message = "An internal error occurred.";

    if (error instanceof CloudOpsError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
      if (error.authenticateHeader) {
        reply.header("WWW-Authenticate", error.authenticateHeader);
      }
    } else if (errorCode(error) === "FST_ERR_CTP_BODY_TOO_LARGE") {
      statusCode = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = "The request payload is too large.";
    } else if (error instanceof ZodError || hasErrorField(error, "validation")) {
      statusCode = 400;
      code = "INVALID_REQUEST";
      message = "The request is invalid.";
    } else {
      const clientStatusCode = clientErrorStatusCode(error);
      if (clientStatusCode !== undefined) {
        statusCode = clientStatusCode;
        code = "INVALID_REQUEST";
        message = "The request is invalid.";
      }
    }

    app.log.error(
      { event: "request_failed", code, statusCode },
      "API request failed safely",
    );
    return reply.code(statusCode).send({ error: { code, message } });
  });

  app.addHook("onClose", async () => {
    executionManager.dispose();
  });

  return app;
}
