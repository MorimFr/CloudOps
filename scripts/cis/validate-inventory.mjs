import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityStatusSchema, ContentHashSchema, ControlResultStatusSchema,
  EvaluationConfidenceSchema, SdkIdSchema, SdkTimestampSchema, SdkVersionSchema,
} from '@cloudops/contracts';

// Development validation only. Never load this artifact from the assessment runtime.
// Reuse SDK primitives, but NOT ControlPackSchema: this is deliberately not a pack.
const directory = new URL('../../docs/cis/', import.meta.url);
const stem = 'cis-m365-7.0.0-identity-';
export const AREAS = [
  'Authentication', 'Conditional Access', 'Privileged Access', 'User Lifecycle',
  'Guest & External Identity', 'Applications & Consent', 'Identity Governance',
  'Device Identity', 'Hybrid Identity', 'Licensing / Capability Context',
];
const PROFILES = ['E3 Level 1', 'E3 Level 2', 'E5 Level 1', 'E5 Level 2'];
const CLASSES = ['FULL', 'HYBRID', 'MANUAL', 'BLOCKED'];
const PATTERNS = ['SINGLE', 'PAGED_COLLECTION', 'BATCHABLE_N_PLUS_ONE', 'NON_BATCHABLE_N_PLUS_ONE'];
const RISKS = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
const metadataKeys = ['cisId', 'title', 'cisAssessmentStatus', 'profiles', 'sourceSection',
  'sourcePageStart', 'sourcePageEnd', 'auditPageStart', 'remediationPageStart', 'cisExamplePermissions'];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const uniqueSorted = (values) => [...new Set(values)].sort();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const list = (value, label) => { invariant(Array.isArray(value), `${label}: expected array`); return value; };
const unique = (values, label) => invariant(new Set(values).size === values.length, `${label}: duplicate value`);
const ref = (value, lookup, label) => invariant(lookup.has(value), `${label}: unknown reference ${value}`);
const schema = (value, contract, label) => invariant(contract.safeParse(value).success, `${label}: invalid value`);

function officialDoc(value, label) {
  invariant(nonempty(value), `${label}: Microsoft documentation required`);
  const url = new URL(value);
  invariant(url.protocol === 'https:' && url.hostname === 'learn.microsoft.com'
    && !url.username && !url.password, `${label}: official Microsoft HTTPS source required`);
}

function dataOnly(value, label, depth = 0) {
  invariant(depth <= 20, `${label}: excessive nesting`);
  if (typeof value === 'string') {
    invariant(!/(?:https?:\/\/|[A-Za-z]:\\|\$\(|Invoke-Expression|\beval\s*\(|\bfunction\s*\()/i.test(value),
      `${label}: executable content or arbitrary URL is forbidden`);
  } else if (Array.isArray(value)) {
    value.forEach((item) => dataOnly(item, label, depth + 1));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      invariant(!['__proto__', 'prototype', 'constructor', 'script', 'scriptPath', 'command', 'code', 'expression', 'url', 'endpoint'].includes(key),
        `${label}: executable/unsafe field ${key}`);
      dataOnly(item, label, depth + 1);
    }
  } else invariant(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)), `${label}: invalid data type`);
}

export function readBlueprint() {
  const read = (suffix) => JSON.parse(readFileSync(new URL(`${stem}${suffix}.json`, directory), 'utf8'));
  return { inventory: read('inventory'), sourceIndex: read('source-index'), provenance: read('provenance') };
}

