import assert from 'node:assert/strict';

const apiBaseUrl = process.env.CLOUDOPS_API_URL ?? 'http://localhost:3000';
const deadlineMs = 35_000;

async function readJson(response) {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/i);
  return response.json();
}

const healthResponse = await fetch(`${apiBaseUrl}/api/v1/health`);
assert.equal(healthResponse.status, 200);
const health = await readJson(healthResponse);
assert.equal(health.status, 'ok');
assert.equal(health.runtime?.powershell, true);

const catalogResponse = await fetch(`${apiBaseUrl}/api/v1/assessments`);
assert.equal(catalogResponse.status, 200);
const catalog = await readJson(catalogResponse);
assert.ok(catalog.some((assessment) => assessment.id === 'hello-world'));
assert.ok(catalog.every((assessment) => !('script' in assessment)));

const createResponse = await fetch(
  `${apiBaseUrl}/api/v1/assessments/hello-world/executions`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ options: {} }),
  },
);
assert.equal(createResponse.status, 202);
const created = await readJson(createResponse);
assert.equal(created.status, 'STARTING');
assert.match(created.executionId, /^EXE-[0-9a-f-]{36}$/i);

let execution;
const observedStatuses = new Set([created.status]);
const observedStages = new Set();
const startedAt = Date.now();
do {
  await new Promise((resolve) => setTimeout(resolve, 75));
  const statusResponse = await fetch(
    `${apiBaseUrl}/api/v1/executions/${created.executionId}`,
  );
  assert.equal(statusResponse.status, 200);
  execution = await readJson(statusResponse);
  observedStatuses.add(execution.status);
  if (execution.stage) {
    observedStages.add(execution.stage);
  }
  assert.ok(!('artifact' in execution));
  if (execution.status === 'FAILED') {
    throw new Error('The containerized assessment reported FAILED.');
  }
} while (execution.status !== 'COMPLETED' && Date.now() - startedAt < deadlineMs);

assert.equal(execution.status, 'COMPLETED');
assert.equal(execution.artifactAvailable, true);
assert.deepEqual(
  [...observedStatuses],
  ['STARTING', 'RUNNING', 'COMPLETED'],
  'The real execution must expose the lifecycle in order.',
);
for (const stage of ['INITIALIZING', 'PROCESSING', 'GENERATING_REPORT']) {
  assert.ok(observedStages.has(stage), `The E2E did not observe stage ${stage}.`);
}

const artifactResponse = await fetch(
  `${apiBaseUrl}/api/v1/executions/${created.executionId}/artifact`,
);
assert.equal(artifactResponse.status, 200);
assert.match(artifactResponse.headers.get('content-type') ?? '', /application\/zip/i);
assert.match(
  artifactResponse.headers.get('content-disposition') ?? '',
  /attachment/i,
);
assert.match(artifactResponse.headers.get('cache-control') ?? '', /no-store/i);

const artifact = Buffer.from(await artifactResponse.arrayBuffer());
try {
  assert.equal(artifact[0], 0x50);
  assert.equal(artifact[1], 0x4b);
  assert.ok(artifact.includes(Buffer.from('report.html')));
  assert.ok(artifact.includes(Buffer.from('summary.json')));
} finally {
  artifact.fill(0);
}

const consumedStatusResponse = await fetch(
  `${apiBaseUrl}/api/v1/executions/${created.executionId}`,
);
if (consumedStatusResponse.status === 200) {
  const consumedExecution = await readJson(consumedStatusResponse);
  assert.equal(consumedExecution.artifactAvailable, false);
} else {
  assert.equal(consumedStatusResponse.status, 404);
}

const secondDownloadResponse = await fetch(
  `${apiBaseUrl}/api/v1/executions/${created.executionId}/artifact`,
);
assert.ok([404, 409, 410].includes(secondDownloadResponse.status));

console.log(
  `PASS: real API -> PowerShell -> in-memory ZIP -> download-once (${created.executionId}).`,
);
