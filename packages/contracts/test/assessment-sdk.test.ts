import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_SDK_VERSION, MAX_ASSESSMENT_DEFINITION_BYTES, MAX_CONTROL_PACK_BYTES,
  AiAdvisorySchema, AiAssessmentEnrichmentSchema, AiAssessmentInputSchema,
  ApplicabilitySchema, AssessmentContextSchema, AssessmentCoverageSchema,
  AssessmentDefinitionSchema, AssessmentMetadataSchema, AssessmentPlanSchema,
  AssessmentReportModelSchema, AssessmentResultSchema, CapabilityContextSchema,
  CapabilityStatusSchema, CollectorDefinitionSchema, CollectorResultSchema,
  CollectorStatusSchema, ContentHashSchema, ControlIdSchema, ControlPackReferenceSchema,
  ControlPackSchema, ControlResultSchema, ControlResultStatusSchema, ControlSchema,
  CoverageRatioSchema, EvaluationConfidenceSchema, EvaluationTypeSchema,
  EvaluatorDefinitionSchema, EvidenceSchema, FactNameSchema, FactsSchema, FindingSchema,
  NormalizedStateSchema, RecommendationSchema, RiskSchema, RiskSeveritySchema,
  SdkIdSchema, SdkTextSchema, SdkTimestampSchema, SdkVersionSchema,
} from "../src/assessment-sdk.js";

const timestamp = "2026-09-09T12:00:00.000Z";
const contentHash = "a".repeat(64);
const signals = () => ({ exposed: false, privileged: false, compensatingControl: false });
const evidence = () => ({ type: "configuration-summary", facts: { enabledPolicies: 4, matchingPolicies: 1 } });

function control(overrides: Record<string, unknown> = {}) {
  return {
    id: "DEV-IDENTITY-001", title: "Synthetic configuration check", area: "authentication", order: 1,
    evaluationType: "AUTOMATED", collectorRequirements: ["configuration-summary"],
    evaluator: "threshold-evaluator", severity: "HIGH", recommendationId: "review-configuration",
    parameters: { minimumMatchingPolicies: 1 }, ...overrides,
  };
}

function pack(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.control-pack.v1", id: "synthetic-dev-pack", name: "Synthetic development pack",
    framework: "cloudops-development", frameworkVersion: "1.0", controlPackVersion: "1.0.0",
    scope: ["authentication"], source: { kind: "DEVELOPMENT", reference: "Repository synthetic test fixtures" },
    controls: [control()], ...overrides,
  };
}

function collector(overrides: Record<string, unknown> = {}) {
  return {
    id: "configuration-summary", version: "1.0.0", requiredPermissions: [],
    requiredCapabilities: ["configuration-available"], requiresAuthentication: false, ...overrides,
  };
}

function evaluator(overrides: Record<string, unknown> = {}) {
  return { id: "threshold-evaluator", version: "1.0.0", collectorRequirements: ["configuration-summary"], ...overrides };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    recommendationId: "review-configuration", title: "Review synthetic configuration",
    summary: "Development fixture only; no tenant changes are required.",
    technicalSteps: ["Review the observed aggregate."], portalPath: ["Synthetic console", "Configuration"],
    impact: "No production changes.", rollback: ["Restore the previous synthetic fixture."],
    validation: ["Run the offline deterministic evaluator."], ...overrides,
  };
}

function packReference(overrides: Record<string, unknown> = {}) {
  return { id: "synthetic-dev-pack", version: "1.0.0", file: "synthetic-dev-pack.json", sha256: contentHash, ...overrides };
}

function definition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.assessment-definition.v1", assessmentId: "identity-assessment",
    assessmentVersion: "1.0.0", sdkVersion: ASSESSMENT_SDK_VERSION,
    capabilities: ["configuration-available"], aiFactAllowlist: ["enabledPolicies", "matchingPolicies"],
    collectors: [collector()], evaluators: [evaluator()], recommendations: [recommendation()],
    controlPacks: [packReference()], ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.assessment-plan.v1", packId: "synthetic-dev-pack", controlPackVersion: "1.0.0",
    controlIds: ["DEV-IDENTITY-001"], collectorIds: ["configuration-summary"], requiredPermissions: [], ...overrides,
  };
}

function assessmentContext(overrides: Record<string, unknown> = {}) {
  return {
    assessmentId: "identity-assessment", assessmentVersion: "1.0.0", sdkVersion: ASSESSMENT_SDK_VERSION,
    assessmentTimestamp: timestamp, capabilities: { "configuration-available": "AVAILABLE" }, dataSource: "SYNTHETIC", ...overrides,
  };
}

function collectorResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.collector-result.v1", collectorId: "configuration-summary", status: "SUCCESS",
    requestCount: 0, data: { enabledPolicies: 4, matchingPolicies: 1 }, warnings: [], ...overrides,
  };
}

function normalizedState(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.normalized-state.v1", assessmentTimestamp: timestamp,
    datasets: { "configuration-summary": { status: "SUCCESS", facts: { enabledPolicies: 4, matchingPolicies: 1 } } },
    capabilities: { "configuration-available": "AVAILABLE" }, ...overrides,
  };
}

function controlResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.control-result.v1", controlId: "DEV-IDENTITY-001", status: "PASS", applicability: "APPLICABLE",
    observed: { matchingPolicies: 1 }, expected: { minimumMatchingPolicies: 1 }, evidence: [evidence()],
    reasonCode: "THRESHOLD_SATISFIED", confidence: "HIGH", riskSignals: signals(), ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.finding.v1", controlId: "DEV-IDENTITY-001", status: "PASS", applicability: "APPLICABLE",
    title: "Synthetic configuration check", area: "authentication", recommendationId: "review-configuration",
    observed: { matchingPolicies: 1 }, expected: { minimumMatchingPolicies: 1 }, evidence: [evidence()],
    reasonCode: "THRESHOLD_SATISFIED",
    evaluation: { type: "AUTOMATED", confidence: "HIGH", evaluatorId: "threshold-evaluator", evaluatorVersion: "1.0.0" },
    risk: { modelVersion: "cloudops.risk.v1", baseSeverity: "HIGH", severity: "HIGH", signals: signals() }, ...overrides,
  };
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    assessmentId: "identity-assessment", assessmentVersion: "1.0.0", sdkVersion: ASSESSMENT_SDK_VERSION,
    assessmentTimestamp: timestamp, framework: "cloudops-development", frameworkVersion: "1.0",
    controlPackId: "synthetic-dev-pack", controlPackVersion: "1.0.0", controlPackHash: contentHash,
    evaluatorVersions: { "threshold-evaluator": "1.0.0" }, dataSource: "SYNTHETIC", ...overrides,
  };
}

function mixedCoverage(overrides: Record<string, unknown> = {}) {
  return {
    totalControls: 10, applicableControls: 7, applicabilityUnknownControls: 2,
    automatedControls: 7, manualControls: 1, hybridControls: 2, manualResultControls: 3,
    successfullyEvaluatedControls: 3, passedControls: 2, failedControls: 1,
    unknownControls: 1, errorControls: 2, notApplicableControls: 1,
    automationCoverage: { numerator: 7, denominator: 10, percent: 70 },
    evaluatedPassRate: { numerator: 2, denominator: 3, percent: 66.67 },
    evaluationCoverage: { numerator: 3, denominator: 9, percent: 33.33 }, ...overrides,
  };
}

function mixedFindings() {
  return ["PASS", "PASS", "FAIL", "UNKNOWN", "ERROR", "ERROR", "NOT_APPLICABLE", "MANUAL", "MANUAL", "MANUAL"]
    .map((status, index) => finding({
      controlId: `DEV-IDENTITY-${String(index + 1).padStart(3, "0")}`, status,
      applicability: status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : index === 3 || index === 5 ? "UNKNOWN" : "APPLICABLE",
      evidence: status === "PASS" || status === "FAIL" ? [evidence()] : [],
      evaluation: {
        type: index < 7 ? "AUTOMATED" : index === 7 ? "MANUAL" : "HYBRID",
        confidence: status === "PASS" || status === "FAIL" ? "HIGH" : "LOW",
        evaluatorId: index < 7 ? "threshold-evaluator" : null, evaluatorVersion: index < 7 ? "1.0.0" : null,
      },
    }));
}

function assessmentResult(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: "cloudops.assessment-result.v1", metadata: metadata(), coverage: mixedCoverage(), findings: mixedFindings(), ...overrides };
}

function advisory(overrides: Record<string, unknown> = {}) {
  return {
    executiveNarrative: "Review the synthetic findings.", technicalExplanation: "Counts are based on fixture evidence.",
    riskContext: "Advisory only; the deterministic result remains authoritative.", crossFindingCorrelations: [],
    remediationPriority: ["Review the failing synthetic control."], roadmapSuggestions: ["Validate the fixture again."], ...overrides,
  };
}

function aiInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.ai-input.v1",
    findings: [{ controlId: "DEV-IDENTITY-001", status: "FAIL", severity: "HIGH", facts: { enabledPolicies: 4, matchingPolicies: 0 } }],
    ...overrides,
  };
}

function aiEnrichment(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: "cloudops.ai-enrichment.v1", status: "AVAILABLE", advisory: advisory(), ...overrides };
}

function reportModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.assessment-report.v1", metadata: metadata(),
    summary: { criticalFindings: 0, highFindings: 1, mediumFindings: 0, lowFindings: 0 }, coverage: mixedCoverage(),
    domainPosture: [{ area: "authentication", passed: 2, failed: 1, manual: 3, unknown: 1, error: 2, notApplicable: 1 }],
    findings: mixedFindings(), manualControls: ["DEV-IDENTITY-008", "DEV-IDENTITY-009", "DEV-IDENTITY-010"],
    limitations: ["Synthetic development pack only; no tenant was assessed."], recommendations: [recommendation()],
    aiEnrichment: aiEnrichment(), ...overrides,
  };
}

