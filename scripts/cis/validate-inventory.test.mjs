import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { readBlueprint, validateBlueprint, verifyOriginalSource } from './validate-inventory.mjs';

const original = readBlueprint();
const control = (bundle, id = '5.1.2.2') => bundle.inventory.controls.find((row) => row.cisId === id);
const rejects = (name, mutate, expected) => test(name, () => {
  const bundle = structuredClone(original);
  mutate(bundle);
  assert.throws(() => validateBlueprint(bundle), expected);
});

test('complete local blueprint validates offline without the private PDF', () => {
  assert.deepEqual(validateBlueprint(original), { recommendations: 160, primary: 63, included: 71, collectors: 24, wave1: 10 });
});
test('validation is pure and deterministic', () => {
  const before = JSON.stringify(original);
  assert.deepEqual(validateBlueprint(original), validateBlueprint(original));
  assert.equal(JSON.stringify(original), before);
});
rejects('duplicate CIS IDs', (b) => { b.inventory.controls[1].cisId = b.inventory.controls[0].cisId; }, /CIS IDs: duplicate/);
rejects('invalid source pages', (b) => { control(b).sourcePageStart = 0; }, /source pages/);
rejects('page outside PDF', (b) => { control(b).sourcePageEnd = 900; }, /source pages/);
rejects('audit page outside recommendation', (b) => { control(b).auditPageStart = 1; }, /auditPageStart/);
rejects('immutable CIS title', (b) => { control(b).title = 'Invented control'; }, /immutable source metadata title/);
rejects('unknown CIS status', (b) => { control(b).cisAssessmentStatus = 'HYBRID'; }, /invalid CIS status/);
rejects('changed valid CIS status', (b) => { control(b).cisAssessmentStatus = 'MANUAL'; }, /immutable source metadata cisAssessmentStatus/);
rejects('unknown profile', (b) => { control(b).profiles = ['E3 Level 3']; }, /unknown profile/);
rejects('inferred profile instead of literal source', (b) => { control(b).profiles = ['E3 Level 1']; }, /immutable source metadata profiles/);
rejects('unknown area', (b) => { control(b).primaryArea = 'FinOps'; }, /unknown area/);
rejects('unknown capability', (b) => { control(b).capabilities = ['invented-capability']; }, /unknown reference/);
rejects('included control without automation class', (b) => { delete control(b).cloudOpsAutomationClass; }, /automation class/);
rejects('FULL without evaluator spec', (b) => { delete control(b).evaluatorSpec; }, /evaluator spec/);
rejects('FULL without evidence spec', (b) => { delete control(b).evidenceSpec; }, /evidence spec/);
rejects('missing UNKNOWN semantics', (b) => { delete control(b).evaluatorSpec.UNKNOWN; }, /missing UNKNOWN/);
rejects('permission without justification', (b) => { delete control(b).permissions[0].justification; }, /permission justification/);
rejects('Graph endpoint without apiVersion', (b) => { delete b.inventory.endpoints[0].apiVersion; }, /apiVersion/);
rejects('Graph write operation', (b) => { b.inventory.endpoints[0].method = 'PATCH'; }, /read-only GET/);
rejects('arbitrary Graph host instead of relative path', (b) => { b.inventory.endpoints[0].relativePath = 'https://evil.invalid/users'; }, /relativePath/);
rejects('non-official API authority', (b) => { b.inventory.endpoints[0].currentMicrosoftDoc = 'https://example.org/api'; }, /official Microsoft/);
rejects('API version disagrees with documentation', (b) => { b.inventory.endpoints[0].apiVersion = 'beta'; }, /document API version/);
rejects('missing 200k performance scenario', (b) => { b.inventory.collectors[0].performanceBudget.pop(); }, /scale budgets/);
rejects('unknown collector', (b) => { control(b).collectorRequirements.push('not-approved'); }, /unknown reference/);
rejects('unknown wave control', (b) => { b.inventory.waves[0].controlIds.push('5.99.99'); }, /unknown reference/);
rejects('preview flag cannot be hidden', (b) => { control(b, '5.2.3.10').previewDependency = false; }, /preview flag/);
rejects('manual control cannot acquire automated verdict', (b) => { control(b, '5.2.4.1').evaluatorSpec.automaticVerdictAllowed = true; }, /automation boundary/);
rejects('source hash differs', (b) => { b.provenance.sourceSha256 = '0'.repeat(64); }, /Provenance mismatch/);
rejects('absolute private source filename', (b) => {
  b.inventory.benchmark.sourceFile = 'C:\\Users\\private\\source.pdf';
  b.sourceIndex.sourceFile = b.inventory.benchmark.sourceFile;
}, /safe basename/);
rejects('private path in provenance', (b) => { b.provenance.localPath = 'C:\\Users\\private\\source.pdf'; }, /Private absolute path/);
rejects('invalid analysis timestamp', (b) => { b.provenance.analysisTimestamp = 'yesterday'; }, /Analysis timestamp/);
rejects('pack remains uncreated', (b) => { b.inventory.futurePack.created = true; }, /remain inert/);
rejects('executable expected state is rejected', (b) => { control(b).expectedState.script = 'Invoke-Expression'; }, /executable/);
rejects('arbitrary URL in expected state is rejected', (b) => { control(b).expectedState.expected = 'https://graph.microsoft.com/me'; }, /arbitrary URL/);
rejects('prototype field is rejected', (b) => { control(b).expectedState = JSON.parse('{"__proto__":{"x":true}}'); }, /unsafe field/);
rejects('partial collection must never FAIL', (b) => { b.inventory.resultPolicy.partialIsNeverFail = false; }, /Unsafe result policy/);
rejects('accepted exception never changes CIS result', (b) => { b.inventory.resultPolicy.acceptedExceptionChangesFrameworkStatus = true; }, /Unsafe result policy/);
rejects('permission sets must be sorted', (b) => { b.inventory.permissionPlan.wave1MinimumPermissions.reverse(); }, /deduplicated and sorted/);
rejects('permission set must match collectors', (b) => { b.inventory.permissionPlan.wave1MinimumPermissions = []; }, /optimized permissions mismatch/);
rejects('permission cost must cover consumers', (b) => { b.inventory.permissionPlan.permissionCost[0].controlsDependingOnIt = []; }, /Permission cost coverage/);
rejects('preview scopes cannot be silently omitted', (b) => { b.inventory.permissionPlan.optionalPreviewPermissions = []; }, /Optional\/preview permissions mismatch/);
rejects('profile inheritance is explicit', (b) => { b.inventory.profileSelection.plannedSelection['E5 Level 2'] = ['E5 Level 2']; }, /Profile inheritance/);
rejects('aggregate evidence cannot acquire object identifiers', (b) => { control(b).evidenceSpec.minimumObjectFields = ['userPrincipalName']; }, /unnecessary object fields/);

