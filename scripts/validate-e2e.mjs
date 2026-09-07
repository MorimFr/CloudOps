import assert from "node:assert/strict";

const apiBaseUrl = process.env.CLOUDOPS_API_URL ?? "http://localhost:3000";
let apiAccessToken = process.env.CLOUDOPS_E2E_API_TOKEN ?? "";
delete process.env.CLOUDOPS_E2E_API_TOKEN;

const deadlineMs = 35_000;

async function readJson(response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  return response.json();
}

async function authorizedFetch(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiAccessToken}`);
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
  } finally {
    headers.delete("Authorization");
  }
}

async function validate() {
  let tokenHasWhitespaceOrControl = false;
  for (let index = 0; index < apiAccessToken.length; index += 1) {
    const codeUnit = apiAccessToken.charCodeAt(index);
    if (codeUnit <= 0x20 || codeUnit === 0x7f) {
      tokenHasWhitespaceOrControl = true;
      break;
    }
  }
  assert.ok(
    apiAccessToken.length >= 32 && !tokenHasWhitespaceOrControl,
    "Set CLOUDOPS_E2E_API_TOKEN to a valid CloudOps API token before running the authenticated E2E.",
  );

  const healthResponse = await fetch(`${apiBaseUrl}/api/v1/health`, {
    cache: "no-store",
  });
  assert.equal(healthResponse.status, 200);
  const health = await readJson(healthResponse);
  assert.equal(health.status, "ok");
  assert.equal(health.runtime?.powershell, true);

  const anonymousCatalogResponse = await fetch(
    `${apiBaseUrl}/api/v1/assessments`,
    { cache: "no-store" },
  );
  assert.equal(anonymousCatalogResponse.status, 401);
  await readJson(anonymousCatalogResponse);

  const catalogResponse = await authorizedFetch("/api/v1/assessments");
  assert.equal(catalogResponse.status, 200);
  const catalog = await readJson(catalogResponse);
  const hello = catalog.find((assessment) => assessment.id === "hello-world");
  assert.ok(hello);
  assert.equal(hello.provider, "azure");
  assert.equal(hello.domain, "devops");
  assert.equal(hello.visibility, "development");
  assert.equal(hello.requiredAuthProvider, "none");
  assert.ok(catalog.every((assessment) => !("script" in assessment)));

  const createResponse = await authorizedFetch(
    "/api/v1/assessments/hello-world/executions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ options: {} }),
    },
  );
  assert.equal(createResponse.status, 202);
  const created = await readJson(createResponse);
  assert.equal(created.status, "STARTING");
  assert.match(created.executionId, /^EXE-[0-9a-f-]{36}$/i);

  let execution;
  const observedStatuses = new Set([created.status]);
  const observedStages = new Set();
  const startedAt = Date.now();
  do {
    await new Promise((resolve) => setTimeout(resolve, 75));
    const statusResponse = await authorizedFetch(
      `/api/v1/executions/${created.executionId}`,
    );
    assert.equal(statusResponse.status, 200);
    execution = await readJson(statusResponse);
    observedStatuses.add(execution.status);
    if (execution.stage) {
      observedStages.add(execution.stage);
    }
    assert.ok(!("artifact" in execution));
    assert.ok(!("summary" in execution));
    if (execution.status === "FAILED") {
      throw new Error("The containerized assessment reported FAILED.");
    }
  } while (
    execution.status !== "COMPLETED" &&
    Date.now() - startedAt < deadlineMs
  );

  assert.equal(execution.status, "COMPLETED");
  assert.equal(execution.artifactAvailable, true);
  assert.deepEqual(execution.publicMetrics, { findings: 0 });
  assert.deepEqual(
    [...observedStatuses],
    ["STARTING", "RUNNING", "COMPLETED"],
    "The real execution must expose the lifecycle in order.",
  );
  for (const stage of ["INITIALIZING", "PROCESSING", "GENERATING_REPORT"]) {
    assert.ok(
      observedStages.has(stage),
      `The E2E did not observe stage ${stage}.`,
    );
  }

  const artifactResponse = await authorizedFetch(
    `/api/v1/executions/${created.executionId}/artifact`,
    { headers: { accept: "application/zip" } },
  );
  assert.equal(artifactResponse.status, 200);
  assert.match(
    artifactResponse.headers.get("content-type") ?? "",
    /application\/zip/i,
  );
  assert.match(
    artifactResponse.headers.get("content-disposition") ?? "",
    /attachment/i,
  );
  assert.match(
    artifactResponse.headers.get("cache-control") ?? "",
    /no-store/i,
  );

  const artifact = Buffer.from(await artifactResponse.arrayBuffer());
  try {
    assert.equal(artifact[0], 0x50);
    assert.equal(artifact[1], 0x4b);
    assert.ok(artifact.includes(Buffer.from("report.html")));
    assert.ok(artifact.includes(Buffer.from("summary.json")));
  } finally {
    artifact.fill(0);
  }

  const consumedStatusResponse = await authorizedFetch(
    `/api/v1/executions/${created.executionId}`,
  );
  if (consumedStatusResponse.status === 200) {
    const consumedExecution = await readJson(consumedStatusResponse);
    assert.equal(consumedExecution.artifactAvailable, false);
  } else {
    assert.equal(consumedStatusResponse.status, 404);
  }

  const secondDownloadResponse = await authorizedFetch(
    `/api/v1/executions/${created.executionId}/artifact`,
  );
  assert.ok([404, 409, 410].includes(secondDownloadResponse.status));

  console.log(
    `PASS: authenticated API -> PowerShell -> in-memory ZIP -> download-once (${created.executionId}).`,
  );
}

try {
  await validate();
} finally {
  apiAccessToken = "";
}
