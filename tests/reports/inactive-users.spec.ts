import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

let html: string;
test.beforeAll(() => {
  const run = spawnSync("docker", [
    "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m",
    "--env", "HOME=/tmp/cloudops-home", "--env", "XDG_CACHE_HOME=/tmp/cloudops-home/.cache",
    "--env", "PSModuleAnalysisCachePath=/dev/null", "--mount",
    `type=bind,source=${path.resolve("engine")},target=/workspace/engine,readonly`,
    process.env.CLOUDOPS_TEST_IMAGE ?? "cloudops-runtime:local",
    "pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", "engine/tests/Validate-InactiveUsers.ps1", "-EmitPreview",
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  expect(run.status, run.stderr).toBe(0);
  const preview = JSON.parse(run.stdout) as { html: string; csv: string };
  html = preview.html;
  expect(preview.csv.split("\r\n")[0]).toBe('"Nome";"UPN";"Tipo de Conta";"Tipo de convidado";"Dias sem login bem-sucedido";"Data Criação (UTC)";"Licenciado";"Licença"');
});

for (const width of [1440, 768, 390]) {
  test(`offline executive report at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests: string[] = [];
    await page.route("**/*", (route) => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent(html);
    await expect(page.getByRole("heading", { level: 1, name: "Usuários inativos" })).toBeVisible();
    await expect(page.locator(".metric")).toHaveCount(8);
    await expect(page.locator(".chart svg")).toHaveCount(7);
    await expect(page.locator(".sample-table tbody tr")).toHaveCount(9);
    await expect(page.locator("script, img, iframe, link, form")).toHaveCount(0);
    await expect(page.locator(".metric").filter({ hasText: "Usuários no tenant" }).locator("strong")).toHaveText("14");
    await expect(page.locator(".metric").filter({ hasText: "Usuários inativos" }).locator("strong")).toHaveText("9");
    await expect(page.getByRole("heading", { name: "Evidências e qualidade dos dados" })).toBeVisible();
    await expect(page.locator(".evidence-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".reason-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".indeterminate-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".indeterminate-table")).toContainText("<script>unsafe()</script>@example.invalid");
    const evidenceTotal = await page.locator(".evidence-table tbody td").evaluateAll((cells) => cells.reduce((sum, cell) => sum + Number(cell.textContent), 0));
    const reasonsTotal = await page.locator(".reason-table tbody td").evaluateAll((cells) => cells.reduce((sum, cell) => sum + Number(cell.textContent), 0));
    expect(evidenceTotal).toBe(9);
    expect(reasonsTotal).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const chart of await page.locator(".chart").all()) {
      const circle = chart.locator("svg");
      expect(await circle.getAttribute("aria-labelledby")).toBeTruthy();
      const totalWidths = await chart.locator(".track > span").evaluateAll((bars) => bars.reduce((sum, bar) => sum + Number.parseFloat((bar as HTMLElement).style.width), 0));
      expect(totalWidths).toBeCloseTo(100, 3);
    }
    expect(requests).toEqual([]);
    if (process.env.CLOUDOPS_UI_SCREENSHOTS === "true") {
      // Opt-in captures only synthetic fixtures, never a real tenant report.
      await page.screenshot({ path: info.outputPath(`executive-${width}.png`), fullPage: true });
    }
  });
}

test("print layout retains data and offline charts", async ({ page }) => {
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.setContent(html);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sample-table")).toHaveCSS("min-width", "0px");
  await expect(page.locator(".chart svg")).toHaveCount(7);
  await expect(page.locator(".reason-table")).toBeVisible();
  await expect(page.locator(".evidence-table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