export function validateBlueprint({ inventory: inv, sourceIndex: source, provenance }) {
  invariant(isObject(inv) && isObject(source) && isObject(provenance), 'Three JSON objects are required');
  invariant(inv.schemaVersion === 'cloudops.cis-identity-mapping.v1', 'Unknown mapping schema');
  invariant(inv.artifactKind === 'ENGINEERING_BLUEPRINT_NOT_RUNTIME_PACK', 'Not a runtime pack');
  invariant(source.schemaVersion === 'cloudops.cis-source-index.v1', 'Unknown source schema');
  schema(inv.benchmark?.sourceSha256, ContentHashSchema, 'Source hash');
  invariant(inv.benchmark.version === '7.0.0' && inv.benchmark.date === '2026-05-20', 'Wrong benchmark version/date');
  invariant(inv.benchmark.name === source.benchmarkName && inv.benchmark.version === source.benchmarkVersion
    && inv.benchmark.date === source.benchmarkDate && inv.benchmark.sourceSha256 === source.sourceSha256
    && inv.benchmark.sourceFile === source.sourceFile && inv.benchmark.pdfPages === source.pdfPages, 'Source identity mismatch');
  invariant(/^[A-Za-z0-9_.()-]+\.pdf$/.test(inv.benchmark.sourceFile), 'Source must be a safe basename');
  invariant(provenance.benchmarkName === inv.benchmark.name && provenance.benchmarkVersion === inv.benchmark.version
    && provenance.benchmarkDate === inv.benchmark.date && provenance.sourceSha256 === inv.benchmark.sourceSha256
    && provenance.sourceFile === inv.benchmark.sourceFile && provenance.mappingSchemaVersion === inv.schemaVersion, 'Provenance mismatch');
  schema(provenance.analysisTimestamp, SdkTimestampSchema, 'Analysis timestamp');
  invariant(!/[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\//i.test(JSON.stringify(provenance)), 'Private absolute path in provenance');
  invariant(provenance.runtimePackCreated === false && provenance.sourcePdfCopied === false && inv.futurePack?.created === false, 'Blueprint must remain inert');
  schema(inv.futurePack.controlPackVersion, SdkVersionSchema, 'Planned pack version');

  const sourceRows = list(source.controls, 'Source controls');
  const controls = list(inv.controls, 'Controls');
  const endpoints = list(inv.endpoints, 'Endpoints');
  const collectors = list(inv.collectors, 'Collectors');
  const questions = list(inv.openQuestions, 'Questions');
  for (const [records, key, label] of [[sourceRows, 'cisId', 'Source IDs'], [controls, 'cisId', 'CIS IDs'],
    [endpoints, 'endpointId', 'Endpoint IDs'], [collectors, 'collectorId', 'Collector IDs'], [questions, 'questionId', 'Question IDs']]) {
    invariant(records.every(isObject), `${label}: records must be objects`);
    unique(records.map((row) => row[key]), label);
  }
  invariant(sourceRows.length === 160 && controls.length === sourceRows.length, 'Complete benchmark screening required');
  const sourceMap = new Map(sourceRows.map((row) => [row.cisId, row]));
  const controlMap = new Map(controls.map((row) => [row.cisId, row]));
  const endpointMap = new Map(endpoints.map((row) => [row.endpointId, row]));
  const collectorMap = new Map(collectors.map((row) => [row.collectorId, row]));
  const questionMap = new Map(questions.map((row) => [row.questionId, row]));
  const capabilities = list(inv.capabilityCatalog, 'Capability catalog');
  unique(capabilities.map((c) => c.capabilityId), 'Capability IDs');
  const capabilityMap = new Map(capabilities.map((c) => [c.capabilityId, c]));
  capabilities.forEach((c) => {
    schema(c.capabilityId, SdkIdSchema, 'Capability ID');
    invariant(nonempty(c.licensingOrCapabilityNotes), 'Capability licensing notes required');
    invariant(same(c.plannedStates, CapabilityStatusSchema.options), 'Capability states mismatch');
    if (c.currentMicrosoftDoc !== null) officialDoc(c.currentMicrosoftDoc, c.capabilityId);
  });
  questions.forEach((q) => list(q.currentMicrosoftDocs, q.questionId).forEach((url) => officialDoc(url, q.questionId)));
  const permissionMap = new Map(list(inv.permissionPlan?.permissionCost, 'Permission cost').map((row) => [row.permission, row]));
  invariant(permissionMap.size === inv.permissionPlan.permissionCost.length, 'Duplicate permission cost');

  for (const e of endpoints) {
    schema(e.endpointId, SdkIdSchema, 'Endpoint ID');
    invariant(['v1.0', 'beta', 'none'].includes(e.apiVersion), `${e.endpointId}: apiVersion required`);
    invariant(['yes', 'no'].includes(e.pagination), `${e.endpointId}: pagination required`);
    invariant(['supported', 'not-supported', 'unknown'].includes(e.batching), `${e.endpointId}: batching required`);
    invariant(['SMALL', 'MEDIUM', 'LARGE', 'PER_USER'].includes(e.expectedScale), `${e.endpointId}: scale required`);
    invariant(PATTERNS.includes(e.queryPattern), `${e.endpointId}: queryPattern required`);
    invariant(nonempty(e.permissionJustification), `${e.endpointId}: permission justification required`);
    if (e.apiVersion === 'none') {
      invariant(e.method === 'NONE' && e.relativePath === null && e.minimumDelegatedPermission === null, 'Manual endpoint cannot execute');
    } else {
      invariant(e.method === 'GET', `${e.endpointId}: read-only GET required`);
      invariant(typeof e.relativePath === 'string' && /^\/[A-Za-z][A-Za-z0-9/{}]*$/.test(e.relativePath), `${e.endpointId}: invalid relativePath`);
      officialDoc(e.currentMicrosoftDoc, e.endpointId);
      const documentVersion = e.apiVersion === 'v1.0' ? '1.0' : 'beta';
      invariant(new URL(e.currentMicrosoftDoc).searchParams.get('view') === `graph-rest-${documentVersion}`, `${e.endpointId}: document API version mismatch`);
      ref(e.minimumDelegatedPermission, permissionMap, e.endpointId);
      invariant(e.adminConsentRequired === true, `${e.endpointId}: admin consent planning required`);
    }
  }
  for (const c of collectors) {
    schema(c.collectorId, SdkIdSchema, 'Collector ID');
    invariant(PATTERNS.includes(c.queryPattern) && RISKS.includes(c.scaleRisk), `${c.collectorId}: invalid scale/pattern`);
    list(c.endpointIds, c.collectorId).forEach((id) => ref(id, endpointMap, c.collectorId));
    invariant(c.endpointIds.length > 0, `${c.collectorId}: endpoint required`);
    invariant(same(c.requiredPermissions, uniqueSorted(c.endpointIds.map((id) => endpointMap.get(id).minimumDelegatedPermission))), `${c.collectorId}: permission union mismatch`);
    invariant(list(c.normalizedFactsProduced, c.collectorId).length > 0, `${c.collectorId}: facts required`);
    list(c.capabilityDependencies, c.collectorId).forEach((id) => ref(id, capabilityMap, c.collectorId));
    invariant(same(list(c.performanceBudget, c.collectorId).map((b) => b.tenantUsers), [1000, 10000, 50000, 200000]), `${c.collectorId}: scale budgets missing`);
    c.performanceBudget.forEach((b) => invariant(nonempty(b.approximateRequests) && nonempty(b.paginationCount)
      && nonempty(b.collectionSize) && RISKS.includes(b.throttlingExposure), `${c.collectorId}: incomplete budget`));
    const actual = controls.filter((row) => row.inclusionDecision === 'INCLUDE' && row.collectorRequirements.includes(c.collectorId)).map((row) => row.cisId);
    invariant(same(c.controlsSupported, actual), `${c.collectorId}: supported controls mismatch`);
  }
  const included = controls.filter((c) => c.inclusionDecision === 'INCLUDE');
  for (const c of controls) {
    ref(c.cisId, sourceMap, 'CIS ID');
    invariant(['AUTOMATED', 'MANUAL'].includes(c.cisAssessmentStatus), `${c.cisId}: invalid CIS status`);
    invariant(list(c.profiles, c.cisId).length > 0 && c.profiles.every((p) => PROFILES.includes(p)), `${c.cisId}: unknown profile`);
    unique(c.profiles, `${c.cisId} profiles`);
    invariant(Number.isInteger(c.sourcePageStart) && Number.isInteger(c.sourcePageEnd)
      && c.sourcePageStart > 0 && c.sourcePageEnd >= c.sourcePageStart && c.sourcePageEnd < source.pdfPages, `${c.cisId}: invalid source pages`);
    for (const key of ['auditPageStart', 'remediationPageStart']) invariant(c[key] === null
      || (Number.isInteger(c[key]) && c[key] >= c.sourcePageStart && c[key] <= c.sourcePageEnd), `${c.cisId}: invalid ${key}`);
    for (const key of metadataKeys) invariant(same(c[key], sourceMap.get(c.cisId)[key]), `${c.cisId}: immutable source metadata ${key}`);
    const primary = c.cisId.startsWith('5.');
    invariant(c.crossCuttingCandidate === !primary, `${c.cisId}: scope classification mismatch`);
    invariant(['INCLUDE', 'EXCLUDE', 'REVIEW'].includes(c.inclusionDecision) && nonempty(c.inclusionReason), `${c.cisId}: inclusion decision/reason required`);
    invariant(!primary || c.inclusionDecision === 'INCLUDE', `${c.cisId}: primary scope cannot disappear`);
    if (c.inclusionDecision !== 'INCLUDE') {
      invariant(c.wave === null, `${c.cisId}: excluded/review control cannot enter a wave`);
      continue;
    }
    invariant(AREAS.includes(c.primaryArea) && list(c.secondaryAreas, c.cisId).every((a) => AREAS.includes(a)), `${c.cisId}: unknown area`);
    invariant(CLASSES.includes(c.cloudOpsAutomationClass), `${c.cisId}: automation class required`);
    list(c.capabilities, c.cisId).forEach((id) => ref(id, capabilityMap, c.cisId));
    schema(c.automationConfidence, EvaluationConfidenceSchema, `${c.cisId} confidence`);
    schema(c.implementationComplexity, EvaluationConfidenceSchema, `${c.cisId} complexity`);
    invariant(isObject(c.expectedState) && Object.keys(c.expectedState).length > 0, `${c.cisId}: expected state required`);
    dataOnly(c.expectedState, `${c.cisId} expected state`);
    invariant(isObject(c.evaluatorSpec), `${c.cisId}: evaluator spec required`);
    invariant(c.evaluatorSpec.kind === 'NON_EXECUTABLE_DESIGN', `${c.cisId}: spec must remain non-executable`);
    dataOnly(c.evaluatorSpec, `${c.cisId} evaluator spec`);
    schema(c.evaluatorSpec.plannedEvaluatorId, SdkIdSchema, `${c.cisId} evaluator ID`);
    schema(c.evaluatorSpec.plannedEvaluatorVersion, SdkVersionSchema, `${c.cisId} evaluator version`);
    for (const status of ControlResultStatusSchema.options) invariant(nonempty(c.evaluatorSpec[status]), `${c.cisId}: missing ${status} condition`);
    for (const field of ['inputs', 'requiredNormalizedFacts', 'potentialFalsePositives', 'potentialFalseNegatives']) {
      invariant(list(c.evaluatorSpec[field], `${c.cisId} ${field}`).length > 0, `${c.cisId}: ${field} required`);
    }
    invariant(c.evaluatorSpec.automaticVerdictAllowed === (c.cloudOpsAutomationClass === 'FULL'), `${c.cisId}: automation boundary mismatch`);
    invariant(isObject(c.evidenceSpec) && list(c.evidenceSpec.facts, c.cisId).length > 0, `${c.cisId}: evidence spec required`);
    invariant(['AGGREGATE_ONLY', 'OBJECT_REFERENCE_REQUIRED', 'MANUAL_EVIDENCE'].includes(c.evidenceSpec.detail), `${c.cisId}: invalid evidence detail`);
    invariant(typeof c.evidenceSpec.canEvaluateUsingAggregateFacts === 'boolean', `${c.cisId}: aggregate decision required`);
    if (c.evidenceSpec.detail === 'AGGREGATE_ONLY') invariant(c.evidenceSpec.minimumObjectFields.length === 0, `${c.cisId}: unnecessary object fields`);
    if (c.evidenceSpec.detail === 'OBJECT_REFERENCE_REQUIRED') invariant(c.evidenceSpec.minimumObjectFields.length > 0, `${c.cisId}: minimal reference required`);
    list(c.collectorRequirements, c.cisId).forEach((id) => ref(id, collectorMap, c.cisId));
    list(c.graph, c.cisId).forEach((id) => ref(id, endpointMap, c.cisId));
    const expectedGraph = uniqueSorted(c.collectorRequirements.flatMap((id) => collectorMap.get(id).endpointIds));
    invariant(same(c.graph, expectedGraph.length ? expectedGraph : ['manual-evidence']), `${c.cisId}: Graph/collector mismatch`);
    invariant(c.previewDependency === c.graph.some((id) => endpointMap.get(id).apiVersion === 'beta'), `${c.cisId}: preview flag mismatch`);
    invariant(same(c.queryPatterns, uniqueSorted(c.collectorRequirements.map((id) => collectorMap.get(id).queryPattern))), `${c.cisId}: query patterns mismatch`);
    invariant(RISKS.includes(c.scaleRisk), `${c.cisId}: invalid scale risk`);
    const required = uniqueSorted(c.collectorRequirements.flatMap((id) => collectorMap.get(id).requiredPermissions));
    invariant(same(list(c.permissions, c.cisId).map((p) => p.permission), required), `${c.cisId}: control permission union mismatch`);
    c.permissions.forEach((p) => invariant(nonempty(p.justification) && p.adminConsentRequired === true, `${c.cisId}: permission justification/consent required`));
    list(c.sourceDiscrepancy, c.cisId).forEach((id) => ref(id, questionMap, c.cisId));
    list(c.relatedControls, c.cisId).forEach((id) => ref(id, controlMap, c.cisId));
    invariant([1, 2, 3].includes(c.wave), `${c.cisId}: wave required`);
    if (c.wave === 1) invariant(c.cisAssessmentStatus === 'AUTOMATED' && c.cloudOpsAutomationClass === 'FULL'
      && c.automationConfidence === 'HIGH' && !c.previewDependency && c.collectorRequirements.length > 0
      && c.graph.every((id) => endpointMap.get(id).apiVersion === 'v1.0') && c.scaleRisk === 'LOW', `${c.cisId}: Wave 1 admission failed`);
  }
  invariant(included.filter((c) => c.cisId.startsWith('5.')).length === 63, 'All 63 Section 5 controls required');
  invariant(inv.scope.primaryRecommendationCount === 63 && inv.scope.sourceRecommendationCount === sourceRows.length
    && inv.scope.includedCount === included.length, 'Scope count mismatch');
  for (const section of inv.scope.subsections) invariant(section.controlCount === sourceRows.filter((c) => c.sourceSection === section.section).length, 'Subsection count mismatch');
  const assigned = [];
  invariant(same(list(inv.waves, 'Waves').map((w) => w.wave), [1, 2, 3]), 'Three ordered waves required');
  for (const wave of inv.waves) {
    wave.controlIds.forEach((id) => { ref(id, controlMap, 'Wave control'); invariant(controlMap.get(id).wave === wave.wave, 'Wave/control mismatch'); });
    invariant(same(wave.collectorIds, uniqueSorted(included.filter((c) => c.wave === wave.wave).flatMap((c) => c.collectorRequirements))), 'Wave collector union mismatch');
    assigned.push(...wave.controlIds);
  }
  unique(assigned, 'Wave controls');
  invariant(same(uniqueSorted(assigned), uniqueSorted(included.map((c) => c.cisId))), 'Waves must cover all included controls exactly once');
  invariant(inv.waves[0].controlIds.length >= 8 && inv.waves[0].controlIds.length <= 12, 'Wave 1 requires 8–12 controls');
  for (const key of ['currentCloudOpsConfigured', 'identityCurrentlyConfigured', 'wave1MinimumPermissions', 'wave1AtomicMinimums',
    'fullIdentityAutomatedPermissions', 'fullAtomicMinimums', 'optionalPreviewPermissions', 'stableDeterministicOnlyPermissions']) {
    const values = list(inv.permissionPlan[key], key);
    invariant(same(values, uniqueSorted(values)), `${key}: must be deduplicated and sorted`);
    invariant(values.every((value) => !/ReadWrite|Write\./.test(value)), `${key}: write permission forbidden`);
  }
  const optimize = (values) => values.filter((p) => !inv.permissionPlan.subsumption.some((s) => values.includes(s.permission) && s.covers.includes(p))).sort();
  const atomic = (ids) => uniqueSorted(ids.flatMap((id) => collectorMap.get(id).requiredPermissions));
  invariant(same(inv.permissionPlan.wave1AtomicMinimums, atomic(inv.waves[0].collectorIds)), 'Wave 1 atomic permissions mismatch');
  invariant(same(inv.permissionPlan.wave1MinimumPermissions, optimize(inv.permissionPlan.wave1AtomicMinimums)), 'Wave 1 optimized permissions mismatch');
  const stable = collectors.filter((c) => c.controlsSupported.some((id) => ['FULL', 'HYBRID'].includes(controlMap.get(id).cloudOpsAutomationClass))
    && c.endpointIds.every((id) => endpointMap.get(id).apiVersion === 'v1.0')).map((c) => c.collectorId);
  invariant(same(inv.permissionPlan.fullAtomicMinimums, atomic(stable)), 'Full atomic permissions mismatch');
  invariant(same(inv.permissionPlan.fullIdentityAutomatedPermissions, optimize(inv.permissionPlan.fullAtomicMinimums)), 'Full optimized permissions mismatch');
  const deterministic = uniqueSorted(included.filter((c) => c.cloudOpsAutomationClass === 'FULL').flatMap((c) => c.collectorRequirements));
  invariant(same(inv.permissionPlan.stableDeterministicOnlyPermissions, optimize(atomic(deterministic))), 'Deterministic permissions mismatch');
  const preview = collectors.filter((c) => c.endpointIds.some((id) => endpointMap.get(id).apiVersion === 'beta')).map((c) => c.collectorId);
  invariant(same(inv.permissionPlan.optionalPreviewPermissions, uniqueSorted([...atomic(preview), 'Member.Read.Hidden'])), 'Optional/preview permissions mismatch');
  for (const p of permissionMap.values()) {
    invariant(nonempty(p.justification) && p.adminConsent === true, 'Permission justification/consent required');
    invariant(['REQUIRED', 'OPTIONAL', 'PREVIEW_ONLY'].includes(p.necessity), 'Permission necessity invalid');
    p.controlsDependingOnIt.forEach((id) => ref(id, controlMap, 'Permission control'));
    p.collectorDependingOnIt.forEach((id) => ref(id, collectorMap, 'Permission collector'));
    const actualCollectors = collectors.filter((c) => c.requiredPermissions.includes(p.permission)
      || (p.permission === 'Member.Read.Hidden' && c.collectorId === 'role-group-members')).map((c) => c.collectorId);
    const actualControls = included.filter((c) => c.permissions.some((item) => item.permission === p.permission)
      || (p.permission === 'Member.Read.Hidden' && c.collectorRequirements.includes('role-group-members'))).map((c) => c.cisId);
    invariant(same(p.collectorDependingOnIt, actualCollectors) && same(p.controlsDependingOnIt, actualControls), 'Permission cost coverage mismatch');
    officialDoc(p.currentMicrosoftDoc, p.permission);
  }
  invariant(same(inv.resultPolicy.statuses, ControlResultStatusSchema.options), 'SDK result statuses differ');
  invariant(same(inv.resultPolicy.capabilityStatuses, CapabilityStatusSchema.options), 'SDK capability statuses differ');
  invariant(inv.resultPolicy.partialIsNeverFail === true && inv.resultPolicy.permissionMissingResult === 'UNKNOWN'
    && inv.resultPolicy.licenseUnavailableIsNeverAutomaticFail === true && inv.resultPolicy.acceptedExceptionChangesFrameworkStatus === false, 'Unsafe result policy');
  invariant(same(inv.profileSelection.plannedSelection, {
    'E3 Level 1': ['E3 Level 1'], 'E3 Level 2': ['E3 Level 1', 'E3 Level 2'],
    'E5 Level 1': ['E3 Level 1', 'E5 Level 1'], 'E5 Level 2': PROFILES,
  }), 'Profile inheritance must follow source page 17');
  return { recommendations: controls.length, primary: 63, included: included.length,
    collectors: collectors.length, wave1: inv.waves[0].controlIds.length };
}

export function verifyOriginalSource(path, expectedHash) {
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  invariant(hash === expectedHash, 'Original PDF SHA-256 mismatch');
  return { sourceFile: basename(path instanceof URL ? fileURLToPath(path) : path), sourceSha256: hash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    invariant(args.length === 0 || (args.length === 2 && args[0] === '--source'), 'Usage: cis:validate [--source ORIGINAL.pdf]');
    const bundle = readBlueprint();
    const result = validateBlueprint(bundle);
    if (args.length) verifyOriginalSource(args[1], bundle.inventory.benchmark.sourceSha256);
    console.log(`CIS engineering blueprint valid: ${JSON.stringify(result)}. No Graph calls or runtime activation.`);
  } catch (error) {
    console.error(`CIS blueprint invalid: ${error.message}`);
    process.exitCode = 1;
  }
}