describe("Assessment SDK versioned provider-neutral contracts", () => {
  it("publishes explicit SDK and bounded deployment-definition versions", () => {
    expect(ASSESSMENT_SDK_VERSION).toBe("cloudops.assessment-sdk.v1");
    expect(MAX_CONTROL_PACK_BYTES).toBe(1024 * 1024);
    expect(MAX_ASSESSMENT_DEFINITION_BYTES).toBe(512 * 1024);
  });

  it.each([
    ["control pack", ControlPackSchema, pack()],
    ["assessment definition", AssessmentDefinitionSchema, definition()],
    ["assessment plan", AssessmentPlanSchema, plan()],
    ["collector result", CollectorResultSchema, collectorResult()],
    ["normalized state", NormalizedStateSchema, normalizedState()],
    ["control result", ControlResultSchema, controlResult()],
    ["finding", FindingSchema, finding()],
    ["assessment result", AssessmentResultSchema, assessmentResult()],
    ["AI input", AiAssessmentInputSchema, aiInput()],
    ["AI enrichment", AiAssessmentEnrichmentSchema, aiEnrichment()],
    ["report model", AssessmentReportModelSchema, reportModel()],
  ] as const)("validates %s and rejects missing, unknown or future schema versions", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
    for (const schemaVersion of [undefined, null, 1, "cloudops.unknown.v1", "cloudops.control-pack.v2"]) {
      expect(schema.safeParse({ ...fixture, schemaVersion }).success).toBe(false);
    }
    expect(schema.safeParse({ ...fixture, shellCommand: "Invoke-Expression forbidden" }).success).toBe(false);
  });

  it.each(["1", "1.0", "01.0.0", "1.00.0", "1.0.01", "1.0.0-preview", "1.0.0+build", "-1.0.0", "1.0.0 "])("rejects noncanonical implementation version %s", (version) => {
    expect(SdkVersionSchema.safeParse(version).success).toBe(false);
  });

  it("requires fixed UTC timestamps, implementation versions and reproducibility metadata", () => {
    expect(SdkVersionSchema.parse("12.34.56")).toBe("12.34.56");
    expect(SdkTimestampSchema.parse(timestamp)).toBe(timestamp);
    expect(SdkTimestampSchema.parse("2026-09-09T12:00:00.1234567Z")).toBe("2026-09-09T12:00:00.1234567Z");
    for (const value of ["2026-09-09", "2026-09-09T12:00:00", "2026-09-09T12:00:00-03:00", "2026-13-09T12:00:00Z", "0000-09-09T12:00:00Z", "2026-09-09T12:00:00.12345678Z"]) {
      expect(SdkTimestampSchema.safeParse(value).success).toBe(false);
    }
    expect(AssessmentMetadataSchema.safeParse(metadata()).success).toBe(true);
    for (const overrides of [{ sdkVersion: "cloudops.assessment-sdk.v2" }, { controlPackHash: "a".repeat(63) }, { dataSource: "REAL_TENANT" }, { tenantId: "11111111-1111-4111-8111-111111111111" }]) {
      expect(AssessmentMetadataSchema.safeParse(metadata(overrides)).success).toBe(false);
    }
    expect(ContentHashSchema.safeParse("A".repeat(64)).success).toBe(false);
  });

  it.each(["<script>alert(1)</script>", "https://example.invalid/config", "javascript:alert(1)", "www.example.invalid", "C:\\evil.ps1", "file:///tmp/evil.ps1", "line\nbreak", "hidden\u200btext", " ", "a".repeat(501)])("rejects unsafe configuration text %#", (value) => {
    expect(SdkTextSchema.safeParse(value).success).toBe(false);
    expect(ControlSchema.safeParse(control({ title: value })).success).toBe(false);
    expect(RecommendationSchema.safeParse(recommendation({ technicalSteps: [value] })).success).toBe(false);
  });

  it("keeps control packs declarative at every nested boundary", () => {
    for (const overrides of [{ command: "Get-Process" }, { path: "Invoke-Assessment.ps1" }, { url: "https://example.invalid" }, { expression: "$true" }, { javascript: "eval(1)" }]) {
      expect(ControlSchema.safeParse(control(overrides)).success).toBe(false);
      expect(ControlPackSchema.safeParse(pack(overrides)).success).toBe(false);
    }
    expect(ControlPackSchema.safeParse(pack({ source: { kind: "DEVELOPMENT", reference: "Synthetic fixture", licenseFile: "../secret" } })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ parameters: { shellCommand: "Get-Process" } })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ parameters: { minimumMatchingPolicies: "1" } })).success).toBe(false);
  });
});

