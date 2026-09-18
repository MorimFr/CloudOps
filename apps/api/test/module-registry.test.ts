import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "../src/services/module-registry.js";
import { AssessmentRegistry, createDefaultAssessmentRegistry } from "../src/services/assessment-registry.js";
import { syntheticPlugin } from "./manifest-fixtures.js";

const module = { id: "diagnostics", name: "Diagnostics", description: "Technical validation.", provider: "azure", domain: "secops", order: 2 } as const;
describe("central module registry", () => {
  it("resolves module metadata centrally and prevents later mutation", () => {
    const input = { ...module };
    const modules = new ModuleRegistry([input]);
    input.name = "Changed" as typeof input.name;
    const registry = new AssessmentRegistry([syntheticPlugin({ moduleId: module.id, assessmentOrder: 3 })], modules);
    expect(registry.list()[0]).toMatchObject({ moduleId: "diagnostics", moduleName: "Diagnostics", moduleOrder: 2, assessmentOrder: 3 });
    expect(Object.isFrozen(modules.resolve("diagnostics"))).toBe(true);
  });
  it("rejects unknown modules and provider/domain mismatches", () => {
    const modules = new ModuleRegistry([module]);
    expect(() => new AssessmentRegistry([syntheticPlugin({ moduleId: "missing" })], modules)).toThrow(/not registered/);
    for (const change of [{ domain: "devops" }, { provider: "aws" }]) {
      expect(() => new AssessmentRegistry([syntheticPlugin({ moduleId: module.id, ...change })], modules)).toThrow(/provider\/domain/);
    }
  });
  it("validates module IDs, ordering, duplicates and assessment ordering", () => {
    expect(() => new ModuleRegistry([module, module])).toThrow(/Duplicate/);
    expect(() => new ModuleRegistry([{ ...module, order: -1 }])).toThrow();
    expect(() => new ModuleRegistry([{ ...module, id: "../unsafe" }])).toThrow();
    expect(() => syntheticPlugin({ assessmentOrder: 1.5 })).toThrow();
  });
  it("keeps empty taxonomy modules from manufacturing catalog entries", () => {
    const catalog = createDefaultAssessmentRegistry().list();
    expect(catalog.map((item) => item.id)).toEqual(["hello-world", "identity-assessment", "inactive-users", "microsoft-graph-connectivity"]);
    expect(catalog.filter((item) => item.moduleId === "security-assessments")).toEqual([
      expect.objectContaining({ id: "identity-assessment", enabled: true }),
    ]);
    expect(catalog.filter((item) => item.moduleId === "security-assessments" && item.enabled)).toHaveLength(1);
    expect(catalog.filter((item) => item.moduleId === "protection-response")).toEqual([]);
  });
});
