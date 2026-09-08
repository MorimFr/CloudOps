import { describe, expect, it } from "vitest";
import type { AssessmentSummary } from "@cloudops/contracts";
import { groupAssessmentsByModule } from "./modules";
import appSource from "../App.tsx?raw";
import moduleSource from "../components/CatalogModuleSection.tsx?raw";

const item: AssessmentSummary = {
  id: "test-card", name: "Test card", enabled: true, provider: "azure", domain: "secops", visibility: "public",
  requiredAuthProvider: "none", requiredPermissions: [], adminConsentRequired: false,
  moduleId: "test-module", moduleName: "From registry", moduleDescription: "From registry description", moduleOrder: 2, assessmentOrder: 1,
};

describe("catalog grouping", () => {
  it("uses registry labels and sorts modules and cards deterministically including ties", () => {
    const catalog = [
      { ...item, id: "z-last", assessmentOrder: 3 },
      { ...item, id: "b-second" },
      { ...item, id: "a-first" },
      { ...item, id: "earlier", moduleId: "first-module", moduleOrder: 1 },
    ];
    const grouped = groupAssessmentsByModule(catalog);
    expect(grouped.map((entry) => entry.id)).toEqual(["first-module", "test-module"]);
    expect(grouped[1].assessments.map((entry) => entry.id)).toEqual(["a-first", "b-second", "z-last"]);
    expect(grouped[1].name).toBe("From registry");
    expect(catalog[0].id).toBe("z-last");
    expect(groupAssessmentsByModule([...catalog].reverse())).toEqual(grouped);
  });
  it("does not create empty modules or render disabled tools", () => {
    expect(groupAssessmentsByModule([])).toEqual([]);
    expect(groupAssessmentsByModule([{ ...item, enabled: false }])).toEqual([]);
  });
  it("keeps assessment IDs and module membership out of catalog JSX", () => {
    for (const source of [appSource, moduleSource]) {
      expect(source).not.toMatch(/["'](?:hello-world|microsoft-graph-connectivity|inactive-users|identity-visibility)["']/);
    }
  });
});
