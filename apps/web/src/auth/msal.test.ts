import { BrowserCacheLocation } from "@azure/msal-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_REDIRECT_PATH,
  MICROSOFT_ORGANIZATIONS_AUTHORITY,
  createMsalConfiguration,
  readEntraBrowserSettings,
  deriveCombinedConsentScope,
} from "./msal";

describe("MSAL browser configuration", () => {
  it("derives combined consent from the validated API resource without mixing scopes", () => {
    expect(deriveCombinedConsentScope("api://22222222-2222-4222-8222-222222222222/Assessment.Run"))
      .toBe("api://22222222-2222-4222-8222-222222222222/.default");
    for (const invalid of ["https://graph.microsoft.com/User.Read", "api://22222222-2222-4222-8222-222222222222/.default", "api://22222222-2222-4222-8222-222222222222/Assessment.Run other", "api://../../Assessment.Run"]) {
      expect(() => deriveCombinedConsentScope(invalid)).toThrow();
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses organizations, an isolated popup callback, CP1, and memory-only caches", () => {
    const configuration = createMsalConfiguration(
      {
        clientId: "11111111-1111-4111-8111-111111111111",
        apiScope:
          "api://22222222-2222-4222-8222-222222222222/Assessment.Run",
      },
      "https://cloudops.example",
    );

    expect(configuration.auth.authority).toBe(
      MICROSOFT_ORGANIZATIONS_AUTHORITY,
    );
    expect(configuration.auth.redirectUri).toBe(
      `https://cloudops.example${AUTH_REDIRECT_PATH}`,
    );
    expect(configuration.auth.clientCapabilities).toEqual(["CP1"]);
    expect(configuration.cache?.cacheLocation).toBe(
      BrowserCacheLocation.MemoryStorage,
    );
    expect(configuration.cache?.cacheRetentionDays).toBe(0);
    expect(configuration.cache?.temporaryCacheLocation).toBe(
      BrowserCacheLocation.MemoryStorage,
    );
    expect(configuration.cache?.storeAuthStateInCookie).toBe(false);
    expect(configuration.cache?.cacheMigrationEnabled).toBe(false);
  });

  it("accepts distinct Web and API app client IDs in the configured scope", () => {
    vi.stubEnv(
      "VITE_ENTRA_WEB_CLIENT_ID",
      "11111111-1111-4111-8111-111111111111",
    );
    vi.stubEnv(
      "VITE_ENTRA_API_SCOPE",
      "api://22222222-2222-4222-8222-222222222222/Assessment.Run",
    );

    expect(readEntraBrowserSettings()).toEqual({
      clientId: "11111111-1111-4111-8111-111111111111",
      apiScope:
        "api://22222222-2222-4222-8222-222222222222/Assessment.Run",
    });
  });

  it("rejects malformed or overprivileged scope configuration", () => {
    vi.stubEnv(
      "VITE_ENTRA_WEB_CLIENT_ID",
      "11111111-1111-4111-8111-111111111111",
    );
    vi.stubEnv(
      "VITE_ENTRA_API_SCOPE",
      "https://graph.microsoft.com/User.Read",
    );

    expect(readEntraBrowserSettings()).toBeNull();
  });

  it("rejects using one app registration as both the SPA and API", () => {
    vi.stubEnv(
      "VITE_ENTRA_WEB_CLIENT_ID",
      "11111111-1111-4111-8111-111111111111",
    );
    vi.stubEnv(
      "VITE_ENTRA_API_SCOPE",
      "api://11111111-1111-4111-8111-111111111111/Assessment.Run",
    );

    expect(readEntraBrowserSettings()).toBeNull();
  });
});
