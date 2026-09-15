import { linkSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_ASSESSMENT_MANIFEST_BYTES } from "@cloudops/contracts";
import { buildApp } from "../src/app.js";
import { discoverAssessmentManifests, defaultEngineRoot } from "../src/services/assessment-discovery.js";
import { AssessmentRegistry, createDefaultAssessmentRegistry } from "../src/services/assessment-registry.js";
import { AssessmentManifestError } from "../src/services/assessment-manifest-error.js";
import { createLocalAuthHarness } from "./auth-helpers.js";
import { ImmediateRuntime } from "./helpers.js";
import { syntheticManifest, temporaryEngine, writeSyntheticPlugin } from "./manifest-fixtures.js";

const roots: string[] = [];
function engine() { const root = temporaryEngine(); roots.push(root); return root; }
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("cloudops-manifest-test-")) throw new Error("Unsafe test cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("trusted manifest discovery", () => {
  it("adds a folder-only plugin to authenticated HTTP catalog and execution, then removes it on restart", async () => {
    const root = engine();
    const folder = writeSyntheticPlugin(root);
    const auth = await createLocalAuthHarness();
    const runtime = new ImmediateRuntime();
    const graphTokenBroker = { acquireToken: async () => { throw new Error("No Graph call expected in plugin lifecycle test"); } };
    const headers = { authorization: `Bearer ${await auth.issueToken()}` };
    const app = await buildApp({ logger: false, config: { engineRoot: root }, tokenValidator: auth.validator, runtime, graphTokenBroker });
    try {
      expect(runtime.calls).toHaveLength(0); // Script contains throw; discovery must never run it.
      const catalog = await app.inject({ method: "GET", url: "/api/v1/assessments", headers });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.json()).toEqual([expect.objectContaining({
        id: "test-assessment", name: "Synthetic assessment", provider: "azure", domain: "secops",
        moduleId: "security-assessments", moduleName: "Assessments", assessmentOrder: 50,
      })]);
      expect(catalog.body).not.toContain(root);
      expect(catalog.body).not.toContain("Invoke-Assessment.ps1");
      const started = await app.inject({ method: "POST", url: "/api/v1/assessments/test-assessment/executions", headers, payload: { options: {} } });
      expect(started.statusCode).toBe(202);
      expect(runtime.calls[0]?.assessment.scriptPath).toBe(path.join(folder, "Invoke-Assessment.ps1"));
      expect(runtime.calls[0]?.context.assessmentId).toBe("test-assessment");
      // Removal is effective only after a new discovery/startup, not a watcher.
      unlinkSync(path.join(folder, "assessment.json"));
      expect((await app.inject({ method: "GET", url: "/api/v1/assessments", headers })).json()).toHaveLength(1);
    } finally { await app.close(); }
    // Remove only this known synthetic plugin; the temporary engine stays intact.
    unlinkSync(path.join(folder, "Invoke-Assessment.ps1"));
    rmdirSync(folder);
    const restarted = await buildApp({ logger: false, config: { engineRoot: root }, tokenValidator: auth.validator, runtime, graphTokenBroker });
    try {
      expect((await restarted.inject({ method: "GET", url: "/api/v1/assessments", headers })).json()).toEqual([]);
      expect((await restarted.inject({ method: "POST", url: "/api/v1/assessments/test-assessment/executions", headers, payload: {} })).statusCode).toBe(404);
    } finally { await restarted.close(); }
  });

  it("ignores immediate directories without manifests and never discovers nested manifests", () => {
    const root = engine();
    writeSyntheticPlugin(root, "arbitrary-container/nested-plugin", syntheticManifest({ id: "nested-plugin" }));
    mkdirSync(path.join(root, "unrelated-directory"));
    writeFileSync(path.join(root, "assessment.json"), "not an immediate child directory");
    expect(discoverAssessmentManifests(root)).toEqual([]);
  });

  it("validates all real manifests and paths, independent of process working directory", () => {
    const plugins = discoverAssessmentManifests();
    expect(plugins).toHaveLength(4);
    for (const plugin of plugins) {
      expect(plugin.scriptPath).toBe(path.join(defaultEngineRoot(), plugin.manifest.id, "Invoke-Assessment.ps1"));
      expect(Object.isFrozen(plugin.manifest)).toBe(true);
      expect(Object.isFrozen(plugin.manifest.engine)).toBe(true);
    }
  });

  it.each([
    ["missing version", { schemaVersion: undefined }],
    ["unknown version", { schemaVersion: "cloudops.assessment.v99" }],
    ["missing ID", { id: undefined }],
    ["invalid ID", { id: "../unsafe" }],
    ["empty ID", { id: "" }],
    ["consecutive hyphens", { id: "bad--id" }],
    ["folder mismatch", { id: "another-assessment" }],
    ["invalid runtime", { engine: { runtime: "python", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds: 60 } }],
    ["unknown Graph permission", { auth: { provider: "microsoft-graph", permissions: ["Directory.ReadWrite.All"], adminConsentRequired: true } }],
    ["none with permissions", { auth: { provider: "none", permissions: ["User.Read"], adminConsentRequired: false } }],
    ["none with consent", { auth: { provider: "none", permissions: [], adminConsentRequired: true } }],
    ["empty Graph permissions", { auth: { provider: "microsoft-graph", permissions: [], adminConsentRequired: false } }],
    ["duplicate permissions", { auth: { provider: "microsoft-graph", permissions: ["User.Read", "User.Read"], adminConsentRequired: false } }],
    ["unknown fields", { secretUnknownKey: "must-not-be-reflected" }],
    ["unknown engine field", { engine: { runtime: "powershell", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds: 60, shell: true } }],
    ["unknown display field", { display: { svg: "<svg>must-not-be-reflected</svg>" } }],
    ["invalid icon", { display: { icon: "<svg>" } }],
    ["HTML tag", { display: { tags: ["<script>bad</script>"] } }],
    ["source URL", { display: { source: "https://example.invalid" } }],
  ])("fails closed for %s", (_name, overrides) => {
    const root = engine();
    writeSyntheticPlugin(root, "test-assessment", syntheticManifest(overrides));
    expect(() => discoverAssessmentManifests(root)).toThrow(AssessmentManifestError);
  });

  it.each(["/outside.ps1", "C:/outside.ps1", "C:outside.ps1", "\\\\server\\outside.ps1", "../outside.ps1", "scripts/../../outside.ps1", "scripts/../Invoke-Assessment.ps1", "other\\Invoke-Assessment.ps1", "Invoke-Assessment.txt", "Invoke-Assessment.ps1:stream", "Invoke-Assessment.ps1 -Command exit", "%2e%2e/outside.ps1"])("rejects unsafe entrypoint %s", (entrypoint) => {
    const root = engine();
    writeSyntheticPlugin(root, "test-assessment", syntheticManifest({ engine: { runtime: "powershell", entrypoint, timeoutSeconds: 60 } }));
    expect(() => discoverAssessmentManifests(root)).toThrow(/engine.entrypoint/);
  });

  it.each([0, -1, 3301, 1.5, "60"])("rejects timeout %s", (timeoutSeconds) => {
    const root = engine();
    writeSyntheticPlugin(root, "test-assessment", syntheticManifest({ engine: { runtime: "powershell", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds } }));
    expect(() => discoverAssessmentManifests(root)).toThrow(/expected integer from 1 to 3300/);
  });
  it.each([0, -1, 101, 1.5, "1"])("rejects concurrency %s", (maxConcurrentExecutions) => {
    const root = engine();
    writeSyntheticPlugin(root, "test-assessment", syntheticManifest({ engine: { runtime: "powershell", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds: 60, maxConcurrentExecutions } }));
    expect(() => discoverAssessmentManifests(root)).toThrow(/expected integer from 1 to 100/);
  });

  it.each(["missing", "directory"])("rejects %s entrypoint", (kind) => {
    const root = engine();
    const folder = writeSyntheticPlugin(root);
    unlinkSync(path.join(folder, "Invoke-Assessment.ps1"));
    if (kind === "directory") mkdirSync(path.join(folder, "Invoke-Assessment.ps1"));
    expect(() => discoverAssessmentManifests(root)).toThrow(/engine.entrypoint/);
  });

  it("accepts safe nested scripts without reading or executing their contents", () => {
    const root = engine();
    const folder = writeSyntheticPlugin(root, "test-assessment", syntheticManifest({ engine: { runtime: "powershell", entrypoint: "scripts/Run.ps1", timeoutSeconds: 1 } }));
    mkdirSync(path.join(folder, "scripts"));
    writeFileSync(path.join(folder, "scripts/Run.ps1"), "not even valid PowerShell");
    expect(discoverAssessmentManifests(root)[0]?.scriptPath).toBe(path.join(folder, "scripts/Run.ps1"));
  });

  it("rejects duplicate IDs, invalid modules and provider/domain mismatches", () => {
    const root = engine();
    writeSyntheticPlugin(root);
    writeSyntheticPlugin(root, "z-duplicate");
    expect(() => discoverAssessmentManifests(root)).toThrow(/duplicate assessment ID/);
    for (const overrides of [{ moduleId: "missing" }, { domain: "devops" }, { provider: "aws" }]) {
      const another = engine();
      writeSyntheticPlugin(another, "test-assessment", syntheticManifest(overrides));
      expect(() => createDefaultAssessmentRegistry(another)).toThrow(/module/);
    }
  });

  it.each(["{ invalid must-not-be-reflected", "null", "[]"])("rejects malformed/nonobject manifest %s", (contents) => {
    const root = engine();
    const folder = writeSyntheticPlugin(root);
    writeFileSync(path.join(folder, "assessment.json"), contents);
    expect(() => discoverAssessmentManifests(root)).toThrow(AssessmentManifestError);
  });
  it("enforces the byte limit, invalid UTF-8, regular manifest files and bounded safe errors", async () => {
    const root = engine();
    const folder = writeSyntheticPlugin(root);
    const manifest = path.join(folder, "assessment.json");
    for (const bytes of [Buffer.alloc(MAX_ASSESSMENT_MANIFEST_BYTES + 1, 32), Buffer.from([0xff, 0xfe, 0xfd])]) {
      writeFileSync(manifest, bytes);
      expect(() => discoverAssessmentManifests(root)).toThrow(AssessmentManifestError);
    }
    writeFileSync(manifest, JSON.stringify(syntheticManifest({ engine: { runtime: "powershell", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds: "must-not-be-reflected" } })));
    let failure: unknown;
    try { await buildApp({ logger: false, config: { engineRoot: root } }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AssessmentManifestError);
    expect((failure as Error).message).toContain("test-assessment/assessment.json; field: engine.timeoutSeconds");
    expect((failure as Error).message).not.toContain(root);
    expect((failure as Error).message).not.toContain("must-not-be-reflected");
    writeFileSync(manifest, JSON.stringify(syntheticManifest({ "must-not-be-reflected": "secret" })));
    expect(() => discoverAssessmentManifests(root)).toThrow(/unknown fields/);
    try { discoverAssessmentManifests(root); } catch (error) { expect((error as Error).message).not.toContain("must-not-be-reflected"); }
    unlinkSync(manifest);
    mkdirSync(manifest);
    expect(() => discoverAssessmentManifests(root)).toThrow(/regular file/);
  });

  for (const kind of ["entrypoint", "manifest", "parent", "plugin"]) it(`rejects linked ${kind} when supported`, (context) => {
    const root = engine();
    const outside = engine();
    const folder = writeSyntheticPlugin(root);
    const external = writeSyntheticPlugin(outside);
    try {
      if (kind === "entrypoint" || kind === "manifest") {
        const name = kind === "entrypoint" ? "Invoke-Assessment.ps1" : "assessment.json";
        unlinkSync(path.join(folder, name));
        symlinkSync(path.join(external, name), path.join(folder, name), "file");
      } else if (kind === "parent") {
        writeFileSync(path.join(folder, "assessment.json"), JSON.stringify(syntheticManifest({ engine: { runtime: "powershell", entrypoint: "linked/Invoke-Assessment.ps1", timeoutSeconds: 60 } })));
        symlinkSync(external, path.join(folder, "linked"), process.platform === "win32" ? "junction" : "dir");
      } else symlinkSync(external, path.join(root, "linked-plugin"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip(); return; }
      throw error;
    }
    expect(() => discoverAssessmentManifests(root)).toThrow(AssessmentManifestError);
  });
  it("rejects hard-linked entrypoints", () => {
    const root = engine();
    const folder = writeSyntheticPlugin(root);
    linkSync(path.join(folder, "Invoke-Assessment.ps1"), path.join(root, "alias.ps1"));
    expect(() => discoverAssessmentManifests(root)).toThrow(/hard links/);
  });

  it("discovers 100 small manifests deterministically without a registry source change", () => {
    const root = engine();
    for (let index = 99; index >= 0; index--) {
      const id = `synthetic-${String(index).padStart(3, "0")}`;
      writeSyntheticPlugin(root, id, syntheticManifest({ id }));
    }
    const registry = new AssessmentRegistry(discoverAssessmentManifests(root));
    expect(registry.list()).toHaveLength(100);
    expect(registry.list()[0]?.id).toBe("synthetic-000");
    expect(readFileSync(path.join(root, "synthetic-000/Invoke-Assessment.ps1"), "utf8")).toContain("Discovery must never execute");
  });
});
