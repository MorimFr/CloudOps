import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssessmentDefinitionSchema, ControlPackSchema, MAX_ASSESSMENT_DEFINITION_BYTES, MAX_CONTROL_PACK_BYTES,
} from "@cloudops/contracts";
import { buildApp } from "../src/app.js";
import { discoverAssessmentManifests } from "../src/services/assessment-discovery.js";
import { createDefaultAssessmentRegistry } from "../src/services/assessment-registry.js";
import { controlPackContentHash, discoverControlPacks } from "../src/services/control-pack-discovery.js";
import { ControlPackValidationError, validateControlPackPlan } from "../src/services/control-pack-validation.js";
import { createLocalAuthHarness } from "./auth-helpers.js";
import { ImmediateRuntime } from "./helpers.js";
import { syntheticManifest, syntheticPlugin, temporaryEngine, writeSyntheticPlugin } from "./manifest-fixtures.js";

function control(overrides: Record<string, unknown> = {}) {
  return {
    id: "DEV-TEST-001", title: "Synthetic threshold", area: "configuration", order: 1,
    evaluationType: "AUTOMATED", collectorRequirements: ["fixture-summary"], evaluator: "fixture-threshold",
    severity: "MEDIUM", recommendationId: "fixture-review", parameters: { minimumCount: 1 }, ...overrides,
  };
}
function pack(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.control-pack.v1", id: "fixture-pack", name: "Synthetic fixture pack",
    framework: "cloudops-development", frameworkVersion: "1.0", controlPackVersion: "1.0.0",
    scope: ["configuration"], source: { kind: "DEVELOPMENT", reference: "Repository synthetic fixtures" },
    controls: [control()], ...overrides,
  };
}
function collector(overrides: Record<string, unknown> = {}) {
  return {
    id: "fixture-summary", version: "1.0.0", requiredPermissions: [], requiredCapabilities: [],
    requiresAuthentication: false, ...overrides,
  };
}
function definition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.assessment-definition.v1", assessmentId: "test-assessment",
    assessmentVersion: "0.1.0", sdkVersion: "cloudops.assessment-sdk.v1", capabilities: [], aiFactAllowlist: ["count"],
    collectors: [collector()], evaluators: [{ id: "fixture-threshold", version: "1.0.0", collectorRequirements: ["fixture-summary"] }],
    recommendations: [{
      recommendationId: "fixture-review", title: "Review fixture", summary: "Development fixture only.",
      technicalSteps: ["Review the synthetic counters."], portalPath: [], impact: "No production changes.",
      rollback: ["Restore the fixture."], validation: ["Run the evaluator again."],
    }],
    controlPacks: [{ id: "fixture-pack", version: "1.0.0", file: "fixture-pack.json", sha256: "a".repeat(64) }],
    ...overrides,
  };
}

const roots: string[] = [];
function engine() { const root = temporaryEngine(); roots.push(root); return root; }
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("cloudops-manifest-test-")) throw new Error("Unsafe SDK test cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
});

