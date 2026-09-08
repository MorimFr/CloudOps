import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/reports", workers: 1, retries: 0, reporter: "list", timeout: 90_000,
  outputDir: "test-results/reports",
  use: {
    browserName: "chromium", ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true, trace: "off", video: "off", screenshot: "off",
  },
});