test('source hash verifier rejects different bytes without modifying the file', () => {
  const path = new URL('./validate-inventory.test.mjs', import.meta.url);
  const before = readFileSync(path);
  assert.throws(() => verifyOriginalSource(path, original.inventory.benchmark.sourceSha256), /SHA-256 mismatch/);
  assert.deepEqual(readFileSync(path), before);
});
test('hash verification accepts exact bytes and returns only the basename', () => {
  const path = new URL('./validate-inventory.test.mjs', import.meta.url);
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.deepEqual(verifyOriginalSource(path, hash), { sourceFile: 'validate-inventory.test.mjs', sourceSha256: hash });
});
test('human matrix and collector document cover every included record', () => {
  const directory = new URL('../../docs/cis/', import.meta.url);
  const matrix = readFileSync(new URL('cis-m365-7.0.0-identity-implementation-matrix.md', directory), 'utf8');
  const collectors = readFileSync(new URL('cis-m365-7.0.0-identity-collectors.md', directory), 'utf8');
  for (const row of original.inventory.controls.filter((c) => c.inclusionDecision === 'INCLUDE')) {
    assert.ok(matrix.includes(`| ${row.cisId} | ${row.title.replaceAll('|', '\\|')} |`), row.cisId);
  }
  for (const row of original.inventory.collectors) assert.ok(collectors.includes(`## ${row.collectorId}\n`), row.collectorId);
});
test('blueprint documentation links resolve locally without network calls', () => {
  const directory = new URL('../../docs/cis/', import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.md'))) {
    const markdown = readFileSync(new URL(file, directory), 'utf8');
    for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https:/.test(match[1])) continue;
      assert.ok(existsSync(new URL(match[1], directory)), `${file}: ${match[1]}`);
    }
  }
});
test('all manual Section 5 recommendations remain in inventory', () => {
  const sourceIds = original.sourceIndex.controls.filter((c) => c.cisId.startsWith('5.') && c.cisAssessmentStatus === 'MANUAL').map((c) => c.cisId);
  assert.equal(sourceIds.length, 11);
  for (const id of sourceIds) assert.equal(control(original, id).inclusionDecision, 'INCLUDE');
});
test('Wave 1 uses four families and no per-user queries', () => {
  const wave = original.inventory.waves[0];
  assert.equal(wave.collectorIds.length, 4);
  for (const id of wave.controlIds) assert.ok(control(original, id).queryPatterns.every((pattern) => !pattern.includes('N_PLUS_ONE')));
});