function writeSdk(root: string, options: { id?: string; pack?: unknown; definition?: Record<string, unknown>; packText?: string } = {}) {
  const id = options.id ?? "test-assessment";
  const folder = writeSyntheticPlugin(root, id, syntheticManifest({ id }));
  const controlPack = options.pack ?? pack();
  const packText = options.packText ?? JSON.stringify(controlPack, null, 2);
  const profile = definition({
    assessmentId: id,
    controlPacks: [{ id: "fixture-pack", version: "1.0.0", file: "fixture-pack.json", sha256: controlPackContentHash(packText) }],
    ...options.definition,
  });
  mkdirSync(path.join(folder, "control-packs"));
  writeFileSync(path.join(folder, "assessment-sdk.json"), JSON.stringify(profile));
  writeFileSync(path.join(folder, "control-packs", "fixture-pack.json"), packText);
  return { folder, profile, packPath: path.join(folder, "control-packs", "fixture-pack.json"), definitionPath: path.join(folder, "assessment-sdk.json") };
}
function discover(root: string) { return discoverControlPacks(discoverAssessmentManifests(root), root); }
function plan(rawPack: unknown = pack(), rawDefinition: unknown = definition(), selection?: readonly string[]) {
  return validateControlPackPlan(ControlPackSchema.parse(rawPack), AssessmentDefinitionSchema.parse(rawDefinition), syntheticPlugin().manifest, selection);
}
function safeFailure(action: () => unknown, root: string) {
  try { action(); throw new Error("Expected static SDK validation failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(ControlPackValidationError);
    expect((error as Error).message).not.toContain(root);
    expect((error as Error).message).not.toContain("must-not-be-reflected");
    expect((error as Error).message.length).toBeLessThan(220);
  }
}

describe("data-only SDK planner preflight", () => {
  it("deduplicates collectors across controls and uses stable ordinal ordering", () => {
    const rawPack = pack({ controls: [
      control({ id: "DEV-Z", order: 2 }), control({ id: "DEV-A", order: 2 }),
      control({ id: "DEV-M", order: 1, evaluationType: "MANUAL", evaluator: null, collectorRequirements: [] }),
      control({ id: "DEV-H", order: 3, evaluationType: "HYBRID" }),
    ] });
    const output = plan(rawPack);
    expect(output).toEqual({
      schemaVersion: "cloudops.assessment-plan.v1", packId: "fixture-pack", controlPackVersion: "1.0.0",
      controlIds: ["DEV-M", "DEV-A", "DEV-Z", "DEV-H"], collectorIds: ["fixture-summary"], requiredPermissions: [],
    });
    for (let index = 0; index < 100; index++) expect(plan(rawPack)).toEqual(output);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.collectorIds)).toBe(true);
    expect(Reflect.set(output.collectorIds, "0", "unregistered")).toBe(false);
  });

  it("unions exact declared permissions while preserving the manifest permission superset", () => {
    const parsedDefinition = AssessmentDefinitionSchema.parse(definition({ collectors: [
      collector({ requiresAuthentication: true, requiredPermissions: ["User.Read.All", "User.Read"] }),
      collector({ id: "fixture-audit", requiresAuthentication: true, requiredPermissions: ["User.Read", "AuditLog.Read.All"] }),
    ] }));
    const parsedPack = ControlPackSchema.parse(pack({ controls: [
      control({ collectorRequirements: ["fixture-summary", "fixture-audit"] }), control({ id: "DEV-TEST-002", order: 2 }),
    ] }));
    const manifest = syntheticPlugin({ auth: { provider: "microsoft-graph", permissions: ["User.Read.All", "User.Read", "AuditLog.Read.All", "LicenseAssignment.Read.All"], adminConsentRequired: true } }).manifest;
    expect(validateControlPackPlan(parsedPack, parsedDefinition, manifest)).toMatchObject({
      collectorIds: ["fixture-audit", "fixture-summary"], requiredPermissions: ["AuditLog.Read.All", "User.Read", "User.Read.All"],
    });
    expect(validateControlPackPlan(parsedPack, parsedDefinition, manifest, ["DEV-TEST-002"])).toMatchObject({
      collectorIds: ["fixture-summary"], requiredPermissions: ["User.Read", "User.Read.All"],
    });
    const insufficient = syntheticPlugin({ auth: { provider: "microsoft-graph", permissions: ["User.Read", "User.Read.All"], adminConsentRequired: true } }).manifest;
    expect(() => validateControlPackPlan(parsedPack, parsedDefinition, insufficient, ["DEV-TEST-002"])).toThrow(/manifest must declare a superset/);
    expect(() => validateControlPackPlan(parsedPack, parsedDefinition, syntheticPlugin().manifest)).toThrow(/require authentication/);
  });

  it("validates unused live registry metadata without scheduling it for development controls", () => {
    const parsedDefinition = definition({ collectors: [collector(), collector({ id: "live-summary", requiresAuthentication: true, requiredPermissions: ["User.Read.All"] })] });
    expect(plan(pack(), parsedDefinition)).toMatchObject({ collectorIds: ["fixture-summary"], requiredPermissions: [] });
    expect(plan(pack({ controls: [control({ evaluationType: "MANUAL", evaluator: null, collectorRequirements: ["live-summary"] })] }), parsedDefinition)).toMatchObject({ collectorIds: [], requiredPermissions: [] });
    expect(plan(pack({ controls: [control({ evaluationType: "HYBRID", collectorRequirements: ["fixture-summary", "live-summary"] })] }), parsedDefinition)).toMatchObject({ collectorIds: [], requiredPermissions: [] });
  });

  it.each(["AUTOMATED", "MANUAL", "HYBRID"])("validates every %s reference before subset selection", (evaluationType) => {
    for (const invalidReference of [
      { collectorRequirements: ["must-not-be-reflected"] }, { recommendationId: "must-not-be-reflected" },
      ...(evaluationType === "MANUAL" ? [] : [{ evaluator: "must-not-be-reflected" }]),
    ]) {
      const invalid = control({ id: "DEV-TEST-002", order: 2, evaluationType, evaluator: evaluationType === "MANUAL" ? null : "fixture-threshold", ...invalidReference });
      const action = () => plan(pack({ controls: [control(), invalid] }), definition(), ["DEV-TEST-001"]);
      safeFailure(action, "synthetic-unused-root");
    }
  });

  it("rejects missing evaluator dependencies and mismatched assessment provenance", () => {
    expect(() => plan(pack({ controls: [control({ collectorRequirements: [] })] }))).toThrow(/omits evaluator dependency/);
    expect(() => plan(pack(), definition({ assessmentId: "another-assessment" }))).toThrow(/does not match manifest/);
  });

  it.each([{ selection: [] }, { selection: ["DEV-UNKNOWN"] }, { selection: ["DEV-TEST-001", "DEV-TEST-001"] }])("rejects an empty, unknown or duplicate selection %#", ({ selection }) => {
    expect(() => plan(pack(), definition(), selection)).toThrow(/unknown, duplicate or empty selection/);
  });

  it("keeps the core declaration generic but rejects non-allowlisted Azure scopes, even on unused collectors", () => {
    const generic = AssessmentDefinitionSchema.parse(definition({ collectors: [collector(), collector({ id: "external-summary", requiresAuthentication: true, requiredPermissions: ["inventory:Read"] })] }));
    expect(generic.collectors[1]?.requiredPermissions).toEqual(["inventory:Read"]);
    expect(() => validateControlPackPlan(ControlPackSchema.parse(pack()), generic, syntheticPlugin().manifest)).toThrow(/unsupported permission in Azure/);
    expect(() => plan(pack(), definition({ collectors: [collector({ requiresAuthentication: true, requiredPermissions: ["Directory.ReadWrite.All"] })] }))).toThrow(/unsupported permission in Azure/);
    expect(validateControlPackPlan(ControlPackSchema.parse(pack()), AssessmentDefinitionSchema.parse(definition()), { ...syntheticPlugin().manifest, provider: "aws" })).toMatchObject({ requiredPermissions: [] });
  });
});

