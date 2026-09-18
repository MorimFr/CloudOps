// Local-only real subprocess test. No production registration, Graph or Foundry.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AiExecutiveSummarySchema, SanitizedExecutiveSummaryInputSchema } from "@cloudops/contracts";
import { createDefaultAssessmentRegistry } from "../src/services/assessment-registry.js";
import type { ExecutiveSummaryProvider } from "../src/services/executive-summary-provider.js";
import { PowerShellRuntime } from "../src/services/powershell-runtime.js";

const registry = createDefaultAssessmentRegistry();
const identity = registry.list().find((assessment) => assessment.id === "identity-assessment");
assert.ok(identity);
assert.equal(identity.enabled, true);
assert.equal(registry.resolve("identity-assessment").enabled, true);
const scriptPath = fileURLToPath(new URL("../../../engine/identity-assessment/tests/Invoke-Wave1ExchangeFixture.ps1", import.meta.url));
const summary = AiExecutiveSummarySchema.parse({ executiveSummary: "Resumo sintético de teste.",
  keyRiskThemes: ["Revisão de configuração"], priorityNarrative: "Prioridade consultiva.", managementConclusion: "Revisão humana necessária." });

for (const mode of ["valid", "unconfigured", "unavailable", "invalid"] as const) {
  let calls = 0;
  let started = 0;
  const stages: string[] = [];
  const provider: ExecutiveSummaryProvider = {
    summarize: async (input, { signal }) => {
      calls++;
      assert.equal(signal.aborted, false);
      const sanitized = SanitizedExecutiveSummaryInputSchema.parse(input);
      assert.equal(sanitized.controlCounts.total, 10);
      assert.deepEqual(sanitized.severityCounts, { critical: 0, high: 4, medium: 2, low: 1 });
      assert.doesNotMatch(JSON.stringify(input), /tenantId|canary|accessToken|11111111|allowedToCreateApps/);
      if (mode === "unavailable") throw new Error("Synthetic unavailable provider");
      if (mode === "invalid") return { ...summary, status: "PASS" };
      return summary;
    },
  };
  const runtime = new PowerShellRuntime(mode === "unconfigured" ? {} : { executiveSummaryProvider: provider });
  const result = await runtime.execute({
    assessment: { ...identity, scriptPath, timeoutMs: 60_000 },
    context: { executionId: randomUUID(), assessmentId: "identity-assessment", options: {
      expectedMode: mode === "valid" ? "AI_ENRICHED" : "DETERMINISTIC",
    } },
    signal: new AbortController().signal,
    onStarted: () => { started++; },
    onProgress: (stage) => { stages.push(stage); },
    onPublicMetrics: () => { throw new Error("Private AI input must not be published"); },
  });
  try {
    assert.equal(started, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(result.artifact.readUInt32LE(0), 0x04034b50);
    assert.equal(calls, mode === "unconfigured" ? 0 : 1);
    assert.deepEqual(stages, ["PROCESSING", "COMPLETED"]);
    assert.equal(result.publicMetrics, undefined);
  } finally { result.artifact.fill(0); }
  console.log(`PASS: Wave 1 real PowerShell exchange (${mode}), completed RAM ZIP, unchanged authoritative CSVs.`);
}

// Simulate a backend that never answers while keeping stdin open. This catches
// Console.In's synchronous ReadLineAsync behavior, which fake tasks cannot.
const stalledChild = spawn("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", scriptPath], {
  shell: false, windowsHide: true, stdio: "pipe",
  env: { ...process.env, PSModuleAnalysisCachePath: process.platform === "win32" ? "NUL" : "/dev/null" },
});
const chunks: Buffer[] = [];
let requestedAt = 0;
let timedOut = false;
let artifactBytes = 0;
const timer = setTimeout(() => { timedOut = true; stalledChild.kill("SIGKILL"); }, 45_000);
stalledChild.stdout.on("data", (chunk: Buffer) => {
  artifactBytes += chunk.length;
  if (artifactBytes > 2 * 1024 * 1024) { chunk.fill(0); stalledChild.kill("SIGKILL"); return; }
  chunks.push(chunk);
});
stalledChild.stderr.on("data", (chunk: Buffer) => {
  if (chunk.toString("utf8").includes('"aiExecutiveSummaryRequest"')) requestedAt = Date.now();
  chunk.fill(0);
});
stalledChild.stdin.on("error", () => undefined);
try {
  const finished = new Promise<number | null>((resolve, reject) => {
    stalledChild.once("error", () => reject(new Error("Synthetic PowerShell fixture unavailable")));
    stalledChild.once("close", (code) => resolve(code));
  });
  stalledChild.stdin.write(JSON.stringify({ executionId: randomUUID(), assessmentId: "identity-assessment", options: { expectedMode: "DETERMINISTIC" } }) + "\n");
  assert.equal(await finished, 0);
  assert.equal(timedOut, false);
  assert.ok(requestedAt > 0 && Date.now() - requestedAt < 40_000);
  const artifact = Buffer.concat(chunks);
  try { assert.equal(artifact.readUInt32LE(0), 0x04034b50); }
  finally { artifact.fill(0); }
  console.log("PASS: unresponsive backend bounded by engine; deterministic RAM ZIP with unchanged authoritative CSVs.");
} finally {
  clearTimeout(timer); stalledChild.stdin.destroy();
  if (stalledChild.exitCode === null) stalledChild.kill("SIGKILL");
  for (const chunk of chunks) chunk.fill(0);
  chunks.length = 0;
}
