import { z } from "zod";
import { ControlResultStatusSchema, RiskSeveritySchema } from "./assessment-sdk.js";

// Closed catalog: no Graph-derived label, name, identifier or free text enters AI.
export const WAVE1_AI_CATALOG = {
  "cis-m365-5-1-2-2": ["applications-consent", "application-registration-enabled"],
  "cis-m365-5-1-2-3": ["user-lifecycle", "tenant-creation-enabled"],
  "cis-m365-5-1-3-1": ["identity-governance", "security-group-creation-enabled"],
  "cis-m365-5-1-3-4": ["identity-governance", "m365-group-creation-enabled"],
  "cis-m365-5-1-4-2": ["device-identity", "device-quota-exceeded"],
  "cis-m365-5-1-4-5": ["device-identity", "laps-disabled"],
  "cis-m365-5-1-4-6": ["device-identity", "bitlocker-recovery-enabled"],
  "cis-m365-5-1-5-2": ["applications-consent", "admin-consent-disabled"],
  "cis-m365-5-1-6-2": ["guest-external-identity", "guest-access-unrestricted"],
  "cis-m365-5-1-6-3": ["guest-external-identity", "guest-invitations-unrestricted"],
} as const;
export const CisProfileSchema = z.enum(["E3_L1", "E3_L2", "E5_L1", "E5_L2"]);
const count = z.number().int().min(0).max(10);
const safeNarrative = z.string().min(1).max(2500).refine((s) => s.trim().length > 0
  && !/[\p{Cc}\p{Cf}]/u.test(s)
  && !/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(s));
export const AiExecutiveSummarySchema = z.object({
  executiveSummary: safeNarrative,
  keyRiskThemes: z.array(safeNarrative).max(6),
  priorityNarrative: safeNarrative,
  managementConclusion: safeNarrative,
}).strict();
export type AiExecutiveSummary = z.infer<typeof AiExecutiveSummarySchema>;
export const AI_EXECUTIVE_SUMMARY_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    executiveSummary: { type: "string" }, keyRiskThemes: { type: "array", items: { type: "string" } },
    priorityNarrative: { type: "string" }, managementConclusion: { type: "string" },
  },
  required: ["executiveSummary", "keyRiskThemes", "priorityNarrative", "managementConclusion"],
} as const;
export const SanitizedExecutiveSummaryInputSchema = z.object({
  framework: z.literal("cis-m365"), frameworkVersion: z.literal("7.0.0"), profile: CisProfileSchema,
  controlCounts: z.object({ total: count, passed: count, failed: count, manual: count, unknown: count, error: count, notApplicable: count }).strict(),
  severityCounts: z.object({ critical: count, high: count, medium: count, low: count }).strict(),
  findings: z.array(z.object({
    controlId: z.enum(Object.keys(WAVE1_AI_CATALOG) as [keyof typeof WAVE1_AI_CATALOG, ...Array<keyof typeof WAVE1_AI_CATALOG>]),
    area: z.string().max(48), status: ControlResultStatusSchema, severity: RiskSeveritySchema,
    // Intentionally no policy facts in the initial AI integration. Strict empty allowlist.
    facts: z.object({}).strict(), gapLabel: z.string().max(64),
  }).strict()).max(10),
}).strict().superRefine((input, ctx) => {
  const ids = new Set(input.findings.map((f) => f.controlId));
  const counts = input.controlCounts;
  const statuses = { PASS: "passed", FAIL: "failed", MANUAL: "manual", UNKNOWN: "unknown", ERROR: "error", NOT_APPLICABLE: "notApplicable" } as const;
  const valid = ids.size === input.findings.length && counts.total === input.findings.length
    && Object.entries(statuses).every(([status, key]) => counts[key] === input.findings.filter((f) => f.status === status).length)
    && Object.entries(input.severityCounts).every(([key, value]) => value === input.findings.filter((f) => f.status === "FAIL" && f.severity.toLowerCase() === key).length)
    && input.findings.every((f) => f.area === WAVE1_AI_CATALOG[f.controlId][0]
      && f.gapLabel === (f.status === "FAIL" ? WAVE1_AI_CATALOG[f.controlId][1] : "no-confirmed-gap"))
    && (!input.profile.endsWith("L1") || input.findings.every((f) => !["cis-m365-5-1-3-4", "cis-m365-5-1-4-6", "cis-m365-5-1-6-3"].includes(f.controlId)));
  if (!valid) ctx.addIssue({ code: "custom", message: "Sanitized summary data does not reconcile" });
});
export type SanitizedExecutiveSummaryInput = z.infer<typeof SanitizedExecutiveSummaryInputSchema>;
export const AiExecutiveSummaryRequestSchema = z.object({
  type: z.literal("aiExecutiveSummaryRequest"), input: SanitizedExecutiveSummaryInputSchema,
}).strict();
