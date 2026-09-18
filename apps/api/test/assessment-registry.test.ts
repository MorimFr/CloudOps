import { describe, expect, it } from "vitest";
import { AssessmentManifestSchema, AssessmentSummarySchema } from "@cloudops/contracts";
import { AssessmentRegistry, createDefaultAssessmentRegistry } from "../src/services/assessment-registry.js";
import { discoverAssessmentManifests } from "../src/services/assessment-discovery.js";
import { syntheticManifest, syntheticPlugin } from "./manifest-fixtures.js";

describe("manifest-backed AssessmentRegistry", () => {
  it("preserves the three existing assessments and enables Identity Wave 1 for lab tests", () => {
    const registry = createDefaultAssessmentRegistry();
    expect(registry.list().map((item) => item.id)).toEqual(["hello-world", "identity-assessment", "inactive-users", "microsoft-graph-connectivity"]);
    expect(registry.list().find((item) => item.id === "identity-assessment")).toMatchObject({
      name: "Assessment de Identidade", provider: "azure", domain: "secops", moduleId: "security-assessments",
      visibility: "public", enabled: true, requiredAuthProvider: "microsoft-graph", requiredPermissions: ["GroupSettings.Read.All", "Policy.Read.All"],
      adminConsentRequired: true, display: { icon: "shield" },
    });
    expect(registry.resolve("identity-assessment")).toMatchObject({ enabled: true, timeoutMs: 300000, maxConcurrentExecutions: 1 });
    expect(registry.resolve("inactive-users")).toMatchObject({
      name: "Mapear Usuários Inativos", provider: "azure", domain: "secops", moduleId: "identity-visibility",
      assessmentOrder: 1, moduleOrder: 2, visibility: "public", enabled: true,
      requiredAuthProvider: "microsoft-graph", requiredPermissions: ["User.Read", "User.Read.All", "AuditLog.Read.All", "LicenseAssignment.Read.All"],
      adminConsentRequired: true, timeoutMs: 3300000, maxConcurrentExecutions: 1,
    });
    expect(registry.resolve("microsoft-graph-connectivity")).toMatchObject({
      name: "Microsoft Graph Connectivity", provider: "azure", domain: "secops", moduleId: "connectivity-diagnostics",
      assessmentOrder: 1, visibility: "public", requiredPermissions: ["User.Read"], adminConsentRequired: false, timeoutMs: 60000,
    });
    expect(registry.resolve("hello-world")).toMatchObject({
      name: "Hello World Assessment", provider: "azure", domain: "devops", moduleId: "runtime-validation",
      assessmentOrder: 1, visibility: "development", requiredAuthProvider: "none", requiredPermissions: [],
      adminConsentRequired: false, timeoutMs: 30000,
    });
    expect(registry.resolve("hello-world").maxConcurrentExecutions).toBeUndefined();
    expect(registry.resolve("microsoft-graph-connectivity").maxConcurrentExecutions).toBeUndefined();
  });

  it("projects only strict public metadata, including optional display", () => {
    for (const item of createDefaultAssessmentRegistry().list()) {
      expect(AssessmentSummarySchema.safeParse(item).success).toBe(true);
      for (const key of ["engine", "auth", "scriptPath", "entrypoint", "timeoutMs", "timeoutSeconds", "maxConcurrentExecutions", "manifestPath", "controlPacks", "collectors", "evaluators", "aiFactAllowlist", "sha256"]) {
        expect(item).not.toHaveProperty(key);
      }
    }
    expect(new AssessmentRegistry([syntheticPlugin()]).list()[0]).not.toHaveProperty("display");
  });

  it("isolates and freezes nested permission and display metadata", () => {
    const input = syntheticManifest({ auth: { provider: "microsoft-graph", permissions: ["User.Read"], adminConsentRequired: false }, display: { icon: "users", tags: ["Identity"], source: "Graph" } });
    const manifest = AssessmentManifestSchema.parse(input);
    const registry = new AssessmentRegistry([{ manifest, scriptPath: syntheticPlugin().scriptPath }]);
    input.name = "Changed";
    const registered = registry.resolve("test-assessment");
    expect(registered.name).toBe("Synthetic assessment");
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.requiredPermissions)).toBe(true);
    expect(Object.isFrozen(registered.display)).toBe(true);
    expect(Object.isFrozen(registered.display?.tags)).toBe(true);
    expect(() => (registered.requiredPermissions as string[]).push("User.Read.All")).toThrow();
    const catalog = registry.list();
    catalog[0]!.name = "Catalog copy";
    expect(registry.resolve("test-assessment").name).toBe("Synthetic assessment");
  });

  it("rejects duplicate IDs even when handed already discovered plugins", () => {
    const [plugin] = discoverAssessmentManifests();
    expect(() => new AssessmentRegistry([plugin!, plugin!])).toThrow(/duplicate assessment ID/);
  });

  it("supports an empty registry and keeps unknown or disabled resolution safe", () => {
    expect(new AssessmentRegistry([]).list()).toEqual([]);
    expect(() => new AssessmentRegistry([]).resolve("unknown")).toThrowError(expect.objectContaining({ code: "ASSESSMENT_NOT_FOUND" }));
    const registry = new AssessmentRegistry([syntheticPlugin({ enabled: false })]);
    expect(registry.list()[0]?.enabled).toBe(false);
    expect(() => registry.resolve("test-assessment")).toThrowError(expect.objectContaining({ code: "ASSESSMENT_DISABLED" }));
  });
});
