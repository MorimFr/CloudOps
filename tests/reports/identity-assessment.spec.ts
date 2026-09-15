import { spawnSync } from "node:child_process";
import path from "node:path";
import { AssessmentReportModelSchema, AssessmentResultSchema } from "@cloudops/contracts";
import { expect, test } from "@playwright/test";

let html: string;
test.beforeAll(() => {
  const run = spawnSync("docker", [
    "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--env", "HOME=/tmp/cloudops-home",
    "--env", "XDG_CACHE_HOME=/tmp/cloudops-home/.cache", "--env", "PSModuleAnalysisCachePath=/dev/null",
    "--mount", `type=bind,source=${path.resolve("engine")},target=/workspace/engine,readonly`,
    process.env.CLOUDOPS_TEST_IMAGE ?? "cloudops-runtime:local",
    "pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
    "engine/identity-assessment/tests/Validate-IdentityAssessment.ps1", "-EmitPreview",
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  expect(run.status, run.stderr).toBe(0);
  const preview = JSON.parse(run.stdout) as {
    html: string; findingsCsv: string; controlsCsv: string; result: unknown; reportModel: unknown; metadata: unknown;
  };
  const result = AssessmentResultSchema.parse(preview.result);
  const report = AssessmentReportModelSchema.parse(preview.reportModel);
  expect(report.metadata).toEqual(result.metadata);
  expect(preview.metadata).toEqual(result.metadata);
  expect(report.findings).toEqual(result.findings);
  expect(result.findings.map((finding) => finding.status)).toEqual(["PASS", "FAIL", "MANUAL"]);
  expect(report.metadata.dataSource).toBe("SYNTHETIC");
  expect(preview.findingsCsv.split("\r\n")[0]).toBe("ControlId,Area,Status,Severity,Confidence,Title,RecommendationId");
  expect(preview.controlsCsv.split("\r\n")[0]).toBe("ControlId,Area,EvaluationType,Status");
  html = preview.html;
  expect(html).not.toMatch(/forbidden-canary|userPrincipalName|accessToken|tenantId|https?:\/\//u);
});

for (const width of [1440, 768, 390]) {
  test(`offline synthetic identity report at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests: string[] = [];
    await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent(html);
    await expect(page.getByRole("heading", { level: 1, name: "Identity Assessment" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("SYNTHETIC DATA");
    await expect(page.getByRole("note")).toContainText("NOT CIS");
    await expect(page.locator(".metric")).toHaveCount(4);
    await expect(page.locator(".area-card")).toHaveCount(8);
    await expect(page.locator(".findings-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".evidence-card")).toHaveCount(3);
    await expect(page.locator(".recommendation")).toHaveCount(3);
    await expect(page.locator(".coverage-table")).toContainText("manualResultControls");
    await expect(page.locator("script, img, iframe, link, form, a[href]")).toHaveCount(0);
    for (const name of ["Executive Summary", "Coverage", "Identity Posture Overview", "Critical Findings", "All Findings", "Manual Validation Required", "Remediation Roadmap", "Methodology", "Limitations", "Technical Evidence Summary", "Assessment Metadata"]) {
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
    await expect(page.locator(".legend li")).toHaveCount(6);
    const count = await page.locator(".legend strong").evaluateAll((items) => items.reduce((sum, item) => sum + Number(item.textContent), 0));
    expect(count).toBe(3);
    const widths = await page.locator(".chart circle[stroke-dasharray]").evaluateAll((items) => items.reduce((sum, item) => sum + Number.parseFloat(item.getAttribute("stroke-dasharray") ?? "0"), 0));
    expect(widths).toBeCloseTo(100, 3);
    expect(await page.locator(".chart svg").getAttribute("aria-labelledby")).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(requests).toEqual([]);
    if (process.env.CLOUDOPS_UI_SCREENSHOTS === "true") {
      // Explicit opt-in: these captures contain only the fixed development fixture.
      await page.screenshot({ path: info.outputPath(`identity-${width}.png`), fullPage: true });
    }
  });
}

test("identity print retains coverage, warning and offline evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1123, height: 794 });
  const requests: string[] = [];
  await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(html);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".findings-table")).toHaveCSS("min-width", "0px");
  await expect(page.getByRole("note")).toBeVisible();
  await expect(page.locator(".chart svg")).toHaveCount(1);
  await expect(page.locator(".evidence-card")).toHaveCount(3);
  await expect(page.locator(".coverage-table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toEqual([]);
});
