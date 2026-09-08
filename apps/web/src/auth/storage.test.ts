import { describe, expect, it } from "vitest";

import appSource from "../App.tsx?raw";
import apiSource from "../api/cloudops.ts?raw";
import authProviderSource from "./AuthProvider.tsx?raw";
import msalSource from "./msal.ts?raw";
import launchSource from "./useAssessmentLaunch.ts?raw";
import consentSource from "./consent.ts?raw";

const SECURITY_CRITICAL_CLIENT_SOURCES = [
  msalSource,
  authProviderSource,
  apiSource,
  appSource,
  launchSource,
  consentSource,
];

describe("frontend zero-retention storage policy", () => {
  it("does not use persistent browser storage for auth or execution data", () => {
    for (const source of SECURITY_CRITICAL_CLIENT_SOURCES) {
      expect(source).not.toMatch(/\blocalStorage\b/);
      expect(source).not.toMatch(/\bsessionStorage\b/);
      expect(source).not.toMatch(/\bindexedDB\b/i);
    }
  });
});