describe("Control packs, registered implementations and permission declarations", () => {
  it("supports explicitly separate automated, manual and hybrid definitions", () => {
    expect(ControlSchema.safeParse(control()).success).toBe(true);
    expect(ControlSchema.safeParse(control({ evaluationType: "MANUAL", evaluator: null, collectorRequirements: [] })).success).toBe(true);
    expect(ControlSchema.safeParse(control({ evaluationType: "HYBRID", evaluator: null })).success).toBe(true);
    expect(ControlSchema.safeParse(control({ evaluationType: "HYBRID", evaluator: "threshold-evaluator" })).success).toBe(true);
    expect(ControlSchema.safeParse(control({ evaluationType: "AUTOMATED", evaluator: null })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ evaluationType: "MANUAL", evaluator: "threshold-evaluator" })).success).toBe(false);
  });

  it.each(["../evil", "/tmp/evil.ps1", "C:\\evil.ps1", "Invoke-Assessment.ps1", "https://example.invalid", "$(Get-Process)", "a--b", "a".repeat(65)])("rejects executable paths or malformed implementation IDs %#", (id) => {
    expect(SdkIdSchema.safeParse(id).success).toBe(false);
    expect(ControlSchema.safeParse(control({ evaluator: id })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ collectorRequirements: [id] })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ recommendationId: id })).success).toBe(false);
  });

  it("bounds IDs, controls, references and synthetic source metadata", () => {
    expect(ControlIdSchema.parse("DEV-IDENTITY-001")).toBe("DEV-IDENTITY-001");
    expect(ControlIdSchema.safeParse("1-IDENTITY").success).toBe(false);
    expect(ControlIdSchema.safeParse("DEV-" + "a".repeat(93)).success).toBe(false);
    for (const overrides of [{ controls: [] }, { controls: Array.from({ length: 1001 }, (_, index) => control({ id: `DEV-${index}`, order: index + 1 })) }, { scope: [] }, { source: { kind: "SCRAPED", reference: "Unlicensed source" } }]) {
      expect(ControlPackSchema.safeParse(pack(overrides)).success).toBe(false);
    }
    expect(ControlPackSchema.safeParse(pack({ source: { kind: "AUTHORIZED", reference: "Organization-owned authorized source" } })).success).toBe(true);
    expect(ControlSchema.safeParse(control({ order: 0 })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ order: 10001 })).success).toBe(false);
  });

  it("rejects duplicate control IDs, collector requirements and scope entries", () => {
    expect(ControlPackSchema.safeParse(pack({ controls: [control(), control({ order: 2 })] })).success).toBe(false);
    expect(ControlPackSchema.safeParse(pack({ scope: ["authentication", "authentication"] })).success).toBe(false);
    expect(ControlPackSchema.safeParse(pack({ controls: [control({ area: "outside-scope" })] })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ collectorRequirements: ["configuration-summary", "configuration-summary"] })).success).toBe(false);
    expect(ControlSchema.safeParse(control({ collectorRequirements: Array.from({ length: 33 }, (_, index) => `collector-${index}`) })).success).toBe(false);
  });

  it("rejects duplicate registry entries and unresolved collector or capability dependencies", () => {
    const invalidDefinitions = [
      { collectors: [collector(), collector()] }, { evaluators: [evaluator(), evaluator()] },
      { recommendations: [recommendation(), recommendation()] }, { controlPacks: [packReference(), packReference()] },
      { capabilities: ["configuration-available", "configuration-available"] }, { aiFactAllowlist: ["enabledPolicies", "enabledPolicies"] },
      { collectors: [collector({ requiredCapabilities: ["unknown-capability"] })] },
      { evaluators: [evaluator({ collectorRequirements: ["unregistered-collector"] })] },
      { evaluators: [evaluator({ collectorRequirements: ["configuration-summary", "configuration-summary"] })] },
      { controlPacks: [] },
    ];
    for (const overrides of invalidDefinitions) expect(AssessmentDefinitionSchema.safeParse(definition(overrides)).success).toBe(false);
    expect(EvaluatorDefinitionSchema.safeParse(evaluator({ script: "./evaluator.ps1" })).success).toBe(false);
  });

  it.each(["../pack.json", "/tmp/pack.json", "C:\\pack.json", "nested/deeper/pack.json", "nested/../pack.json", "nested\\pack.json", "pack.ps1", "pack.json:stream", "https://example.invalid/pack.json", "pack%2ejson", "pack--name.json"])("rejects escaping or unsupported control-pack file reference %s", (file) => {
    expect(ControlPackReferenceSchema.safeParse(packReference({ file })).success).toBe(false);
  });

  it("accepts one code-owned version directory", () => {
    expect(ControlPackReferenceSchema.safeParse(packReference({ file: "cis-m365-7-0-0/identity-wave1.json" })).success).toBe(true);
  });

  it("validates authentication without tying generic collectors to Microsoft Graph", () => {
    expect(CollectorDefinitionSchema.safeParse(collector()).success).toBe(true);
    expect(CollectorDefinitionSchema.safeParse(collector({ requiresAuthentication: true, requiredPermissions: ["User.Read"] })).success).toBe(true);
    expect(CollectorDefinitionSchema.safeParse(collector({ requiresAuthentication: true, requiredPermissions: ["inventory:Read"] })).success).toBe(true);
    expect(CollectorDefinitionSchema.safeParse(collector({ requiredPermissions: ["User.Read"] })).success).toBe(false);
    for (const permissions of [["User.Read", "User.Read"], ["https://example.invalid"], ["Scope Read"], ["<scope>"], Array.from({ length: 33 }, (_, index) => `scope${index}`)]) {
      expect(CollectorDefinitionSchema.safeParse(collector({ requiresAuthentication: true, requiredPermissions: permissions })).success).toBe(false);
    }
    for (const secret of [{ token: "synthetic-token" }, { headers: { authorization: "Bearer forbidden" } }, { endpoint: "https://example.invalid" }]) {
      expect(CollectorDefinitionSchema.safeParse(collector(secret)).success).toBe(false);
      expect(AssessmentContextSchema.safeParse(assessmentContext(secret)).success).toBe(false);
    }
  });

  it("accepts a deduplicated plan and rejects repeated or untyped references", () => {
    expect(AssessmentPlanSchema.safeParse(plan()).success).toBe(true);
    for (const overrides of [
      { controlIds: ["DEV-IDENTITY-001", "DEV-IDENTITY-001"] }, { collectorIds: ["configuration-summary", "configuration-summary"] },
      { requiredPermissions: ["User.Read", "User.Read"] }, { controlIds: [] }, { controlIds: [42] }, { collectorIds: [{ id: "configuration-summary" }] },
    ]) expect(AssessmentPlanSchema.safeParse(plan(overrides)).success).toBe(false);
  });
});

