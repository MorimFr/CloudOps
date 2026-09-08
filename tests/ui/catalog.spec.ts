import { expect, test, type Page } from "@playwright/test";

test("popup callback stays script-free and no-store even on the development server", async ({ page }) => {
  const response = await page.goto("/auth-redirect.html");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.getByText("Processing Microsoft authentication…")).toBeVisible();
});

// These tools are test fixtures, not registry entries or product capabilities.
const tool = {
  id: "synthetic-connectivity", name: "Microsoft Graph Connectivity", description: "Valida o acesso delegado e a conectividade com Microsoft Graph.",
  enabled: true, provider: "azure", domain: "secops", visibility: "public", requiredAuthProvider: "microsoft-graph", requiredPermissions: ["User.Read"], adminConsentRequired: false,
  moduleId: "synthetic-diagnostics", moduleName: "Conectividade e diagnóstico", moduleDescription: "Validação técnica das conexões e do acesso delegado. Não representa uma avaliação de segurança.", moduleOrder: 4, assessmentOrder: 1,
};
const catalog = [tool, ...[2, 3].map((index) => ({ ...tool, id: `synthetic-tool-${index}`, name: `Ferramenta sintética ${index}`, assessmentOrder: index }))];
const executionId = "EXE-550e8400-e29b-41d4-a716-446655440000";

async function setup(page: Page, consentRequired = false) {
  let creations = 0;
  let downloads = 0;
  await page.route("**/src/main.tsx", async (route) => {
    const response = await route.fetch({ url: "http://127.0.0.1:5174/browser-tests/harness.tsx" });
    await route.fulfill({ response });
  });
  await page.route("http://127.0.0.1:3000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { "access-control-allow-origin": "http://127.0.0.1:5174", "access-control-allow-headers": "authorization,content-type", "cache-control": "no-store" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.pathname === "/api/v1/assessments") return route.fulfill({ json: catalog, headers });
    if (request.method() === "POST") {
      creations++;
      if (consentRequired && creations === 1) return route.fulfill({ status: 403, json: { error: { code: "GRAPH_CONSENT_REQUIRED", message: "Safe consent failure" } }, headers });
      return route.fulfill({ status: 202, json: { executionId, status: "STARTING" }, headers });
    }
    if (url.pathname.endsWith("/artifact")) {
      downloads++;
      return route.fulfill({ body: Buffer.from("PK\u0003\u0004synthetic-zip"), contentType: "application/zip", headers });
    }
    return route.fulfill({ json: {
      executionId, assessmentId: tool.id, status: "COMPLETED", stage: "COMPLETED", progress: 100,
      createdAt: "2026-09-07T12:00:00Z", startedAt: "2026-09-07T12:00:00Z", completedAt: "2026-09-07T12:00:01Z",
      publicMetrics: { graphReachable: true, requestsCompleted: 1 }, artifactAvailable: downloads === 0, expiresAt: null,
    }, headers });
  });
  return { creations: () => creations, downloads: () => downloads };
}

for (const [width, columns] of [[1440, 3], [1100, 2], [390, 1]] as const) {
  test(`catalog grid and approved drawer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const requests = await setup(page);
    await page.goto("/azure/secops");
    await expect(page.locator(".assessment-card")).toHaveCount(3);
    const tracks = await page.locator(".assessment-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" "));
    expect(tracks).toHaveLength(columns);
    const first = await page.locator(".assessment-card").first().boundingBox();
    expect(first?.width).toBeLessThan(width === 390 ? width : width / 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (process.env.CLOUDOPS_UI_SCREENSHOTS === "true") await page.screenshot({ path: `test-results/ui/azure-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Executar Microsoft Graph Connectivity" }).click();
    const panel = page.getByRole("complementary", { name: "Microsoft Graph Connectivity" });
    await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(panel.getByRole("listitem")).toHaveCount(5);
    const bounds = await panel.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(width);
    expect(Math.round((bounds?.x ?? 0) + (bounds?.width ?? 0))).toBe(width);
    if (process.env.CLOUDOPS_UI_SCREENSHOTS === "true") await page.screenshot({ path: `test-results/ui/drawer-${width}.png` });
    await panel.getByRole("button", { name: "Baixar relatório" }).click();
    await expect(panel.getByText("Download iniciado.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Baixar relatório" })).toHaveCount(0);
    expect(requests.creations()).toBe(1);
    expect(requests.downloads()).toBe(1);
  });
}

