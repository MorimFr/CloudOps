import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/ui",
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command: "npm run dev --workspace @cloudops/web -- --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 60000,
    env: { VITE_CLOUDOPS_API_URL: "http://127.0.0.1:3000", VITE_SHOW_DEV_ASSESSMENTS: "false" },
  },
});
