import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("API configuration", () => {
  it("reads the expected Web client ID only from backend configuration", () => {
    const id = "66666666-6666-4666-8666-666666666666";
    expect(loadConfig({ CLOUDOPS_ENTRA_WEB_CLIENT_ID: id }).entraWebClientId).toBe(id);
    expect(loadConfig({ VITE_ENTRA_WEB_CLIENT_ID: id }).entraWebClientId).toBe("");
  });
  it("normalizes one explicit CORS origin", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      WEB_ORIGIN: "http://localhost:5173/",
    });

    expect(config.webOrigin).toBe("http://localhost:5173");
  });

  it.each([
    "*",
    "null",
    "file:///tmp/cloudops",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?redirect=attacker.invalid",
  ])("rejects unsafe CORS configuration %s", (webOrigin) => {
    expect(() =>
      loadConfig({ NODE_ENV: "development", WEB_ORIGIN: webOrigin }),
    ).toThrow(/WEB_ORIGIN/);
  });

  it("parses bounded OBO and artifact limits", () => {
    const config = loadConfig({
      OBO_TIMEOUT_SECONDS: "7",
      MAX_ARTIFACT_BYTES: "1048576",
    });

    expect(config.oboTimeoutMs).toBe(7_000);
    expect(config.maxArtifactBytes).toBe(1_048_576);
    expect(() => loadConfig({ OBO_TIMEOUT_SECONDS: "0" })).toThrow(
      /OBO_TIMEOUT_SECONDS/,
    );
  });
});
