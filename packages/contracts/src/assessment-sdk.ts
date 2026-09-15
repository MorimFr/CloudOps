import { z } from "zod";

// Provider-neutral contracts. Authentication adapters, not the SDK, own scopes.
export const ASSESSMENT_SDK_VERSION = "cloudops.assessment-sdk.v1";
export const MAX_CONTROL_PACK_BYTES = 1024 * 1024;
export const MAX_ASSESSMENT_DEFINITION_BYTES = 512 * 1024;
export const SdkIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const ControlIdSchema = z.string().min(1).max(96).regex(/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/);
export const SdkVersionSchema = z.string().max(32).regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
export const FactNameSchema = z.string().max(48).regex(/^[a-z][A-Za-z0-9]{0,47}$/)
  .refine((value) => !["constructor", "prototype", "toString", "valueOf"].includes(value));
export const SafeCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const FactValueSchema = z.union([z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.boolean(), z.null()]);
// Validate original keys before Zod's record parser can discard __proto__.
// DTOs are plain data, never class instances, accessors or symbol-keyed objects.
function strictRecord<K extends z.ZodType<string>, V extends z.ZodType>(key: K, value: V, maximum: number) {
  return z.unknown().superRefine((input, context) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      context.addIssue({ code: "custom", message: "Expected a plain data record" });
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Reflect.ownKeys(input);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length > maximum
      || keys.some((name) => typeof name !== "string" || !key.safeParse(name).success
        || !("value" in Object.getOwnPropertyDescriptor(input, name)!))) {
      context.addIssue({ code: "custom", message: "Invalid record keys or shape" });
    }
  }).pipe(z.record(key, value)).readonly();
}
export const FactsSchema = strictRecord(FactNameSchema, FactValueSchema, 64);
export const SdkTimestampSchema = z.string().datetime()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/)
  .refine((value) => !value.startsWith("0000-"));
export const ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const SdkTextSchema = z.string().min(1).max(500)
  .refine((value) => value.trim().length > 0 && !/[<>\p{Cc}\p{Cf}]/u.test(value)
    && !/(?:\b[a-z][a-z0-9+.-]*:\S|www\.)/i.test(value));

function unique<T extends z.ZodType>(item: T, maximum: number, minimum = 0) {
  return z.array(item).min(minimum).max(maximum)
    .refine((values) => new Set(values).size === values.length, "Duplicate values").readonly();
}

export const EvaluationTypeSchema = z.enum(["AUTOMATED", "MANUAL", "HYBRID"]);
export const ControlResultStatusSchema = z.enum(["PASS", "FAIL", "MANUAL", "NOT_APPLICABLE", "UNKNOWN", "ERROR"]);
export const ApplicabilitySchema = z.enum(["APPLICABLE", "NOT_APPLICABLE", "UNKNOWN"]);
export const EvaluationConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const RiskSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const CapabilityStatusSchema = z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]);
export const CollectorStatusSchema = z.enum(["SUCCESS", "PARTIAL", "FAILED"]);
export const ReasonCodeSchema = z.string().max(64).regex(/^[A-Z][A-Z0-9_]*$/);
export const CapabilityContextSchema = strictRecord(SdkIdSchema, CapabilityStatusSchema, 64);

export const ControlSchema = z.object({
  id: ControlIdSchema,
  title: SdkTextSchema,
  area: SdkIdSchema,
  order: z.number().int().min(1).max(10000),
  evaluationType: EvaluationTypeSchema,
  collectorRequirements: unique(SdkIdSchema, 32),
  evaluator: SdkIdSchema.nullable(),
  severity: RiskSeveritySchema,
  recommendationId: SdkIdSchema,
  parameters: FactsSchema,
}).strict().superRefine((control, context) => {
  if ((control.evaluationType === "AUTOMATED" && control.evaluator === null)
    || (control.evaluationType === "MANUAL" && control.evaluator !== null)) {
    context.addIssue({ code: "custom", path: ["evaluator"], message: "Evaluator does not match evaluation type" });
  }
}).readonly();

