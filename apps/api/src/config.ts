const KIBIBYTE = 1_024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;

export interface ApiConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly webOrigin: string;
  readonly bodyLimitBytes: number;
  readonly artifactTtlMs: number;
  readonly maxConcurrentExecutions: number;
  readonly maxArtifactBytes: number;
  readonly powershellExecutable: string;
  readonly powershellHealthCacheMs: number;
  readonly engineRoot?: string;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid numeric configuration: ${name}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Numeric configuration is outside the allowed range: ${name}`);
  }

  return parsed;
}

function parseNodeEnvironment(
  value: string | undefined,
): ApiConfig["nodeEnv"] {
  if (value === undefined || value === "") {
    return "development";
  }

  if (value === "development" || value === "test" || value === "production") {
    return value;
  }

  throw new Error("NODE_ENV must be development, test, or production");
}

function parseWebOrigin(value: string | undefined): string {
  const rawOrigin = value?.trim() || "http://localhost:5173";
  let parsed: URL;

  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error("WEB_ORIGIN must be a valid HTTP origin");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin === "null"
  ) {
    throw new Error("WEB_ORIGIN must be a single HTTP origin without credentials or a path");
  }

  return parsed.origin;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const ttlSeconds = parseInteger(
    environment.ARTIFACT_TTL_SECONDS,
    300,
    "ARTIFACT_TTL_SECONDS",
    1,
    86_400,
  );

  return {
    nodeEnv: parseNodeEnvironment(environment.NODE_ENV),
    host: environment.HOST?.trim() || "0.0.0.0",
    port: parseInteger(environment.PORT, 3_000, "PORT", 1, 65_535),
    webOrigin: parseWebOrigin(environment.WEB_ORIGIN),
    bodyLimitBytes: parseInteger(
      environment.REQUEST_BODY_LIMIT_BYTES,
      64 * KIBIBYTE,
      "REQUEST_BODY_LIMIT_BYTES",
      KIBIBYTE,
      MEBIBYTE,
    ),
    artifactTtlMs: ttlSeconds * 1_000,
    maxConcurrentExecutions: parseInteger(
      environment.MAX_CONCURRENT_EXECUTIONS,
      2,
      "MAX_CONCURRENT_EXECUTIONS",
      1,
      100,
    ),
    maxArtifactBytes: parseInteger(
      environment.MAX_ARTIFACT_BYTES,
      25 * MEBIBYTE,
      "MAX_ARTIFACT_BYTES",
      KIBIBYTE,
      250 * MEBIBYTE,
    ),
    powershellExecutable:
      environment.POWERSHELL_EXECUTABLE?.trim() || "pwsh",
    powershellHealthCacheMs: parseInteger(
      environment.POWERSHELL_HEALTH_CACHE_SECONDS,
      60,
      "POWERSHELL_HEALTH_CACHE_SECONDS",
      1,
      3_600,
    ) * 1_000,
    ...(environment.CLOUDOPS_ENGINE_ROOT?.trim()
      ? { engineRoot: environment.CLOUDOPS_ENGINE_ROOT.trim() }
      : {}),
  };
}
