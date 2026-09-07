import {
  AssessmentSummarySchema,
  CreateExecutionResponseSchema,
  ExecutionSchema,
  type AssessmentExecutionRequest,
  type AssessmentSummary,
  type CreateExecutionResponse,
  type Execution,
} from "@cloudops/contracts";

import type { ApiAccessTokenProvider } from "../auth/types";

const configuredApiUrl = import.meta.env.VITE_CLOUDOPS_API_URL?.trim();

function resolveApiBaseUrl(value: string | undefined): string {
  const candidate = value || "http://localhost:3000";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("VITE_CLOUDOPS_API_URL must be a valid HTTP origin.");
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("VITE_CLOUDOPS_API_URL must be a single HTTP origin.");
  }
  return parsed.origin;
}

const API_BASE_URL = resolveApiBaseUrl(configuredApiUrl);
const MAX_CHALLENGE_HEADER_LENGTH = 16_384;
const MAX_CLAIMS_LENGTH = 8_192;
const TENANT_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class CloudOpsApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code = "CLOUDOPS_API_ERROR") {
    super(message);
    this.name = "CloudOpsApiError";
    this.code = code;
    this.status = status;
  }
}

async function toApiError(response: Response): Promise<CloudOpsApiError> {
  let envelope: ErrorEnvelope | undefined;

  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    // Raw response bodies can contain sensitive upstream details.
  }

  const message =
    typeof envelope?.error?.message === "string"
      ? envelope.error.message
      : "Não foi possível concluir a solicitação ao CloudOps.";
  const code =
    typeof envelope?.error?.code === "string"
      ? envelope.error.code
      : "CLOUDOPS_API_ERROR";

  return new CloudOpsApiError(message, response.status, code);
}

function decodeClaims(encoded: string): string | null {
  if (encoded.length === 0 || encoded.length > MAX_CLAIMS_LENGTH * 2) {
    return null;
  }

  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  try {
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.length === 0 || decoded.length > MAX_CLAIMS_LENGTH) {
      return null;
    }
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

interface MicrosoftInteractionChallenge {
  readonly claims?: string;
}

function parseMicrosoftInteractionChallenge(
  header: string | null,
): MicrosoftInteractionChallenge | null {
  if (
    !header ||
    header.length > MAX_CHALLENGE_HEADER_LENGTH ||
    !/^Bearer\s/i.test(header)
  ) {
    return null;
  }

  const errorMatch = header.match(/\berror="([^"]+)"/i);
  const challengeError = errorMatch?.[1]?.toLowerCase();
  if (
    challengeError !== "insufficient_claims" &&
    challengeError !== "interaction_required"
  ) {
    return null;
  }

  const claimsMatch = header.match(/\bclaims="([A-Za-z0-9+/_=-]+)"/i);
  const authorityMatch = header.match(/\bauthorization_uri="([^"]+)"/i);
  if (!authorityMatch?.[1]) {
    return null;
  }

  let authority: URL;
  try {
    authority = new URL(authorityMatch[1]);
  } catch {
    return null;
  }

  const pathMatch = authority.pathname.match(
    /^\/([0-9a-f-]+)\/oauth2\/v2\.0\/authorize$/i,
  );
  if (
    authority.protocol !== "https:" ||
    authority.hostname !== "login.microsoftonline.com" ||
    authority.username !== "" ||
    authority.password !== "" ||
    authority.port !== "" ||
    authority.search !== "" ||
    authority.hash !== "" ||
    !pathMatch?.[1] ||
    !TENANT_GUID_PATTERN.test(pathMatch[1])
  ) {
    return null;
  }

  if (!claimsMatch?.[1]) {
    return challengeError === "interaction_required" ? {} : null;
  }

  const claims = decodeClaims(claimsMatch[1]);
  return claims ? { claims } : null;
}

export function parseClaimsChallenge(header: string | null): string | null {
  return parseMicrosoftInteractionChallenge(header)?.claims ?? null;
}