export const ControlPackSchema = z.object({
  schemaVersion: z.literal("cloudops.control-pack.v1"),
  id: SdkIdSchema,
  name: SdkTextSchema,
  framework: SdkIdSchema,
  frameworkVersion: SdkTextSchema,
  controlPackVersion: SdkVersionSchema,
  scope: unique(SdkIdSchema, 32, 1),
  source: z.object({ kind: z.enum(["DEVELOPMENT", "AUTHORIZED"]), reference: SdkTextSchema }).strict().readonly(),
  controls: z.array(ControlSchema).min(1).max(1000).readonly(),
}).strict().superRefine((pack, context) => {
  const ids = new Set<string>();
  for (const [index, control] of pack.controls.entries()) {
    if (ids.has(control.id) || !pack.scope.includes(control.area)) {
      context.addIssue({ code: "custom", path: ["controls", index], message: "Duplicate control or area outside scope" });
    }
    ids.add(control.id);
  }
}).readonly();

export const CollectorDefinitionSchema = z.object({
  id: SdkIdSchema,
  version: SdkVersionSchema,
  requiredPermissions: unique(z.string().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9.:-]*$/), 32),
  requiredCapabilities: unique(SdkIdSchema, 32),
  requiresAuthentication: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!value.requiresAuthentication && value.requiredPermissions.length) {
    context.addIssue({ code: "custom", path: ["requiredPermissions"], message: "Permissions require authentication" });
  }
}).readonly();
export const EvaluatorDefinitionSchema = z.object({
  id: SdkIdSchema, version: SdkVersionSchema, collectorRequirements: unique(SdkIdSchema, 32),
}).strict().readonly();
export const RecommendationSchema = z.object({
  recommendationId: SdkIdSchema, title: SdkTextSchema, summary: SdkTextSchema,
  technicalSteps: z.array(SdkTextSchema).max(32).readonly(),
  portalPath: z.array(SdkTextSchema).max(12).readonly(), impact: SdkTextSchema,
  rollback: z.array(SdkTextSchema).max(32).readonly(), validation: z.array(SdkTextSchema).max(32).readonly(),
}).strict().readonly();
export const ControlPackReferenceSchema = z.object({
  id: SdkIdSchema, version: SdkVersionSchema,
  file: z.string().max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/), sha256: ContentHashSchema,
}).strict().readonly();
export const AssessmentDefinitionSchema = z.object({
  schemaVersion: z.literal("cloudops.assessment-definition.v1"), assessmentId: SdkIdSchema,
  assessmentVersion: SdkVersionSchema, sdkVersion: z.literal(ASSESSMENT_SDK_VERSION),
  capabilities: unique(SdkIdSchema, 64), aiFactAllowlist: unique(FactNameSchema, 64),
  collectors: z.array(CollectorDefinitionSchema).max(100).readonly(),
  evaluators: z.array(EvaluatorDefinitionSchema).max(1000).readonly(),
  recommendations: z.array(RecommendationSchema).max(1000).readonly(),
  controlPacks: z.array(ControlPackReferenceSchema).min(1).max(32).readonly(),
}).strict().superRefine((definition, context) => {
  for (const [field, ids] of [
    ["collectors", definition.collectors.map((value) => value.id)],
    ["evaluators", definition.evaluators.map((value) => value.id)],
    ["recommendations", definition.recommendations.map((value) => value.recommendationId)],
    ["controlPacks", definition.controlPacks.map((value) => `${value.id}@${value.version}`)],
  ] as const) {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: [field], message: "Duplicate registration" });
  }
  for (const collector of definition.collectors) {
    if (collector.requiredCapabilities.some((id) => !definition.capabilities.includes(id))) {
      context.addIssue({ code: "custom", path: ["collectors"], message: "Unknown capability" });
    }
  }
  const collectorIds = new Set(definition.collectors.map((collector) => collector.id));
  if (definition.evaluators.some((evaluator) => evaluator.collectorRequirements.some((id) => !collectorIds.has(id)))) {
    context.addIssue({ code: "custom", path: ["evaluators"], message: "Unknown collector" });
  }
}).readonly();

