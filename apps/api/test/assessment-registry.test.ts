import path from "node:path";

import { describe, expect, it } from "vitest";

import { CloudOpsError } from "../src/errors.js";
import {
  AssessmentRegistry,
  createDefaultAssessmentRegistry,
  type AssessmentRegistration,
} from "../src/services/assessment-registry.js";

const registration: AssessmentRegistration = {
  id: "hello-world",
  name: "Hello World Assessment",
  scriptRelativePath: path.join("hello-world", "Invoke-Assessment.ps1"),
  enabled: true,
  timeoutMs: 30_000,
  provider: "azure",
  domain: "devops",
  moduleId: "runtime-validation",
  assessmentOrder: 1,
  visibility: "development",
  requiredAuthProvider: "none",
  requiredPermissions: [],
  adminConsentRequired: false,
};

describe("AssessmentRegistry", () => {
  it("registers inactive users with read-only permissions and existing assessments", () => {
    const assessments = createDefaultAssessmentRegistry(
      path.resolve("engine"),
    ).list();

    expect(assessments).toEqual([
      expect.objectContaining({
        id: "inactive-users", name: "Mapear Usuários Inativos",
        provider: "azure", domain: "secops", moduleId: "identity-visibility",
        visibility: "public", requiredAuthProvider: "microsoft-graph",
        requiredPermissions: ["User.Read", "User.Read.All", "AuditLog.Read.All", "LicenseAssignment.Read.All"],
        adminConsentRequired: true,
      }),
      expect.objectContaining({
        id: "hello-world",
        provider: "azure",
        domain: "devops",
        visibility: "development",
        requiredAuthProvider: "none",
        requiredPermissions: [],
        adminConsentRequired: false,
      }),
      expect.objectContaining({
        id: "microsoft-graph-connectivity",
        provider: "azure",
        domain: "secops",
        visibility: "public",
        requiredAuthProvider: "microsoft-graph",
        requiredPermissions: ["User.Read"],
        adminConsentRequired: false,
      }),
    ]);
  });

  it("allows a bounded long inventory without changing diagnostic timeouts", () => {
    const registry = createDefaultAssessmentRegistry(path.resolve("engine"));
    expect(registry.resolve("inactive-users").timeoutMs).toBe(55 * 60_000);
    expect(registry.resolve("inactive-users").maxConcurrentExecutions).toBe(1);
    expect(registry.list()[0]).not.toHaveProperty("maxConcurrentExecutions");
    expect(registry.resolve("microsoft-graph-connectivity").timeoutMs).toBe(60_000);
    expect(() => new AssessmentRegistry(path.resolve("engine"), [{ ...registration, timeoutMs: 56 * 60_000 }])).toThrow(/timeout/);
  });

  it("does not resolve an unknown assessment", () => {
    const registry = new AssessmentRegistry(path.resolve("engine"), [
      registration,
    ]);

    expect(() => registry.resolve("not-registered")).toThrowError(
      CloudOpsError,
    );
    try {
      registry.resolve("not-registered");
    } catch (error) {
      expect(error).toMatchObject({ code: "ASSESSMENT_NOT_FOUND" });
    }
  });

  it("never exposes the approved script path in the public catalog", () => {
    const registry = new AssessmentRegistry(path.resolve("engine"), [
      registration,
    ]);

    const [assessment] = registry.list();
    expect(assessment).toEqual({
      id: "hello-world",
      name: "Hello World Assessment",
      enabled: true,
      provider: "azure",
      domain: "devops",
      moduleId: "runtime-validation",
      moduleName: "Validação de runtime",
      moduleDescription: "Testes de desenvolvimento do pipeline efêmero de execução e relatórios.",
      moduleOrder: 1,
      assessmentOrder: 1,
      visibility: "development",
      requiredAuthProvider: "none",
      requiredPermissions: [],
      adminConsentRequired: false,
    });
    expect(assessment).not.toHaveProperty("scriptPath");
  });

  it("copies and freezes permission metadata at the registry boundary", () => {
    const requiredPermissions: "User.Read"[] = ["User.Read"];
    const registry = new AssessmentRegistry(path.resolve("engine"), [
      {
        ...registration,
        id: "graph-connectivity",
        provider: "azure",
        domain: "secops",
        moduleId: "connectivity-diagnostics",
        visibility: "public",
        requiredAuthProvider: "microsoft-graph",
        requiredPermissions,
      },
    ]);
    requiredPermissions.length = 0;

    const [assessment] = registry.list();
    expect(assessment?.requiredPermissions).toEqual(["User.Read"]);
    expect(Object.isFrozen(assessment?.requiredPermissions)).toBe(true);
    expect(registry.resolve("graph-connectivity").requiredPermissions).toEqual([
      "User.Read",
    ]);
  });

  it("rejects registry paths that escape the trusted engine root", () => {
    expect(
      () =>
        new AssessmentRegistry(path.resolve("engine"), [
          { ...registration, scriptRelativePath: "../outside.ps1" },
        ]),
    ).toThrow(/escapes/);
  });
});