function hasUnsafeTokenCharacter(token: string): boolean {
  for (let index = 0; index < token.length; index += 1) {
    const codeUnit = token.charCodeAt(index);
    if (codeUnit <= 0x20 || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

function assertAccessToken(token: string): void {
  if (
    token.length < 32 ||
    token.length > 65_536 ||
    hasUnsafeTokenCharacter(token)
  ) {
    throw new CloudOpsApiError(
      "A sessão Microsoft não forneceu um token válido para a CloudOps API.",
      401,
      "AUTHENTICATION_REQUIRED",
    );
  }
}

async function sendAuthorized(
  path: string,
  init: RequestInit,
  accessToken: string,
): Promise<Response> {
  assertAccessToken(accessToken);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } finally {
    headers.delete("Authorization");
  }
}

async function requestAuthorized(
  path: string,
  init: RequestInit,
  tokenProvider: ApiAccessTokenProvider,
): Promise<Response> {
  const accessToken = await tokenProvider();
  let response = await sendAuthorized(path, init, accessToken);

  if (response.status === 401) {
    const challenge = parseMicrosoftInteractionChallenge(
      response.headers.get("WWW-Authenticate"),
    );
    if (challenge) {
      const challengedToken = await tokenProvider({
        ...(challenge.claims ? { claims: challenge.claims } : {}),
        forceRefresh: true,
        interactive: true,
      });
      response = await sendAuthorized(path, init, challengedToken);
    }
  }

  return response;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  tokenProvider: ApiAccessTokenProvider,
): Promise<T> {
  const response = await requestAuthorized(path, init, tokenProvider);
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

export function listAssessments(
  tokenProvider: ApiAccessTokenProvider,
): Promise<AssessmentSummary[]> {
  return requestJson<unknown>("/api/v1/assessments", {}, tokenProvider).then(
    (payload) => AssessmentSummarySchema.array().parse(payload),
  );
}

export function createExecution(
  request: AssessmentExecutionRequest,
  tokenProvider: ApiAccessTokenProvider,
): Promise<CreateExecutionResponse> {
  return requestJson<unknown>(
    `/api/v1/assessments/${encodeURIComponent(request.assessmentId)}/executions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: request.options }),
    },
    tokenProvider,
  ).then((payload) => CreateExecutionResponseSchema.parse(payload));
}

export function getExecution(
  executionId: string,
  tokenProvider: ApiAccessTokenProvider,
): Promise<Execution> {
  return requestJson<unknown>(
    `/api/v1/executions/${encodeURIComponent(executionId)}`,
    {},
    tokenProvider,
  ).then((payload) => ExecutionSchema.parse(payload));
}

export async function cancelExecution(
  executionId: string,
  tokenProvider: ApiAccessTokenProvider,
): Promise<void> {
  const response = await requestAuthorized(
    `/api/v1/executions/${encodeURIComponent(executionId)}`,
    { method: "DELETE" },
    tokenProvider,
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
}

function safeFilename(disposition: string | null, executionId: string): string {
  const fallbackId = executionId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fallback = `cloudops-${fallbackId || "assessment"}.zip`;

  if (!disposition) {
    return fallback;
  }

  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  const plainMatch = disposition.match(/filename=([^;]+)/i);
  const candidate = encodedMatch?.[1] ?? quotedMatch?.[1] ?? plainMatch?.[1];
  if (!candidate) {
    return fallback;
  }

  let decoded = candidate.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return fallback;
  }

  const sanitized = Array.from(decoded, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? "-" : character;
  })
    .join("")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+/, "")
    .trim();

  return sanitized.toLowerCase().endsWith(".zip") && sanitized.length <= 180
    ? sanitized
    : fallback;
}

export async function downloadExecutionArtifact(
  executionId: string,
  tokenProvider: ApiAccessTokenProvider,
): Promise<void> {
  const response = await requestAuthorized(
    `/api/v1/executions/${encodeURIComponent(executionId)}/artifact`,
    {
      method: "GET",
      headers: { Accept: "application/zip" },
    },
    tokenProvider,
  );

  if (!response.ok) {
    throw await toApiError(response);
  }

  const artifact = await response.blob();
  const objectUrl = URL.createObjectURL(artifact);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeFilename(
    response.headers.get("Content-Disposition"),
    executionId,
  );
  anchor.hidden = true;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