export const AssessmentPlanSchema = z.object({
  schemaVersion: z.literal("cloudops.assessment-plan.v1"), packId: SdkIdSchema,
  controlPackVersion: SdkVersionSchema, controlIds: unique(ControlIdSchema, 1000, 1),
  collectorIds: unique(SdkIdSchema, 100), requiredPermissions: unique(z.string().min(1).max(100), 32),
}).strict().readonly();
export const AssessmentContextSchema = z.object({
  assessmentId: SdkIdSchema, assessmentVersion: SdkVersionSchema,
  sdkVersion: z.literal(ASSESSMENT_SDK_VERSION), assessmentTimestamp: SdkTimestampSchema,
  capabilities: CapabilityContextSchema, dataSource: z.enum(["SYNTHETIC", "LIVE"]),
}).strict().readonly();
export const CollectorResultSchema = z.object({
  schemaVersion: z.literal("cloudops.collector-result.v1"), collectorId: SdkIdSchema,
  status: CollectorStatusSchema, requestCount: SafeCountSchema, data: FactsSchema,
  warnings: unique(ReasonCodeSchema, 32),
}).strict().readonly();
export const NormalizedStateSchema = z.object({
  schemaVersion: z.literal("cloudops.normalized-state.v1"), assessmentTimestamp: SdkTimestampSchema,
  datasets: strictRecord(SdkIdSchema, z.object({ status: CollectorStatusSchema, facts: FactsSchema }).strict().readonly(), 100),
  capabilities: CapabilityContextSchema,
}).strict().readonly();
export const EvidenceSchema = z.object({ type: SdkIdSchema, facts: FactsSchema }).strict().readonly();
export const RiskSignalsSchema = z.object({
  exposed: z.boolean(), privileged: z.boolean(), compensatingControl: z.boolean(),
}).strict().readonly();
const resultFields = {
  controlId: ControlIdSchema, status: ControlResultStatusSchema, applicability: ApplicabilitySchema,
  observed: FactsSchema, expected: FactsSchema, evidence: z.array(EvidenceSchema).max(32).readonly(), reasonCode: ReasonCodeSchema,
};
function resultConsistency(value: { status: string; applicability: string; evidence: readonly unknown[] }, context: z.RefinementCtx) {
  if ((["PASS", "FAIL"].includes(value.status) && (value.applicability !== "APPLICABLE" || value.evidence.length === 0))
    || (value.status === "NOT_APPLICABLE" && value.applicability !== "NOT_APPLICABLE")
    || (value.applicability === "NOT_APPLICABLE" && value.status !== "NOT_APPLICABLE")) {
    context.addIssue({ code: "custom", path: ["status"], message: "Status requires consistent applicability and evidence" });
  }
}
export const ControlResultSchema = z.object({
  schemaVersion: z.literal("cloudops.control-result.v1"), ...resultFields,
  confidence: EvaluationConfidenceSchema, riskSignals: RiskSignalsSchema,
}).strict().superRefine(resultConsistency).readonly();
export const RiskSchema = z.object({
  modelVersion: z.literal("cloudops.risk.v1"), baseSeverity: RiskSeveritySchema,
  severity: RiskSeveritySchema, signals: RiskSignalsSchema,
}).strict().superRefine((risk, context) => {
  const ranks = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const base = ranks.indexOf(risk.baseSeverity);
  const increments = Number(risk.signals.exposed) + Number(risk.signals.privileged);
  const expected = ranks[Math.min(3, base + Math.max(0, increments - Number(risk.signals.compensatingControl)))];
  if (risk.severity !== expected) context.addIssue({ code: "custom", path: ["severity"], message: "Risk must follow the deterministic model" });
}).readonly();
export const FindingSchema = z.object({
  schemaVersion: z.literal("cloudops.finding.v1"), ...resultFields,
  title: SdkTextSchema, area: SdkIdSchema, recommendationId: SdkIdSchema,
  evaluation: z.object({ type: EvaluationTypeSchema, confidence: EvaluationConfidenceSchema,
    evaluatorId: SdkIdSchema.nullable(), evaluatorVersion: SdkVersionSchema.nullable() }).strict().readonly(),
  risk: RiskSchema,
}).strict().superRefine((finding, context) => {
  resultConsistency(finding, context);
  const automated = finding.evaluation.type === "AUTOMATED";
  if (automated ? finding.evaluation.evaluatorId === null || finding.evaluation.evaluatorVersion === null
    : finding.status !== "MANUAL" || finding.evaluation.evaluatorId !== null || finding.evaluation.evaluatorVersion !== null) {
    context.addIssue({ code: "custom", path: ["evaluation"], message: "Evaluation provenance must match the v1 execution type" });
  }
}).readonly();

