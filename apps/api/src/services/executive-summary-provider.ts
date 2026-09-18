import { ManagedIdentityCredential } from "@azure/identity";
import { z } from "zod";
import {
  AI_EXECUTIVE_SUMMARY_JSON_SCHEMA, AiExecutiveSummarySchema, SanitizedExecutiveSummaryInputSchema,
  type AiExecutiveSummary, type SanitizedExecutiveSummaryInput,
} from "@cloudops/contracts";

export interface FoundrySummaryConfig {
  readonly endpoint: string;
  readonly deployment: string;
  readonly timeoutMs: number;
  readonly managedIdentityClientId?: string;
}
export interface ExecutiveSummaryProvider {
  summarize(input: SanitizedExecutiveSummaryInput, context: { signal: AbortSignal }): Promise<AiExecutiveSummary | null>;
}
export function loadFoundrySummaryConfig(env: NodeJS.ProcessEnv): FoundrySummaryConfig | undefined {
  if (env.CLOUDOPS_AI_PROVIDER !== "azure-foundry") return undefined;
  try {
    const endpoint = new URL(env.CLOUDOPS_AI_ENDPOINT ?? "");
    if (endpoint.protocol !== "https:" || !/^[a-z0-9][a-z0-9-]*\.openai\.azure\.com$/.test(endpoint.hostname)
      || endpoint.port !== "" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== "/") return undefined;
    const deployment = env.CLOUDOPS_AI_DEPLOYMENT ?? "";
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(deployment)) return undefined;
    const timeout = env.CLOUDOPS_AI_TIMEOUT_SECONDS ?? "20";
    if (!/^\d+$/.test(timeout) || Number(timeout) < 15 || Number(timeout) > 30) return undefined;
    const clientId = env.CLOUDOPS_AI_MANAGED_IDENTITY_CLIENT_ID;
    if (clientId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId)) return undefined;
    return { endpoint: endpoint.origin, deployment, timeoutMs: Number(timeout) * 1000,
      ...(clientId ? { managedIdentityClientId: clientId } : {}) };
  } catch { return undefined; }
}

type TokenProvider = (signal: AbortSignal) => Promise<string>;
interface Dependencies { readonly fetch?: typeof fetch; readonly tokenProvider?: TokenProvider }
interface QuietLogger {
  (): void;
  enabled: boolean; namespace: string; destroy(): boolean; log(): void; extend(namespace: string): QuietLogger;
}
const quietLogger: QuietLogger = Object.assign(() => undefined, {
  enabled: false, namespace: "cloudops:ai-disabled-logging", destroy: () => true, log: () => undefined,
  extend: () => quietLogger,
});
const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().max(24_000).optional() })).max(8).optional() })).max(16),
});

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Unavailable response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let joined: Buffer | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { value.fill(0); throw new Error("Response limit"); }
      chunks.push(value);
    }
    joined = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock(); joined?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
  }
}
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Aborted");
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("Aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** No sessions, tools, cache, logs, persistence or authoritative assessment writes. */
export class FoundryExecutiveSummaryProvider implements ExecutiveSummaryProvider {
  readonly #fetch: typeof fetch;
  readonly #token: TokenProvider;
  readonly #config: FoundrySummaryConfig;
  constructor(config: FoundrySummaryConfig, dependencies: Dependencies = {}) {
    // Revalidate even code-level construction; request options never choose a host.
    const validatedConfig = loadFoundrySummaryConfig({ CLOUDOPS_AI_PROVIDER: "azure-foundry", CLOUDOPS_AI_ENDPOINT: config.endpoint,
      CLOUDOPS_AI_DEPLOYMENT: config.deployment, CLOUDOPS_AI_TIMEOUT_SECONDS: String(config.timeoutMs / 1000),
      ...(config.managedIdentityClientId ? { CLOUDOPS_AI_MANAGED_IDENTITY_CLIENT_ID: config.managedIdentityClientId } : {}) });
    if (!validatedConfig) {
      throw new Error("Invalid AI provider configuration");
    }
    this.#config = Object.freeze(validatedConfig);
    this.#fetch = dependencies.fetch ?? fetch;
    if (dependencies.tokenProvider) this.#token = dependencies.tokenProvider;
    else {
      const credential = new ManagedIdentityCredential({
        ...(this.#config.managedIdentityClientId ? { clientId: this.#config.managedIdentityClientId } : {}),
        retryOptions: { maxRetries: 0 },
        loggingOptions: { logger: quietLogger },
      });
      this.#token = async (signal) => (await credential.getToken("https://ai.azure.com/.default", { abortSignal: signal })).token;
    }
  }
  async summarize(input: SanitizedExecutiveSummaryInput, context: { signal: AbortSignal }): Promise<AiExecutiveSummary | null> {
    const parsed = SanitizedExecutiveSummaryInputSchema.safeParse(input);
    if (!parsed.success || context.signal.aborted) return null;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, context.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + this.#config.timeoutMs;
    let abort: (() => void) | undefined;
    const fallback = new Promise<null>((resolve) => {
      abort = () => resolve(null);
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => controller.abort(), this.#config.timeoutMs); timer.unref();
    });
    try {
      return await Promise.race([this.#request(parsed.data, signal, deadline).catch(() => null), fallback]);
    } finally {
      clearTimeout(timer);
      if (abort) signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  async #request(input: SanitizedExecutiveSummaryInput, signal: AbortSignal, deadline: number): Promise<AiExecutiveSummary | null> {
    const transient = { token: "", body: "" };
    try {
      transient.token = await this.#token(signal);
      if (signal.aborted) return null;
      transient.body = JSON.stringify({ model: this.#config.deployment, store: false, background: false,
        max_output_tokens: 1800,
        instructions: "Escreva em português uma narrativa executiva breve somente sobre os dados fornecidos. Cobertura parcial da Wave 1, nunca certificação CIS. Não invente identidades, fatos, custos ou causas. Não emita novos vereditos, classificações, contagens ou recomendações de configuração. Status, evidência, risco e recomendações determinísticos são autoritativos. Contextualize as prioridades sem alterá-los. Retorne apenas o JSON solicitado.",
        input: JSON.stringify(input),
        text: { format: { type: "json_schema", name: "cloudops_executive_summary", strict: true, schema: AI_EXECUTIVE_SUMMARY_JSON_SCHEMA } },
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) return null;
        const response = await this.#fetch(`${this.#config.endpoint}/openai/v1/responses`, {
          method: "POST", headers: { Authorization: `Bearer ${transient.token}`, "Content-Type": "application/json" },
          body: transient.body, signal, redirect: "error", cache: "no-store", credentials: "omit",
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          if (attempt || ![429, 500, 502, 503, 504].includes(response.status)) return null;
          const retryAfter = response.headers.get("retry-after");
          const wait = retryAfter === null ? 300 : /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          if (!Number.isFinite(wait) || wait < 0 || wait + 100 >= deadline - Date.now()) return null;
          await delay(wait, signal); continue;
        }
        const responseData = responseSchema.safeParse(await boundedJson(response));
        if (!responseData.success || signal.aborted) return null;
        const messages = responseData.data.output.filter((item) => item.type === "message");
        if (messages.length !== 1 || messages[0]!.content?.length !== 1) return null;
        const content = messages[0]!.content[0]!;
        if (content.type !== "output_text" || !content.text) return null;
        const summary = AiExecutiveSummarySchema.safeParse(JSON.parse(content.text) as unknown);
        return summary.success ? summary.data : null;
      }
      return null;
    } finally { transient.token = ""; transient.body = ""; }
  }
}
