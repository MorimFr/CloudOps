import { describe, expect, it } from "vitest";
import { AssessmentManifestSchema, AssessmentSummarySchema, ASSESSMENT_ICONS } from "../src/index.js";

function manifest(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: "cloudops.assessment.v1", id: "test-assessment", name: "Synthetic tool", description: "Static test metadata.",
    provider: "azure", domain: "secops", moduleId: "security-assessments", assessmentOrder: 1, enabled: true, visibility: "development",
    engine: { runtime: "powershell", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds: 60 },
    auth: { provider: "none", permissions: [], adminConsentRequired: false }, ...overrides };
}

describe("versioned strict assessment manifest", () => {
  it("supports optional display and the complete reviewed icon allowlist", () => {
    expect(AssessmentManifestSchema.parse(manifest()).display).toBeUndefined();
    for (const icon of ASSESSMENT_ICONS) {
      expect(AssessmentManifestSchema.safeParse(manifest({ display: { icon, tags: ["Identity"], source: "Microsoft Entra ID · Sign-in activity" } })).success).toBe(true);
    }
  });
  it.each([
    { id: "a".repeat(65) }, { id: "Inactive Users" }, { id: "foo/bar" }, { id: "foo.ps1" }, { id: "foo--bar" },
    { name: "a".repeat(101) }, { name: " " }, { description: "a".repeat(501) }, { description: " " },
    { moduleId: "a".repeat(65) }, { assessmentOrder: 0 }, { assessmentOrder: 1000 },
    { display: { tags: Array(7).fill("tag") } }, { display: { tags: ["a".repeat(33)] } },
    { display: { tags: ["same", "same"] } }, { display: { tags: [{ text: "tag" }] } },
    { display: { tags: ["<b>tag</b>"] } }, { display: { tags: ["line\nbreak"] } },
    { display: { source: "a".repeat(121) } }, { display: { source: "https://example.invalid" } },
    { display: { source: "javascript:alert(1)" } }, { display: { icon: "unknown" } },
    { display: { icon: "<svg>" } }, { display: { source: "<img src=x>" } },
    { auth: { provider: "none", permissions: [], adminConsentRequired: false, secret: "forbidden" } },
    { provider: "aws", auth: { provider: "microsoft-graph", permissions: ["User.Read"], adminConsentRequired: false } },
  ])("rejects out-of-bounds or unsafe metadata %#", (overrides) => {
    expect(AssessmentManifestSchema.safeParse(manifest(overrides)).success).toBe(false);
  });
  it("keeps the public contract backward compatible and rejects internal configuration", () => {
    const summary = { id: "test-assessment", name: "Synthetic", enabled: true, provider: "azure", domain: "secops",
      moduleId: "security-assessments", moduleName: "Assessments", moduleDescription: "Security checks.", moduleOrder: 1,
      assessmentOrder: 1, visibility: "public", requiredAuthProvider: "none", requiredPermissions: [], adminConsentRequired: false };
    expect(AssessmentSummarySchema.safeParse(summary).success).toBe(true);
    expect(AssessmentSummarySchema.safeParse({ ...summary, display: { icon: "users" } }).success).toBe(true);
    for (const internal of [{ entrypoint: "Invoke-Assessment.ps1" }, { scriptPath: "/internal" }, { engine: manifest().engine }]) {
      expect(AssessmentSummarySchema.safeParse({ ...summary, ...internal }).success).toBe(false);
    }
  });
});