export const CoverageRatioSchema = z.object({
  numerator: SafeCountSchema, denominator: SafeCountSchema, percent: z.number().min(0).max(100).nullable(),
}).strict().superRefine((value, context) => {
  const expected = value.denominator === 0 ? null : Math.round(value.numerator / value.denominator * 10000) / 100;
  if (value.numerator > value.denominator || value.percent !== expected) {
    context.addIssue({ code: "custom", message: "Ratio does not match its explicit denominator" });
  }
}).readonly();
export const AssessmentCoverageSchema = z.object({
  totalControls: SafeCountSchema, applicableControls: SafeCountSchema, applicabilityUnknownControls: SafeCountSchema,
  automatedControls: SafeCountSchema, manualControls: SafeCountSchema, hybridControls: SafeCountSchema,
  manualResultControls: SafeCountSchema,
  successfullyEvaluatedControls: SafeCountSchema, passedControls: SafeCountSchema, failedControls: SafeCountSchema,
  unknownControls: SafeCountSchema, errorControls: SafeCountSchema, notApplicableControls: SafeCountSchema,
  automationCoverage: CoverageRatioSchema, evaluatedPassRate: CoverageRatioSchema, evaluationCoverage: CoverageRatioSchema,
}).strict().superRefine((coverage, context) => {
  const success = coverage.passedControls + coverage.failedControls;
  const total = coverage.totalControls;
  if (coverage.automatedControls + coverage.manualControls + coverage.hybridControls !== total
    || success + coverage.manualResultControls + coverage.notApplicableControls + coverage.unknownControls + coverage.errorControls !== total
    || coverage.applicableControls + coverage.notApplicableControls + coverage.applicabilityUnknownControls !== total
    || coverage.successfullyEvaluatedControls !== success) {
    context.addIssue({ code: "custom", message: "Coverage partitions do not reconcile" });
  }
  for (const [ratio, numerator, denominator] of [
    [coverage.automationCoverage, coverage.automatedControls, total],
    [coverage.evaluatedPassRate, coverage.passedControls, success],
    [coverage.evaluationCoverage, success, total - coverage.notApplicableControls],
  ] as const) {
    if (ratio.numerator !== numerator || ratio.denominator !== denominator) {
      context.addIssue({ code: "custom", message: "Coverage metric uses an incorrect denominator" });
    }
  }
}).readonly();
export const AssessmentMetadataSchema = z.object({
  assessmentId: SdkIdSchema, assessmentVersion: SdkVersionSchema, sdkVersion: z.literal(ASSESSMENT_SDK_VERSION),
  assessmentTimestamp: SdkTimestampSchema, framework: SdkIdSchema, frameworkVersion: SdkTextSchema,
  controlPackId: SdkIdSchema, controlPackVersion: SdkVersionSchema, controlPackHash: ContentHashSchema,
  evaluatorVersions: strictRecord(SdkIdSchema, SdkVersionSchema, 1000), dataSource: z.enum(["SYNTHETIC", "LIVE"]),
}).strict().readonly();
export const AssessmentResultSchema = z.object({
  schemaVersion: z.literal("cloudops.assessment-result.v1"), metadata: AssessmentMetadataSchema,
  coverage: AssessmentCoverageSchema, findings: z.array(FindingSchema).max(1000).readonly(),
}).strict().superRefine((result, context) => validateFindings(result, context)).readonly();
export const AiAssessmentInputSchema = z.object({
  schemaVersion: z.literal("cloudops.ai-input.v1"), findings: z.array(z.object({
    controlId: ControlIdSchema, status: ControlResultStatusSchema, severity: RiskSeveritySchema,
    facts: strictRecord(FactNameSchema, z.union([z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.boolean()]), 64),
  }).strict().readonly()).max(1000).readonly(),
}).strict().readonly();
const advisoryText = z.string().min(1).max(2000).refine((value) => !/[<>\p{Cc}\p{Cf}]/u.test(value));
export const AiAdvisorySchema = z.object({
  executiveNarrative: advisoryText, technicalExplanation: advisoryText, riskContext: advisoryText,
  crossFindingCorrelations: z.array(advisoryText).max(32).readonly(),
  remediationPriority: z.array(advisoryText).max(32).readonly(), roadmapSuggestions: z.array(advisoryText).max(32).readonly(),
}).strict().readonly();
export const AiAssessmentEnrichmentSchema = z.object({
  schemaVersion: z.literal("cloudops.ai-enrichment.v1"), status: z.enum(["NOT_REQUESTED", "AVAILABLE", "UNAVAILABLE"]),
  advisory: AiAdvisorySchema.nullable(),
}).strict().refine((value) => (value.status === "AVAILABLE") === (value.advisory !== null)).readonly();
export const AssessmentReportModelSchema = z.object({
  schemaVersion: z.literal("cloudops.assessment-report.v1"), metadata: AssessmentMetadataSchema,
  summary: z.object({ criticalFindings: SafeCountSchema, highFindings: SafeCountSchema,
    mediumFindings: SafeCountSchema, lowFindings: SafeCountSchema }).strict().readonly(),
  coverage: AssessmentCoverageSchema,
  domainPosture: z.array(z.object({ area: SdkIdSchema, passed: SafeCountSchema, failed: SafeCountSchema,
    manual: SafeCountSchema, unknown: SafeCountSchema, error: SafeCountSchema, notApplicable: SafeCountSchema }).strict().readonly()).max(32).readonly(),
  findings: z.array(FindingSchema).max(1000).readonly(), manualControls: unique(ControlIdSchema, 1000),
  limitations: z.array(SdkTextSchema).max(32).readonly(), recommendations: z.array(RecommendationSchema).max(1000).readonly(),
  aiEnrichment: AiAssessmentEnrichmentSchema,
}).strict().superRefine((report, context) => {
  validateFindings(report, context);
  const manualIds = report.findings.filter((finding) => finding.status === "MANUAL").map((finding) => finding.controlId);
  if (manualIds.length !== report.manualControls.length || manualIds.some((id) => !report.manualControls.includes(id))) {
    context.addIssue({ code: "custom", path: ["manualControls"], message: "Manual result references do not reconcile" });
  }
  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const finding of report.findings) if (finding.status === "FAIL") severityCounts[finding.risk.severity]++;
  if (report.summary.criticalFindings !== severityCounts.CRITICAL || report.summary.highFindings !== severityCounts.HIGH
    || report.summary.mediumFindings !== severityCounts.MEDIUM || report.summary.lowFindings !== severityCounts.LOW) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Summary must count only failed controls" });
  }
  const domains = new Map<string, { passed: number; failed: number; manual: number; unknown: number; error: number; notApplicable: number }>();
  const statusKeys = { PASS: "passed", FAIL: "failed", MANUAL: "manual", UNKNOWN: "unknown", ERROR: "error", NOT_APPLICABLE: "notApplicable" } as const;
  for (const finding of report.findings) {
    const domain = domains.get(finding.area) ?? { passed: 0, failed: 0, manual: 0, unknown: 0, error: 0, notApplicable: 0 };
    domain[statusKeys[finding.status]]++;
    domains.set(finding.area, domain);
  }
  if (report.domainPosture.length !== domains.size || new Set(report.domainPosture.map((domain) => domain.area)).size !== domains.size
    || report.domainPosture.some((domain) => {
      const expected = domains.get(domain.area);
      return !expected || Object.values(statusKeys).some((key) => domain[key] !== expected[key]);
    })) context.addIssue({ code: "custom", path: ["domainPosture"], message: "Domain posture must match findings" });
  const referenced = new Set(report.findings.map((finding) => finding.recommendationId));
  const catalog = new Set(report.recommendations.map((recommendation) => recommendation.recommendationId));
  if (catalog.size !== report.recommendations.length || catalog.size !== referenced.size || [...referenced].some((id) => !catalog.has(id))) {
    context.addIssue({ code: "custom", path: ["recommendations"], message: "Report recommendations must match finding references" });
  }
}).readonly();