describe("Bounded structured evidence and normalized facts", () => {
  it("accepts only safe integer, boolean and null values without coercion", () => {
    const facts = { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, count: 0, applicable: true, enabled: false, unknown: null };
    expect(FactsSchema.parse(facts)).toEqual(facts);
    expect(FactsSchema.safeParse({}).success).toBe(true);
    for (const value of ["0", "user@example.invalid", "11111111-1111-4111-8111-111111111111", [], {}, undefined, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
      expect(FactsSchema.safeParse({ value }).success).toBe(false);
    }
  });

  it("bounds fact key names and record size, including prototype-related keys", () => {
    const sixtyFour = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`fact${index}`, index]));
    expect(FactsSchema.safeParse(sixtyFour).success).toBe(true);
    expect(FactsSchema.safeParse({ ...sixtyFour, extraFact: 0 }).success).toBe(false);
    for (const name of ["__proto__", "constructor", "prototype", "toString", "valueOf", "user@example.invalid", "raw.graph", "policy-name", "<script>", "a".repeat(49)]) {
      expect(FactNameSchema.safeParse(name).success).toBe(false);
      expect(FactsSchema.safeParse(Object.fromEntries([[name, 1]])).success).toBe(false);
    }
  });

  it("rejects raw Graph, names, tokens and nested objects in collector/state/evidence payloads", () => {
    for (const raw of [{ displayName: "Synthetic user" }, { value: [{ id: "11111111-1111-4111-8111-111111111111" }] }, { accessToken: "synthetic-token" }]) {
      expect(CollectorResultSchema.safeParse(collectorResult({ data: raw })).success).toBe(false);
      expect(EvidenceSchema.safeParse({ type: "configuration-summary", facts: raw }).success).toBe(false);
      expect(NormalizedStateSchema.safeParse(normalizedState({ datasets: { "configuration-summary": { status: "SUCCESS", facts: raw } } })).success).toBe(false);
    }
    expect(CollectorResultSchema.safeParse(collectorResult({ rawResponse: {} })).success).toBe(false);
    expect(NormalizedStateSchema.safeParse(normalizedState({ accessToken: "synthetic-token" })).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...evidence(), narrative: "Not structured proof." }).success).toBe(false);
  });

  it("separates collector outcomes from control verdicts and validates safe diagnostics", () => {
    for (const status of ["SUCCESS", "PARTIAL", "FAILED"]) expect(CollectorResultSchema.safeParse(collectorResult({ status })).success).toBe(true);
    for (const status of ["PASS", "FAIL", "ERROR", "UNKNOWN"]) expect(CollectorResultSchema.safeParse(collectorResult({ status })).success).toBe(false);
    for (const overrides of [{ requestCount: -1 }, { requestCount: 0.5 }, { requestCount: Number.MAX_SAFE_INTEGER + 1 }, { warnings: ["user@example.invalid"] }, { warnings: ["PARTIAL_DATA", "PARTIAL_DATA"] }, { warnings: ["Missing raw policy: tenant-sensitive"] }]) {
      expect(CollectorResultSchema.safeParse(collectorResult(overrides)).success).toBe(false);
    }
    expect(CollectorResultSchema.safeParse(collectorResult({ status: "PARTIAL", warnings: ["PARTIAL_DATA"] })).success).toBe(true);
  });

  it("keeps capability uncertainty explicit and bounds state datasets", () => {
    expect(CapabilityContextSchema.parse({ "configuration-available": "UNKNOWN" })).toEqual({ "configuration-available": "UNKNOWN" });
    expect(CapabilityContextSchema.safeParse({ "configuration-available": false }).success).toBe(false);
    expect(CapabilityContextSchema.safeParse(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`capability-${index}`, "AVAILABLE"]))).success).toBe(false);
    expect(NormalizedStateSchema.safeParse(normalizedState({ datasets: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`dataset-${index}`, { status: "SUCCESS", facts: {} }])) })).success).toBe(false);
  });
});

describe("Deterministic result, applicability, evidence and risk contracts", () => {
  it("uses closed enums for every decision-bearing field", () => {
    for (const [schema, accepted] of [
      [EvaluationTypeSchema, ["AUTOMATED", "MANUAL", "HYBRID"]],
      [ControlResultStatusSchema, ["PASS", "FAIL", "MANUAL", "NOT_APPLICABLE", "UNKNOWN", "ERROR"]],
      [ApplicabilitySchema, ["APPLICABLE", "NOT_APPLICABLE", "UNKNOWN"]],
      [EvaluationConfidenceSchema, ["HIGH", "MEDIUM", "LOW"]],
      [RiskSeveritySchema, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]],
      [CapabilityStatusSchema, ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]],
      [CollectorStatusSchema, ["SUCCESS", "PARTIAL", "FAILED"]],
    ] as const) {
      for (const value of accepted) expect(schema.safeParse(value).success).toBe(true);
      for (const value of ["", "OTHER", "pass", null, 1, true]) expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it.each(["PASS", "FAIL"])("requires applicable scope and structured evidence for %s", (status) => {
    for (const schemaAndFactory of [[ControlResultSchema, controlResult], [FindingSchema, finding]] as const) {
      const [schema, factory] = schemaAndFactory;
      expect(schema.safeParse(factory({ status })).success).toBe(true);
      expect(schema.safeParse(factory({ status, evidence: [] })).success).toBe(false);
      expect(schema.safeParse(factory({ status, applicability: "UNKNOWN" })).success).toBe(false);
      expect(schema.safeParse(factory({ status, applicability: "NOT_APPLICABLE" })).success).toBe(false);
      expect(schema.safeParse(factory({ status, evidence: ["Narrative alone is not evidence."] })).success).toBe(false);
    }
  });

  it("does not let unavailable data imply either a verdict or non-applicability", () => {
    for (const status of ["MANUAL", "UNKNOWN", "ERROR"]) {
      expect(ControlResultSchema.safeParse(controlResult({ status, applicability: "UNKNOWN", evidence: [] })).success).toBe(true);
      expect(ControlResultSchema.safeParse(controlResult({ status, applicability: "NOT_APPLICABLE", evidence: [] })).success).toBe(false);
    }
    expect(ControlResultSchema.safeParse(controlResult({ status: "NOT_APPLICABLE", applicability: "NOT_APPLICABLE", evidence: [] })).success).toBe(true);
    expect(ControlResultSchema.safeParse(controlResult({ status: "NOT_APPLICABLE", applicability: "APPLICABLE", evidence: [] })).success).toBe(false);
    expect(ControlResultSchema.safeParse(controlResult({ status: "NOT_APPLICABLE", applicability: "UNKNOWN", evidence: [] })).success).toBe(false);
  });

  it("separates confidence from severity and risk from framework status", () => {
    const parsed = FindingSchema.parse(finding({ status: "FAIL", evaluation: { type: "AUTOMATED", confidence: "LOW", evaluatorId: "threshold-evaluator", evaluatorVersion: "1.0.0" } }));
    expect(parsed.status).toBe("FAIL");
    expect(parsed.evaluation.confidence).toBe("LOW");
    expect(parsed.risk.baseSeverity).toBe("HIGH");
    expect(RiskSchema.safeParse({ modelVersion: "cloudops.risk.v1", baseSeverity: "HIGH", severity: "CRITICAL", signals: { exposed: true, privileged: false, compensatingControl: false } }).success).toBe(true);
    expect(RiskSchema.safeParse({ ...parsed.risk, modelVersion: "llm-risk.v1" }).success).toBe(false);
    expect(RiskSchema.safeParse({ ...parsed.risk, status: "PASS" }).success).toBe(false);
    expect(FindingSchema.safeParse(finding({ evaluation: { ...parsed.evaluation, confidence: "CRITICAL" } })).success).toBe(false);
    expect(ControlResultSchema.safeParse(controlResult({ riskSignals: { ...signals(), token: "forbidden" } })).success).toBe(false);
  });

  it("freezes nested evidence and results without retaining mutable fixture references", () => {
    const original = finding();
    const parsed = FindingSchema.parse(original);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.evidence)).toBe(true);
    expect(Object.isFrozen(parsed.evidence[0])).toBe(true);
    expect(Object.isFrozen(parsed.evidence[0]!.facts)).toBe(true);
    expect(Object.isFrozen(parsed.risk.signals)).toBe(true);
    original.evidence[0]!.facts.matchingPolicies = 99;
    expect(parsed.evidence[0]!.facts.matchingPolicies).toBe(1);
    expect(Reflect.set(parsed, "status", "FAIL")).toBe(false);
    expect(Reflect.set(parsed.evidence[0]!.facts, "matchingPolicies", 0)).toBe(false);
  });
});

