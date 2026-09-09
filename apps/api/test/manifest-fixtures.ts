import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AssessmentManifestSchema } from "@cloudops/contracts";
import type { DiscoveredAssessment } from "../src/services/assessment-discovery.js";

export function syntheticManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "cloudops.assessment.v1", id: "test-assessment", name: "Synthetic assessment",
    description: "Synthetic static metadata.", provider: "azure", domain: "secops",
    moduleId: "security-assessments", assessmentOrder: 50, enabled: true, visibility: "public",
    engine: { runtime: "powershell", entrypoint: "Invoke-Assessment.ps1", timeoutSeconds: 60 },
    auth: { provider: "none", permissions: [], adminConsentRequired: false },
    ...overrides,
  };
}

export function syntheticPlugin(overrides: Record<string, unknown> = {}): DiscoveredAssessment {
  const manifest = AssessmentManifestSchema.parse(syntheticManifest(overrides));
  // For pure registry/manager tests only. Discovery tests validate real files.
  return { manifest, scriptPath: path.join(tmpdir(), "cloudops-synthetic-engine", manifest.id, "Invoke-Assessment.ps1") };
}

export function temporaryEngine(): string {
  return mkdtempSync(path.join(tmpdir(), "cloudops-manifest-test-"));
}

export function writeSyntheticPlugin(root: string, directory = "test-assessment", manifest: unknown = syntheticManifest(), script = "throw 'Discovery must never execute this script.'") {
  const folder = path.join(root, directory);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "assessment.json"), JSON.stringify(manifest));
  writeFileSync(path.join(folder, "Invoke-Assessment.ps1"), script);
  return folder;
}
