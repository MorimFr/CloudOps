import { spawnSync } from "node:child_process";
import path from "node:path";
import { AssessmentReportModelSchema, SanitizedExecutiveSummaryInputSchema } from "@cloudops/contracts";
import { expect, test } from "@playwright/test";

let html: string;
test.beforeAll(() => {
  const run = spawnSync("docker", ["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--env", "HOME=/tmp/cloudops-home", "--env", "XDG_CACHE_HOME=/tmp/cloudops-home/.cache", "--env", "PSModuleAnalysisCachePath=/dev/null",
    "--mount", `type=bind,source=${path.resolve("engine")},target=/workspace/engine,readonly`, process.env.CLOUDOPS_TEST_IMAGE ?? "cloudops-runtime:local",
    "pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", "engine/identity-assessment/tests/Validate-Wave1Report.ps1", "-EmitPreview"],
  { encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  expect(run.status, run.stderr).toBe(0);
  const fixture = JSON.parse(run.stdout) as { html: string; aiInput: unknown; reportModel: unknown };
  expect(AssessmentReportModelSchema.parse(fixture.reportModel).summary).toEqual({ criticalFindings: 0, highFindings: 4, mediumFindings: 2, lowFindings: 1 });
  SanitizedExecutiveSummaryInputSchema.parse(fixture.aiInput);
  html = fixture.html;
});
for (const width of [1440, 768, 390]) {
  test(`CloudOps Report Standard v1 offline at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests: string[] = [];
    await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent(html);
    await expect(page.getByRole("heading", { level: 1, name: "Assessment de Identidade" })).toBeVisible();
    await expect(page.locator(".metric")).toHaveCount(8);
    await expect(page.locator(".findings-table")).toHaveCount(3);
    expect(await page.locator("section[data-severity]").evaluateAll((sections) => sections.map((s) => s.getAttribute("data-severity")))).toEqual(["HIGH", "MEDIUM", "LOW"]);
    for (const [index, count] of [4, 2, 1].entries()) {
      const table = page.locator(".findings-table").nth(index);
      await expect(table.locator("tbody tr")).toHaveCount(count);
      expect(await table.locator("th").allTextContents()).toEqual(["Controle Avaliado", "Gap", "Descrição do Gap", "Recomendação"]);
    }
    await expect(page.locator(".executive-summary")).toContainText("Resumo executivo gerado sem enriquecimento de IA.");
    await expect(page.locator("header")).toContainText("Organização sintética <canary>");
    await expect(page.locator("canary, script, iframe, img, link, form, a[href]")).toHaveCount(0);
    await expect(page.locator("details")).toContainText("Controles conformes (3)");
    await expect(page.locator(".findings-table").first()).toContainText("allowedToCreateApps = true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(requests).toEqual([]);
  });
}
test("Wave 1 print keeps evidence, coverage and severity counts", async ({ page }) => {
  await page.setViewportSize({ width: 1123, height: 794 }); await page.setContent(html); await page.emulateMedia({ media: "print" });
  await expect(page.locator(".findings-table").first()).toHaveCSS("min-width", "0px");
  await expect(page.locator(".findings-table tbody tr")).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Cobertura da avaliação", exact: true })).toBeVisible();
  await expect(page.locator(".provenance")).toContainText("cloudops.assessment-sdk.v1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