describe("Coverage, explicit denominators and excluded controls", () => {
  it.each([
    { numerator: 0, denominator: 0, percent: null },
    { numerator: 0, denominator: 3, percent: 0 },
    { numerator: 1, denominator: 3, percent: 33.33 },
    { numerator: 2, denominator: 3, percent: 66.67 },
    { numerator: 3, denominator: 3, percent: 100 },
  ])("accepts exact rounded ratio %#", (ratio) => {
    expect(CoverageRatioSchema.parse(ratio)).toEqual(ratio);
  });

  it.each([
    { numerator: 0, denominator: 0, percent: 100 },
    { numerator: 0, denominator: 0, percent: 0 },
    { numerator: 1, denominator: 0, percent: null },
    { numerator: 4, denominator: 3, percent: 100 },
    { numerator: 1, denominator: 3, percent: 33.333 },
    { numerator: 1, denominator: 3, percent: 34 },
    { numerator: 0, denominator: 3, percent: null },
    { numerator: -1, denominator: 3, percent: 0 },
    { numerator: 1.5, denominator: 3, percent: 50 },
  ])("rejects misleading or noncanonical ratio %#", (ratio) => {
    expect(CoverageRatioSchema.safeParse(ratio).success).toBe(false);
  });

  it("keeps mixed coverage distinct from pass rate and includes unresolved/manual controls in evaluation denominator", () => {
    const coverage = AssessmentCoverageSchema.parse(mixedCoverage());
    expect(coverage.automationCoverage).toEqual({ numerator: 7, denominator: 10, percent: 70 });
    expect(coverage.evaluatedPassRate).toEqual({ numerator: 2, denominator: 3, percent: 66.67 });
    expect(coverage.evaluationCoverage).toEqual({ numerator: 3, denominator: 9, percent: 33.33 });
    expect(coverage.manualControls).toBe(1);
    expect(coverage.manualResultControls).toBe(3);
    expect(AssessmentResultSchema.safeParse(assessmentResult()).success).toBe(true);
    expect(AssessmentReportModelSchema.parse(reportModel()).manualControls).toHaveLength(3);
  });

  it("does not invent compliance when all controls require manual review", () => {
    const coverage = mixedCoverage({
      totalControls: 3, applicableControls: 3, applicabilityUnknownControls: 0,
      automatedControls: 0, manualControls: 1, hybridControls: 2, manualResultControls: 3,
      successfullyEvaluatedControls: 0, passedControls: 0, failedControls: 0,
      unknownControls: 0, errorControls: 0, notApplicableControls: 0,
      automationCoverage: { numerator: 0, denominator: 3, percent: 0 },
      evaluatedPassRate: { numerator: 0, denominator: 0, percent: null },
      evaluationCoverage: { numerator: 0, denominator: 3, percent: 0 },
    });
    expect(AssessmentCoverageSchema.parse(coverage).evaluatedPassRate.percent).toBeNull();
  });

  it("has no evaluation denominator when every control is explicitly not applicable", () => {
    const coverage = mixedCoverage({
      totalControls: 3, applicableControls: 0, applicabilityUnknownControls: 0,
      automatedControls: 3, manualControls: 0, hybridControls: 0, manualResultControls: 0,
      successfullyEvaluatedControls: 0, passedControls: 0, failedControls: 0,
      unknownControls: 0, errorControls: 0, notApplicableControls: 3,
      automationCoverage: { numerator: 3, denominator: 3, percent: 100 },
      evaluatedPassRate: { numerator: 0, denominator: 0, percent: null },
      evaluationCoverage: { numerator: 0, denominator: 0, percent: null },
    });
    expect(AssessmentCoverageSchema.parse(coverage).evaluationCoverage.percent).toBeNull();
  });

  it.each([
    { totalControls: 9 }, { applicableControls: 8 }, { applicabilityUnknownControls: 1 },
    { automatedControls: 8 }, { manualControls: 2 }, { hybridControls: 3 }, { manualResultControls: 2 },
    { successfullyEvaluatedControls: 4 }, { passedControls: 3 }, { failedControls: 0 },
    { errorControls: 1 }, { unknownControls: 2 }, { notApplicableControls: 0 },
    { automationCoverage: { numerator: 3, denominator: 10, percent: 30 } },
    { evaluatedPassRate: { numerator: 2, denominator: 10, percent: 20 } },
    { evaluationCoverage: { numerator: 3, denominator: 3, percent: 100 } },
  ])("rejects inconsistent partitions or substituted denominators %#", (overrides) => {
    expect(AssessmentCoverageSchema.safeParse(mixedCoverage(overrides)).success).toBe(false);
  });
});