function validateFindings(value: { findings: readonly z.infer<typeof FindingSchema>[]; coverage: z.infer<typeof AssessmentCoverageSchema>; metadata: z.infer<typeof AssessmentMetadataSchema> }, context: z.RefinementCtx) {
  const findings = value.findings;
  const count = (predicate: (finding: z.infer<typeof FindingSchema>) => boolean) => findings.filter(predicate).length;
  const expected = {
    totalControls: findings.length,
    applicableControls: count((finding) => finding.applicability === "APPLICABLE"),
    applicabilityUnknownControls: count((finding) => finding.applicability === "UNKNOWN"),
    automatedControls: count((finding) => finding.evaluation.type === "AUTOMATED"),
    manualControls: count((finding) => finding.evaluation.type === "MANUAL"),
    hybridControls: count((finding) => finding.evaluation.type === "HYBRID"),
    manualResultControls: count((finding) => finding.status === "MANUAL"),
    successfullyEvaluatedControls: count((finding) => finding.status === "PASS" || finding.status === "FAIL"),
    passedControls: count((finding) => finding.status === "PASS"), failedControls: count((finding) => finding.status === "FAIL"),
    unknownControls: count((finding) => finding.status === "UNKNOWN"), errorControls: count((finding) => finding.status === "ERROR"),
    notApplicableControls: count((finding) => finding.status === "NOT_APPLICABLE"),
  };
  if (new Set(findings.map((finding) => finding.controlId)).size !== findings.length
    || (Object.keys(expected) as Array<keyof typeof expected>).some((key) => value.coverage[key] !== expected[key])) {
    context.addIssue({ code: "custom", path: ["coverage"], message: "Findings and coverage do not reconcile" });
  }
  const versions = new Map<string, string>();
  for (const finding of findings) {
    const { evaluatorId, evaluatorVersion } = finding.evaluation;
    if (evaluatorId !== null && evaluatorVersion !== null) {
      if (versions.has(evaluatorId) && versions.get(evaluatorId) !== evaluatorVersion) {
        context.addIssue({ code: "custom", path: ["metadata", "evaluatorVersions"], message: "Conflicting evaluator versions" });
      }
      versions.set(evaluatorId, evaluatorVersion);
    }
  }
  if (Object.keys(value.metadata.evaluatorVersions).length !== versions.size
    || [...versions].some(([id, version]) => value.metadata.evaluatorVersions[id] !== version)) {
    context.addIssue({ code: "custom", path: ["metadata", "evaluatorVersions"], message: "Evaluator provenance does not match findings" });
  }
}

