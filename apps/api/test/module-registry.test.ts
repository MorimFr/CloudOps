import path from "node:path";
import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "../src/services/module-registry.js";
import { AssessmentRegistry, type AssessmentRegistration } from "../src/services/assessment-registry.js";

const module = { id: "diagnostics", name: "Diagnostics", description: "Technical validation.", provider: "azure", domain: "secops", order: 2 } as const;
const registration: AssessmentRegistration = {
  id: "test-tool", name: "Test tool", scriptRelativePath: "test-tool/Invoke-Assessment.ps1", enabled: true, timeoutMs: 1000,
  provider: "azure", domain: "secops", visibility: "public", requiredAuthProvider: "microsoft-graph", requiredPermissions: ["User.Read"], adminConsentRequired: false,
  moduleId: module.id, assessmentOrder: 3,
};

describe("central module registry", () => {
  it("resolves public module metadata centrally and prevents later mutation", () => {
    const input = { ...module };
    const modules = new ModuleRegistry([input]);
    input.name = "Changed" as typeof input.name;
    const registry = new AssessmentRegistry(path.resolve("engine"), [registration], modules);
    expect(registry.list()[0]).toMatchObject({ moduleId: "diagnostics", moduleName: "Diagnostics", moduleOrder: 2, assessmentOrder: 3 });
    expect(Object.isFrozen(modules.resolve("diagnostics"))).toBe(true);
  });
  it("rejects unknown modules and provider/domain mismatches", () => {
    const modules = new ModuleRegistry([module]);
    expect(() => new AssessmentRegistry(path.resolve("engine"), [{ ...registration, moduleId: "missing" }], modules)).toThrow(/not registered/);
    expect(() => new AssessmentRegistry(path.resolve("engine"), [{ ...registration, domain: "devops" }], modules)).toThrow(/provider\/domain/);
  });
  it("validates module IDs, ordering, duplicates and assessment ordering", () => {
    expect(() => new ModuleRegistry([module, module])).toThrow(/Duplicate/);
    expect(() => new ModuleRegistry([{ ...module, order: -1 }])).toThrow();
    expect(() => new ModuleRegistry([{ ...module, id: "../unsafe" }])).toThrow();
    expect(() => new AssessmentRegistry(path.resolve("engine"), [{ ...registration, assessmentOrder: 1.5 }], new ModuleRegistry([module]))).toThrow();
  });
  it("keeps empty taxonomy modules from manufacturing catalog entries", () => {
    const catalog = new AssessmentRegistry(path.resolve("engine")).list();
    expect(catalog.map((item) => item.id)).toEqual(["inactive-users", "hello-world", "microsoft-graph-connectivity"]);
    expect(catalog.filter((item) => item.moduleId === "security-assessments")).toEqual([]);
  });
});