describe("AI contracts are optional, strictly advisory and reference-isolated", () => {
  it("accepts only the bounded, identifier-minimized aggregate projection", () => {
    expect(AiAssessmentInputSchema.safeParse(aiInput()).success).toBe(true);
    for (const facts of [{ matchingPolicies: null }, { email: "synthetic@example.invalid" }, { rawGraph: {} }, { token: "synthetic-token" }, { fractional: 0.5 }]) {
      expect(AiAssessmentInputSchema.safeParse(aiInput({ findings: [{ ...aiInput().findings[0], facts }] })).success).toBe(false);
    }
    for (const forbidden of ["upn", "email", "displayName", "tenantId", "policyName", "groupName", "applicationName", "token", "headers", "rawGraphResponse"]) {
      expect(AiAssessmentInputSchema.safeParse(aiInput({ [forbidden]: "synthetic-prohibited" })).success).toBe(false);
      expect(AiAssessmentInputSchema.safeParse(aiInput({ findings: [{ ...aiInput().findings[0], [forbidden]: "synthetic-prohibited" }] })).success).toBe(false);
    }
  });

  it.each(["status", "evidence", "baseSeverity", "applicability", "collectorResults", "controlDefinitions", "benchmarkVersion", "findings"])("rejects AI authority over %s", (field) => {
    expect(AiAdvisorySchema.safeParse(advisory({ [field]: "forbidden" })).success).toBe(false);
    if (field !== "status") expect(AiAssessmentEnrichmentSchema.safeParse(aiEnrichment({ [field]: "forbidden" })).success).toBe(false);
    else expect(AiAssessmentEnrichmentSchema.safeParse(aiEnrichment({ status: "PASS" })).success).toBe(false);
  });

  it("requires advisory content only when enrichment is available", () => {
    expect(AiAssessmentEnrichmentSchema.safeParse(aiEnrichment()).success).toBe(true);
    expect(AiAssessmentEnrichmentSchema.safeParse(aiEnrichment({ status: "AVAILABLE", advisory: null })).success).toBe(false);
    for (const status of ["NOT_REQUESTED", "UNAVAILABLE"]) {
      const withoutAdvisory = aiEnrichment({ status, advisory: null });
      expect(AiAssessmentEnrichmentSchema.safeParse(withoutAdvisory).success).toBe(true);
      expect(AiAssessmentEnrichmentSchema.safeParse(aiEnrichment({ status })).success).toBe(false);
      expect(AssessmentReportModelSchema.safeParse(reportModel({ aiEnrichment: withoutAdvisory })).success).toBe(true);
    }
  });

  it("rejects markup, hidden controls, oversized narratives and arbitrary output fields", () => {
    for (const text of ["<script>alert(1)</script>", "<img src=x>", "safe\u0000unsafe", "hidden\u202etext", "x".repeat(2001), ""]) {
      expect(AiAdvisorySchema.safeParse(advisory({ executiveNarrative: text })).success).toBe(false);
      expect(AiAdvisorySchema.safeParse(advisory({ roadmapSuggestions: [text] })).success).toBe(false);
    }
    expect(AiAdvisorySchema.safeParse(advisory({ roadmapSuggestions: Array(33).fill("Review the synthetic fixture.") })).success).toBe(false);
    expect(AiAdvisorySchema.safeParse(advisory({ remediationPriority: [{ controlId: "DEV-IDENTITY-001", severity: "LOW" }] })).success).toBe(false);
  });

  it("freezes projection and advisory deeply without mutating authoritative findings", () => {
    const original = aiInput();
    const projected = AiAssessmentInputSchema.parse(original);
    const authoritative = FindingSchema.parse(finding({ status: "FAIL" }));
    const enrichment = AiAssessmentEnrichmentSchema.parse(aiEnrichment());
    const before = JSON.stringify(authoritative);
    original.findings[0]!.facts.matchingPolicies = 100;
    expect(projected.findings[0]!.facts.matchingPolicies).toBe(0);
    expect(Object.isFrozen(projected.findings)).toBe(true);
    expect(Object.isFrozen(projected.findings[0]!.facts)).toBe(true);
    expect(Reflect.set(projected.findings[0]!, "status", "PASS")).toBe(false);
    expect(Reflect.set(projected.findings[0]!.facts, "matchingPolicies", 100)).toBe(false);
    expect(Object.isFrozen(enrichment)).toBe(true);
    expect(Object.isFrozen(enrichment.advisory)).toBe(true);
    expect(Object.isFrozen(enrichment.advisory!.remediationPriority)).toBe(true);
    expect(Reflect.set(enrichment.advisory!, "status", "PASS")).toBe(false);
    expect(JSON.stringify(authoritative)).toBe(before);
  });
});