export type Control = z.infer<typeof ControlSchema>;
export type ControlPack = z.infer<typeof ControlPackSchema>;
export type CollectorDefinition = z.infer<typeof CollectorDefinitionSchema>;
export type EvaluatorDefinition = z.infer<typeof EvaluatorDefinitionSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type AssessmentDefinition = z.infer<typeof AssessmentDefinitionSchema>;
export type AssessmentPlan = z.infer<typeof AssessmentPlanSchema>;
export type AssessmentContext = z.infer<typeof AssessmentContextSchema>;
export type CollectorResult = z.infer<typeof CollectorResultSchema>;
export type NormalizedState = z.infer<typeof NormalizedStateSchema>;
export type ControlResult = z.infer<typeof ControlResultSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
export type AssessmentReportModel = z.infer<typeof AssessmentReportModelSchema>;
export type AiAssessmentInput = z.infer<typeof AiAssessmentInputSchema>;
export type AiAssessmentEnrichment = z.infer<typeof AiAssessmentEnrichmentSchema>;

/** Optional future adapter. Returned data is untrusted and must pass
 * AiAssessmentEnrichmentSchema (the full status/advisory envelope).
 * An AVAILABLE envelope must contain an advisory that passes AiAdvisorySchema.
 * This interface grants no authority over the authoritative assessment result.
 */
export interface AiEnrichmentProvider {
  enrich(input: AiAssessmentInput, context: { readonly timeoutMilliseconds: number }): Promise<unknown>;
}
