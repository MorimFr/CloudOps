import { afterEach, describe, expect, it, vi } from "vitest";
import { SanitizedExecutiveSummaryInputSchema } from "@cloudops/contracts";
import { FoundryExecutiveSummaryProvider, loadFoundrySummaryConfig } from "../src/services/executive-summary-provider.js";

const config = { endpoint: "https://synthetic.openai.azure.com", deployment: "configured-test-deployment", timeoutMs: 20_000 };
const input = SanitizedExecutiveSummaryInputSchema.parse({ framework: "cis-m365", frameworkVersion: "7.0.0", profile: "E3_L1",
  controlCounts: { total: 1, passed: 0, failed: 1, manual: 0, unknown: 0, error: 0, notApplicable: 0 },
  severityCounts: { critical: 0, high: 1, medium: 0, low: 0 },
  findings: [{ controlId: "cis-m365-5-1-2-2", area: "applications-consent", status: "FAIL", severity: "HIGH", facts: {}, gapLabel: "application-registration-enabled" }],
});
const summary = { executiveSummary: "Resumo sintético.", keyRiskThemes: ["Configuração"], priorityNarrative: "Revisar prioridades.", managementConclusion: "Revisão humana." };
const envelope = (value: unknown = summary) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const response = (value: unknown = envelope()) => new Response(JSON.stringify(value));
const context = () => ({ signal: new AbortController().signal });
afterEach(() => vi.useRealTimers());