describe("SDK cross-boundary provenance and report integrity", () => {
  it("rejects own prototype-related keys before record parsers can discard them", () => {
    for (const key of ["__proto__", "constructor", "prototype", "toString", "valueOf"]) {
      const record = (value: unknown) => Object.fromEntries([[key, value]]);
      expect(FactsSchema.safeParse(record(1)).success).toBe(false);
      // SDK IDs have their own lower-kebab grammar; unlike fact names they do
      // not reserve ordinary lowercase own-property names such as constructor.
      if (!SdkIdSchema.safeParse(key).success) {
        expect(CapabilityContextSchema.safeParse(record("AVAILABLE")).success).toBe(false);
        expect(NormalizedStateSchema.safeParse(normalizedState({ datasets: record({ status: "SUCCESS", facts: {} }) })).success).toBe(false);
        expect(AssessmentMetadataSchema.safeParse(metadata({ evaluatorVersions: record("1.0.0") })).success).toBe(false);
      }
      expect(AiAssessmentInputSchema.safeParse(aiInput({ findings: [{ ...aiInput().findings[0], facts: record(1) }] })).success).toBe(false);
    }
  });

  it("requires complete evaluator identity and version for every automated finding, including uncertainty", () => {
    for (const status of ["PASS", "FAIL", "MANUAL", "UNKNOWN", "ERROR", "NOT_APPLICABLE"]) {
      const result = finding({ status, applicability: status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "APPLICABLE" });
      expect(FindingSchema.safeParse(result).success).toBe(true);
      for (const references of [
        { evaluatorId: null, evaluatorVersion: null }, { evaluatorId: null, evaluatorVersion: "1.0.0" },
        { evaluatorId: "threshold-evaluator", evaluatorVersion: null },
      ]) {
        expect(FindingSchema.safeParse({ ...result, evaluation: { ...result.evaluation, ...references } }).success).toBe(false);
      }
    }
  });

  it.each(["MANUAL", "HYBRID"])("requires %s evaluation to remain MANUAL without an executed evaluator in v1", (type) => {
    const evaluation = { type, confidence: "LOW", evaluatorId: null, evaluatorVersion: null };
    expect(FindingSchema.safeParse(finding({ status: "MANUAL", evaluation })).success).toBe(true);
    for (const status of ["PASS", "FAIL", "UNKNOWN", "ERROR", "NOT_APPLICABLE"]) {
      expect(FindingSchema.safeParse(finding({ status, applicability: status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "APPLICABLE", evaluation })).success).toBe(false);
    }
    expect(FindingSchema.safeParse(finding({ status: "MANUAL", evaluation: { ...evaluation, evaluatorId: "threshold-evaluator", evaluatorVersion: "1.0.0" } })).success).toBe(false);
  });

  it("requires metadata to match exactly the evaluator versions represented by findings", () => {
    for (const evaluatorVersions of [
      {}, { "threshold-evaluator": "2.0.0" }, { "other-evaluator": "1.0.0" },
      { "threshold-evaluator": "1.0.0", "unused-evaluator": "1.0.0" },
    ]) {
      expect(AssessmentResultSchema.safeParse(assessmentResult({ metadata: metadata({ evaluatorVersions }) })).success).toBe(false);
      expect(AssessmentReportModelSchema.safeParse(reportModel({ metadata: metadata({ evaluatorVersions }) })).success).toBe(false);
    }
    const findings = mixedFindings();
    findings[1]!.evaluation.evaluatorVersion = "2.0.0";
    expect(AssessmentResultSchema.safeParse(assessmentResult({ findings })).success).toBe(false);
  });

  it("requires each domain posture count and area to reconcile with the authoritative findings", () => {
    const original = reportModel();
    const domain = original.domainPosture[0]!;
    for (const domainPosture of [
      [], [domain, domain], [{ ...domain, area: "unknown-area" }],
      ...["passed", "failed", "manual", "unknown", "error", "notApplicable"].map((key) => [{ ...domain, [key]: 99 }]),
      [domain, { ...domain, area: "unused-area", passed: 0, failed: 0, manual: 0, unknown: 0, error: 0, notApplicable: 0 }],
    ]) expect(AssessmentReportModelSchema.safeParse(reportModel({ domainPosture })).success).toBe(false);
  });

  it("requires an unambiguous recommendation for every finding and excludes unrelated catalog entries", () => {
    for (const recommendations of [
      [], [recommendation(), recommendation()], [recommendation({ recommendationId: "wrong-recommendation" })],
      [recommendation(), recommendation({ recommendationId: "unused-recommendation" })],
    ]) expect(AssessmentReportModelSchema.safeParse(reportModel({ recommendations })).success).toBe(false);
    const findings = mixedFindings();
    findings[0]!.recommendationId = "missing-recommendation";
    expect(AssessmentReportModelSchema.safeParse(reportModel({ findings })).success).toBe(false);
  });

  it("rejects coverage duplicates and summary inflation without counting PASS risk as an open issue", () => {
    const findings = mixedFindings();
    findings[1]!.controlId = findings[0]!.controlId;
    expect(AssessmentResultSchema.safeParse(assessmentResult({ findings })).success).toBe(false);
    expect(AssessmentReportModelSchema.safeParse(reportModel({ findings })).success).toBe(false);
    expect(AssessmentReportModelSchema.safeParse(reportModel({ summary: { criticalFindings: 0, highFindings: 10, mediumFindings: 0, lowFindings: 0 } })).success).toBe(false);
    expect(AssessmentReportModelSchema.parse(reportModel()).summary.highFindings).toBe(1);
    expect(AssessmentReportModelSchema.safeParse(reportModel({ manualControls: ["DEV-IDENTITY-001", "DEV-IDENTITY-009", "DEV-IDENTITY-010"] })).success).toBe(false);
  });

  it("uses explicit half-up ratio rounding compatible with report generation", () => {
    expect(CoverageRatioSchema.safeParse({ numerator: 1, denominator: 32, percent: 3.13 }).success).toBe(true);
    expect(CoverageRatioSchema.safeParse({ numerator: 1, denominator: 32, percent: 3.12 }).success).toBe(false);
  });

  it("validates all deterministic risk combinations without letting compensation reduce base severity", () => {
    const levels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    for (const [rank, baseSeverity] of levels.entries()) {
      for (const exposed of [false, true]) for (const privileged of [false, true]) for (const compensatingControl of [false, true]) {
        const severity = levels[Math.min(3, rank + Math.max(0, Number(exposed) + Number(privileged) - Number(compensatingControl)))];
        const risk = { modelVersion: "cloudops.risk.v1", baseSeverity, severity, signals: { exposed, privileged, compensatingControl } };
        expect(RiskSchema.safeParse(risk).success).toBe(true);
        for (const wrong of levels.filter((level) => level !== severity)) expect(RiskSchema.safeParse({ ...risk, severity: wrong }).success).toBe(false);
      }
    }
  });
});