for (const [provider, color] of [["azure", "#75c8ff"], ["aws", "#ffc46b"], ["gcp", "#8cb8ff"]]) {
  test(`${provider} uses its own accent and exactly five areas`, async ({ page }) => {
    await setup(page);
    await page.goto(`/${provider}/secops`);
    const layout = page.locator(".provider-layout");
    await expect(layout).toBeVisible();
    expect((await layout.evaluate((element) => getComputedStyle(element).getPropertyValue("--provider-primary"))).trim()).toBe(color);
    await expect(page.locator(".domain-navigation a")).toHaveCount(5);
    if (provider !== "azure") await expect(page.locator(".assessment-card")).toHaveCount(0);
  });
}

test("native consent dialog traps focus, restores focus and retries only on explicit consent", async ({ page }) => {
  const requests = await setup(page, true);
  await page.goto("/azure/secops");
  const execute = page.getByRole("button", { name: "Executar Microsoft Graph Connectivity" });
  await execute.click();
  const dialog = page.getByRole("dialog", { name: "Permissões adicionais necessárias" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".execution-panel")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fechar", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Conceder permissões" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(execute).toBeFocused();
  expect(requests.creations()).toBe(1);
});

test("consent recovery transitions into the existing execution drawer", async ({ page }) => {
  const requests = await setup(page, true);
  await page.goto("/azure/secops");
  await page.getByRole("button", { name: "Executar Microsoft Graph Connectivity" }).click();
  await page.getByRole("button", { name: "Conceder permissões" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".execution-panel").getByText("Relatório concluído")).toBeVisible();
  expect(requests.creations()).toBe(2);
});

for (const provider of ["azure", "aws", "gcp"]) {
  for (const [width, height, fontSize] of [[1280, 560, 16], [1440, 700, 20], [390, 667, 16]]) {
    test(`${provider} sidebar preserves the workspace card at ${width}x${height} with ${fontSize}px text`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await setup(page);
      await page.goto(`/${provider}/secops`);
      const sidebar = page.getByRole("complementary", { name: "Navegação CloudOps" });
      await expect(sidebar).toBeVisible();
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      // Layout-only pressure models a larger account block for any future cloud
      // integration. It does not introduce simulated AWS/GCP authentication.
      await sidebar.locator(".sidebar-account").evaluate((element) => { (element as HTMLElement).style.minHeight = "250px"; });
      const card = sidebar.locator(".sidebar-provider-card");
      const dimensions = await card.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const content = [...element.children].map((child) => child.getBoundingClientRect());
        return {
          height: bounds.height,
          requiredHeight: Math.max(...content.map((child) => child.height)) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2,
          contentContained: content.every((child) => child.top >= bounds.top && child.bottom <= bounds.bottom),
        };
      });
      expect(dimensions.height).toBeGreaterThanOrEqual(dimensions.requiredHeight - 1);
      expect(dimensions.contentContained).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (process.env.CLOUDOPS_UI_SCREENSHOTS === "true") await page.screenshot({ path: `test-results/ui/sidebar-${provider}-${width}.png` });
      const changeCloud = sidebar.getByRole("link", { name: "← Trocar cloud", exact: true });
      await changeCloud.focus();
      await expect(changeCloud).toBeInViewport();
      await expect(sidebar.locator(".domain-navigation a")).toHaveCount(5);
    });
  }
}
