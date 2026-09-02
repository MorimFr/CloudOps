import {
  AssessmentSummarySchema,
  CreateExecutionResponseSchema,
  ExecutionSchema,
  type AssessmentExecutionRequest,
  type AssessmentSummary,
  type CreateExecutionResponse,
  type Execution,
} from "@cloudops/contracts";

const configuredApiUrl = import.meta.env.VITE_CLOUDOPS_API_URL?.trim();
const API_BASE_URL = (configuredApiUrl || "http://localhost:3000").replace(
  /\/+$/,
  "",
);

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
    // Do not include a raw response body in an error: it may contain sensitive data.
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

export function listAssessments(): Promise<AssessmentSummary[]> {
  return requestJson<unknown>("/api/v1/assessments").then((payload) =>
    AssessmentSummarySchema.array().parse(payload),
  );
}

export function createExecution(
  request: AssessmentExecutionRequest,
): Promise<CreateExecutionResponse> {
  return requestJson<unknown>(
    `/api/v1/assessments/${encodeURIComponent(request.assessmentId)}/executions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ options: request.options }),
    },
  ).then((payload) => CreateExecutionResponseSchema.parse(payload));
}

export function getExecution(executionId: string): Promise<Execution> {
  return requestJson<unknown>(
    `/api/v1/executions/${encodeURIComponent(executionId)}`,
  ).then((payload) => ExecutionSchema.parse(payload));
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
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/executions/${encodeURIComponent(executionId)}/artifact`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/zip",
      },
    },
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
    // Keep the URL alive only through the click dispatch; it is never stored in state.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
