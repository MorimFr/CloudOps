import path from "node:path";

import { describe, expect, it } from "vitest";

import { CloudOpsError } from "../src/errors.js";
import {
  AssessmentRegistry,
  type AssessmentRegistration,
} from "../src/services/assessment-registry.js";

const registration: AssessmentRegistration = {
  id: "hello-world",
  name: "Hello World Assessment",
  scriptRelativePath: path.join("hello-world", "Invoke-Assessment.ps1"),
  enabled: true,
  timeoutMs: 30_000,
};

describe("AssessmentRegistry", () => {
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
    });
    expect(assessment).not.toHaveProperty("scriptPath");
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