describe("stateless Foundry executive summary", () => {
  it("is disabled unless configuration is complete and safe", () => {
    expect(loadFoundrySummaryConfig({})).toBeUndefined();
    const env = { CLOUDOPS_AI_PROVIDER: "azure-foundry", CLOUDOPS_AI_ENDPOINT: config.endpoint, CLOUDOPS_AI_DEPLOYMENT: config.deployment };
    expect(loadFoundrySummaryConfig(env)).toEqual(config);
    for (const endpoint of ["http://synthetic.openai.azure.com", "https://evil.invalid", "https://synthetic.openai.azure.com.evil.invalid", "https://user@synthetic.openai.azure.com", "https://synthetic.openai.azure.com/path", "https://synthetic.openai.azure.com?q=1", "https://127.0.0.1"]) {
      expect(loadFoundrySummaryConfig({ ...env, CLOUDOPS_AI_ENDPOINT: endpoint })).toBeUndefined();
    }
    expect(loadFoundrySummaryConfig({ ...env, CLOUDOPS_AI_TIMEOUT_SECONDS: "31" })).toBeUndefined();
    expect(loadFoundrySummaryConfig({ ...env, CLOUDOPS_AI_DEPLOYMENT: "" })).toBeUndefined();
  });
  it("uses configured deployment, Entra token, store=false, strict schema and no history", async () => {
    const fetchFake = vi.fn<typeof fetch>().mockResolvedValue(response());
    const token = vi.fn().mockResolvedValue("synthetic-token");
    const provider = new FoundryExecutiveSummaryProvider(config, { fetch: fetchFake, tokenProvider: token });
    expect(await provider.summarize(input, context())).toEqual(summary);
    const [url, init] = fetchFake.mock.calls[0]!;
    expect(url).toBe(`${config.endpoint}/openai/v1/responses`);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", credentials: "omit", headers: { Authorization: "Bearer synthetic-token" } });
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: config.deployment, store: false, background: false, text: { format: { type: "json_schema", strict: true, schema: { additionalProperties: false } } } });
    expect(JSON.parse(body.input as string)).toEqual(input);
    for (const key of ["previous_response_id", "conversation", "tools", "metadata", "stream"]) expect(body).not.toHaveProperty(key);
    expect(JSON.stringify(body)).not.toContain("synthetic-token");
  });
  it("pins a normalized configuration against later caller mutation", async () => {
    const mutable = { ...config, endpoint: config.endpoint + "/" };
    const fetchFake = vi.fn<typeof fetch>().mockResolvedValue(response());
    const provider = new FoundryExecutiveSummaryProvider(mutable, { fetch: fetchFake, tokenProvider: async () => "fake" });
    mutable.endpoint = "https://evil.invalid";
    mutable.deployment = "changed";
    expect(await provider.summarize(input, context())).toEqual(summary);
    expect(fetchFake.mock.calls[0]![0]).toBe(`${config.endpoint}/openai/v1/responses`);
    expect(JSON.parse(fetchFake.mock.calls[0]![1]!.body as string).model).toBe(config.deployment);
  });
  it.each([429, 500, 502, 503, 504])("retries %s at most once within one deadline", async (status) => {
    vi.useFakeTimers();
    const fetchFake = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status, headers: { "retry-after": "0.1" } })).mockResolvedValueOnce(response());
    const provider = new FoundryExecutiveSummaryProvider(config, { fetch: fetchFake, tokenProvider: async () => "fake" });
    const pending = provider.summarize(input, context());
    await vi.advanceTimersByTimeAsync(110);
    expect(await pending).toEqual(summary); expect(fetchFake).toHaveBeenCalledTimes(2);
  });
  it("returns fallback after two failures and never waits minutes for Retry-After", async () => {
    vi.useFakeTimers();
    const fetchFake = vi.fn<typeof fetch>().mockImplementation(async () => new Response("", { status: 500 }));
    const provider = new FoundryExecutiveSummaryProvider(config, { fetch: fetchFake, tokenProvider: async () => "fake" });
    const pending = provider.summarize(input, context()); await vi.advanceTimersByTimeAsync(301);
    expect(await pending).toBeNull(); expect(fetchFake).toHaveBeenCalledTimes(2);
    fetchFake.mockReset().mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "120" } }));
    expect(await provider.summarize(input, context())).toBeNull(); expect(fetchFake).toHaveBeenCalledTimes(1);
  });
  it("bounds token acquisition and providers that ignore abort", async () => {
    vi.useFakeTimers(); const fetchFake = vi.fn<typeof fetch>(); let signal: AbortSignal | undefined;
    const provider = new FoundryExecutiveSummaryProvider(config, { fetch: fetchFake, tokenProvider: async (s) => { signal = s; return new Promise(() => undefined); } });
    const pending = provider.summarize(input, context()); await vi.advanceTimersByTimeAsync(20_001);
    expect(await pending).toBeNull(); expect(signal?.aborted).toBe(true); expect(fetchFake).not.toHaveBeenCalled();
  });
  it("aborts network work on explicit assessment cancellation", async () => {
    const abort = new AbortController(); let signal: AbortSignal | null | undefined;
    const fetchFake = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { signal = init?.signal; return new Promise(() => undefined); });
    const provider = new FoundryExecutiveSummaryProvider(config, { fetch: fetchFake, tokenProvider: async () => "fake" });
    const pending = provider.summarize(input, { signal: abort.signal });
    await Promise.resolve(); abort.abort(); expect(await pending).toBeNull(); expect(signal?.aborted).toBe(true);
  });
  it.each(["malformed", "schema", "authority", "refusal", "oversized", "partial"])("falls back for %s without retry", async (kind) => {
    const output = kind === "malformed" ? new Response("not-json") : kind === "oversized" ? new Response("x".repeat(65537))
      : kind === "partial" ? response({ ...envelope(), status: "incomplete" })
      : kind === "refusal" ? response({ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] })
      : response(envelope(kind === "authority" ? { ...summary, status: "PASS" } : { ...summary, keyRiskThemes: "invalid" }));
    const fetchFake = vi.fn<typeof fetch>().mockResolvedValue(output);
    const provider = new FoundryExecutiveSummaryProvider(config, { fetch: fetchFake, tokenProvider: async () => "fake" });
    expect(await provider.summarize(input, context())).toBeNull(); expect(fetchFake).toHaveBeenCalledTimes(1);
  });
  it("rejects unsanitized input before token acquisition", async () => {
    const token = vi.fn(); const provider = new FoundryExecutiveSummaryProvider(config, { tokenProvider: token });
    expect(await provider.summarize({ ...input, tenantId: "forbidden" } as typeof input, context())).toBeNull();
    expect(token).not.toHaveBeenCalled();
  });
});