describe("trusted, pinned control-pack discovery", () => {
  it("discovers two interchangeable real development packs and leaves legacy plugins unchanged", () => {
    const plugins = discoverAssessmentManifests();
    const packs = discoverControlPacks(plugins);
    expect(packs).toHaveLength(2);
    expect(new Set(packs.map((item) => item.assessmentId))).toEqual(new Set(["identity-assessment"]));
    expect(packs.map((item) => item.pack.id)).toEqual(["cloudops-identity-alternate-dev", "cloudops-identity-dev"]);
    for (const item of packs) {
      expect(item.pack.source.kind).toBe("DEVELOPMENT");
      expect(item.pack.controls).toHaveLength(3);
      expect(item.plan.collectorIds).toEqual(["fixture-capability-summary", "fixture-users-summary"]);
      expect(item.plan.requiredPermissions).toEqual([]);
      expect(item.definition.controlPacks.find((reference) => reference.id === item.pack.id)?.sha256).toBe(item.contentHash);
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.pack.controls)).toBe(true);
      expect(Object.isFrozen(item.pack.controls[0]?.parameters)).toBe(true);
    }
    expect(Object.isFrozen(packs)).toBe(true);
    expect(packs[0]?.plan.controlIds).not.toEqual(packs[1]?.plan.controlIds);
    expect(discoverControlPacks(plugins.filter((item) => item.manifest.id !== "identity-assessment"))).toEqual([]);
  });

  it("accepts static JSON without evaluating script contents and normalizes only BOM and CRLF for hash pins", () => {
    const text = JSON.stringify(pack({ name: "Synthetic Á fixture" }), null, 2);
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    expect(controlPackContentHash(text)).toBe(expected);
    expect(controlPackContentHash("\uFEFF" + text.replace(/\n/g, "\r\n"))).toBe(expected);
    expect(controlPackContentHash(text + " ")).not.toBe(expected);
    const root = engine();
    const files = writeSdk(root, { packText: "\uFEFF" + text.replace(/\n/g, "\r\n") });
    expect(discover(root)[0]?.contentHash).toBe(expected);
    expect(readFileSync(path.join(files.folder, "Invoke-Assessment.ps1"), "utf8")).toContain("Discovery must never execute");
  });

  it.each(["missing", "null", "array", "malformed", "extra-field", "version", "reference", "duplicate-registry", "capability", "evaluator-dependency"])("fails closed for invalid definition %s", (kind) => {
    const root = engine();
    const files = writeSdk(root);
    const invalid: Record<string, unknown> = {
      missing: { ...files.profile, schemaVersion: undefined }, null: null, array: [], malformed: "{ must-not-be-reflected",
      "extra-field": { ...files.profile, "must-not-be-reflected": true }, version: { ...files.profile, sdkVersion: "cloudops.assessment-sdk.v99" },
      reference: { ...files.profile, assessmentId: "must-not-be-reflected" },
      "duplicate-registry": { ...files.profile, collectors: [collector(), collector()] },
      capability: { ...files.profile, collectors: [collector({ requiredCapabilities: ["must-not-be-reflected"] })] },
      "evaluator-dependency": { ...files.profile, evaluators: [{ id: "fixture-threshold", version: "1.0.0", collectorRequirements: ["must-not-be-reflected"] }] },
    };
    writeFileSync(files.definitionPath, kind === "malformed" ? String(invalid[kind]) : JSON.stringify(invalid[kind]));
    safeFailure(() => discover(root), root);
  });

  it.each(["schema", "control", "code", "scope", "duplicate", "id", "version", "hash"])("fails closed for invalid or unpinned control pack %s", (kind) => {
    const root = engine();
    const overrides: Record<string, Record<string, unknown>> = {
      schema: { schemaVersion: "cloudops.control-pack.v99" }, control: { controls: [control({ evaluationType: "AUTOMATED", evaluator: null })] },
      code: { controls: [control({ script: "must-not-be-reflected" })] }, scope: { scope: ["outside-scope"] },
      duplicate: { controls: [control(), control()] }, id: { id: "different-pack" }, version: { controlPackVersion: "2.0.0" }, hash: {},
    };
    const files = writeSdk(root, { pack: pack(overrides[kind]) });
    if (kind === "hash") writeFileSync(files.packPath, JSON.stringify(pack({ name: "Unapproved content change" })));
    safeFailure(() => discover(root), root);
  });

  it.each(["../outside.json", "/outside.json", "C:\\outside.json", "nested/pack.json", "pack.ps1", "fixture-pack.json:stream", "https://example.invalid/pack.json"])("rejects unsafe pinned file reference %s before reading it", (file) => {
    const root = engine();
    writeSdk(root, { definition: { controlPacks: [{ id: "fixture-pack", version: "1.0.0", file, sha256: "a".repeat(64) }] } });
    safeFailure(() => discover(root), root);
  });

  it.each(["definition-size", "pack-size", "definition-utf8", "pack-utf8", "missing-pack", "directory-definition", "directory-pack", "file-parent"])("rejects unbounded or nonregular JSON source %s", (kind) => {
    const root = engine();
    const files = writeSdk(root);
    if (kind === "definition-size") writeFileSync(files.definitionPath, Buffer.alloc(MAX_ASSESSMENT_DEFINITION_BYTES + 1, 32));
    if (kind === "pack-size") writeFileSync(files.packPath, Buffer.alloc(MAX_CONTROL_PACK_BYTES + 1, 32));
    if (kind === "definition-utf8") writeFileSync(files.definitionPath, Buffer.from([0xff, 0xfe, 0xfd]));
    if (kind === "pack-utf8") writeFileSync(files.packPath, Buffer.from([0xff, 0xfe, 0xfd]));
    if (kind === "missing-pack") unlinkSync(files.packPath);
    if (kind === "directory-definition") { unlinkSync(files.definitionPath); mkdirSync(files.definitionPath); }
    if (kind === "directory-pack") { unlinkSync(files.packPath); mkdirSync(files.packPath); }
    if (kind === "file-parent") {
      unlinkSync(files.packPath);
      rmdirSync(path.join(files.folder, "control-packs"));
      writeFileSync(path.join(files.folder, "control-packs"), "must-not-be-reflected");
    }
    safeFailure(() => discover(root), root);
  });

  it.each(["definition", "pack"])("rejects hard-linked %s content", (kind) => {
    const root = engine();
    const files = writeSdk(root);
    const target = kind === "definition" ? files.definitionPath : files.packPath;
    linkSync(target, path.join(root, "alias.json"));
    safeFailure(() => discover(root), root);
  });

  for (const kind of ["definition", "pack", "parent", "plugin"]) it(`rejects symbolic-linked ${kind} when supported`, (context) => {
    const root = engine();
    const files = writeSdk(root);
    const externalRoot = engine();
    const external = writeSdk(externalRoot);
    const plugins = discoverAssessmentManifests(root);
    try {
      if (kind === "definition" || kind === "pack") {
        const target = kind === "definition" ? files.definitionPath : files.packPath;
        const source = kind === "definition" ? external.definitionPath : external.packPath;
        unlinkSync(target);
        symlinkSync(source, target, "file");
      } else if (kind === "parent") {
        unlinkSync(files.packPath);
        rmdirSync(path.join(files.folder, "control-packs"));
        symlinkSync(path.join(external.folder, "control-packs"), path.join(files.folder, "control-packs"), process.platform === "win32" ? "junction" : "dir");
      } else {
        // Every target is a known, synthetic child of the validated temporary root.
        if (path.dirname(files.folder) !== root) throw new Error("Unsafe linked fixture target");
        rmSync(files.folder, { recursive: true });
        symlinkSync(external.folder, files.folder, process.platform === "win32" ? "junction" : "dir");
      }
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip(); return; }
      throw error;
    }
    safeFailure(() => discoverControlPacks(plugins, root), root);
  });

  it("allows identical shared pack pins but rejects conflicting content under the same version", () => {
    const root = engine();
    writeSdk(root);
    const second = writeSdk(root, { id: "second-assessment" });
    expect(discover(root)).toHaveLength(2);
    const changed = JSON.stringify(pack({ name: "Different content under existing version" }));
    writeFileSync(second.packPath, changed);
    writeFileSync(second.definitionPath, JSON.stringify({ ...second.profile, controlPacks: [{ id: "fixture-pack", version: "1.0.0", file: "fixture-pack.json", sha256: controlPackContentHash(changed) }] }));
    expect(() => discover(root)).toThrow(/same pack version has conflicting content/);
  });

  it("validates SDK profiles at startup, before runtime or token acquisition", async () => {
    const root = engine();
    writeSdk(root, { pack: pack({ controls: [control({ evaluator: "must-not-be-reflected" })] }) });
    const runtime = new ImmediateRuntime();
    const acquireToken = vi.fn(async () => { throw new Error("Token acquisition must not run during static preflight"); });
    await expect(buildApp({ logger: false, config: { engineRoot: root }, runtime, graphTokenBroker: { acquireToken } })).rejects.toBeInstanceOf(ControlPackValidationError);
    expect(runtime.calls).toHaveLength(0);
    expect(acquireToken).not.toHaveBeenCalled();
    expect(() => createDefaultAssessmentRegistry(root)).toThrow(/unknown evaluator/);
  });

  it("exposes only generic metadata and refuses public execution of the Identity skeleton", async () => {
    const auth = await createLocalAuthHarness();
    const runtime = new ImmediateRuntime();
    const acquireToken = vi.fn(async () => { throw new Error("Disabled assessment must not acquire Graph credentials"); });
    const app = await buildApp({ logger: false, tokenValidator: auth.validator, runtime, graphTokenBroker: { acquireToken } });
    const headers = { authorization: `Bearer ${await auth.issueToken()}` };
    try {
      const catalog = await app.inject({ method: "GET", url: "/api/v1/assessments", headers });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.json()).toHaveLength(4);
      expect(catalog.json()).toContainEqual(expect.objectContaining({ id: "identity-assessment", enabled: false, requiredPermissions: [] }));
      for (const internal of ["fixture-users-summary", "DEV-IDENTITY-", "assessment-sdk.json", "controlPacks", "sha256", "aiFactAllowlist", "scriptPath"]) expect(catalog.body).not.toContain(internal);
      const execution = await app.inject({ method: "POST", url: "/api/v1/assessments/identity-assessment/executions", headers, payload: { options: {} } });
      expect(execution.statusCode).toBe(409);
      expect(execution.json()).toMatchObject({ error: { code: "ASSESSMENT_DISABLED" } });
      expect(runtime.calls).toHaveLength(0);
      expect(acquireToken).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
