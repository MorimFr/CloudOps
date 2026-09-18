import { describe, expect, it } from "vitest";
import { AiExecutiveSummarySchema, SanitizedExecutiveSummaryInputSchema, WAVE1_AI_CATALOG } from "../src/ai-executive-summary.js";

const input = () => ({ framework: "cis-m365", frameworkVersion: "7.0.0", profile: "E3_L1",
  controlCounts: { total: 1, passed: 0, failed: 1, manual: 0, unknown: 0, error: 0, notApplicable: 0 },
  severityCounts: { critical: 0, high: 1, medium: 0, low: 0 },
  findings: [{ controlId: "cis-m365-5-1-2-2", area: "applications-consent", status: "FAIL", severity: "HIGH", facts: {}, gapLabel: "application-registration-enabled" }],
});
const summary = () => ({ executiveSummary: "Cobertura parcial.", keyRiskThemes: ["Configuração"], priorityNarrative: "Revisar prioridades.", managementConclusion: "Revisão humana necessária." });
describe("private executive summary contracts", () => {
  it("accepts only the ten Wave 1 controls and fixed labels", () => {
    expect(Object.keys(WAVE1_AI_CATALOG)).toHaveLength(10);
    expect(SanitizedExecutiveSummaryInputSchema.safeParse(input()).success).toBe(true);
    expect(AiExecutiveSummarySchema.safeParse(summary()).success).toBe(true);
  });
  it.each(["tenantId", "userId", "upn", "email", "displayName", "groupId", "groupName", "policyId", "policyName", "applicationId", "accessToken", "rawGraph", "headers", "secret"])("rejects %s in any input object", (field) => {
    for (const value of [{ ...input(), [field]: "forbidden" }, { ...input(), findings: [{ ...input().findings[0], [field]: "forbidden" }] },
      { ...input(), findings: [{ ...input().findings[0], facts: { [field]: 1 } }] }]) {
      expect(SanitizedExecutiveSummaryInputSchema.safeParse(value).success).toBe(false);
    }
  });
  it.each(["status", "severity", "evidence", "observed", "expected", "recommendation", "controlId", "profile", "coverage"])("rejects AI authority field %s", (key) => {
    expect(AiExecutiveSummarySchema.safeParse({ ...summary(), [key]: "PASS" }).success).toBe(false);
  });
  it("rejects misleading counts, duplicate controls, free labels and injected areas", () => {
    const base = input();
    for (const bad of [
      { ...base, controlCounts: { ...base.controlCounts, failed: 0 } },
      { ...base, severityCounts: { ...base.severityCounts, critical: 1 } },
      { ...base, findings: [...base.findings, ...base.findings] },
      { ...base, findings: [{ ...base.findings[0], gapLabel: "foo@example.invalid" }] },
      { ...base, findings: [{ ...base.findings[0], area: "tenant-secret" }] },
    ]) expect(SanitizedExecutiveSummaryInputSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects oversized, PII-bearing or malformed narratives", () => {
    for (const value of ["", "x".repeat(2501), "user@example.invalid", "11111111-1111-4111-8111-111111111111", "x\ny"]) {
      expect(AiExecutiveSummarySchema.safeParse({ ...summary(), executiveSummary: value }).success).toBe(false);
    }
    expect(AiExecutiveSummarySchema.safeParse({ ...summary(), keyRiskThemes: "not array" }).success).toBe(false);
  });
});
