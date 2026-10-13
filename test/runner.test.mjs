import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadOracle, canonicalJSON, proposePatch, validatePatch, runVerification, evaluateRows } from '../lib/runner.mjs';
const root = new URL('../', import.meta.url);
const oracleText = await readFile(new URL('contracts/demo-oracle-v1.json', root), 'utf8');
const contractText = await readFile(new URL('contracts/demo-contract-v1.json', root), 'utf8');
const source = 'export function createSchema(z) {\n  return z.record(z.enum(["email", "push"]), z.boolean());\n}\n';
const patched = source.replace('z.record(', 'z.partialRecord(');
const hash = value => createHash('sha256').update(value).digest('hex');

test('canonical oracle is authenticated before use', async () => {
  const loaded = await loadOracle();
  assert.equal(loaded?.hash, JSON.parse(contractText).oracle.sha256_canonical_json);
  assert.deepEqual(loaded?.oracle, JSON.parse(oracleText));
});
test('canonicalization ignores object ordering but preserves array order', () => {
  assert.equal(canonicalJSON({z: [3, 1], a: {y: false, x: '한'}}), '{"a":{"x":"한","y":false},"z":[3,1]}');
});
test('oracle tamper is rejected rather than evaluated', async () => {
  const tampered = JSON.parse(oracleText); tampered.cases[0].expected.baseline.accept = false;
  await assert.rejects(loadOracle({oracleText: JSON.stringify(tampered), contractText}), {code: 'ORACLE_INVALID'});
});
test('missing trusted anchor is rejected', async () => {
  const tampered = JSON.parse(contractText); tampered.oracle.sha256_canonical_json = '0'.repeat(64);
  await assert.rejects(loadOracle({oracleText, contractText: JSON.stringify(tampered)}), {code: 'ORACLE_INVALID'});
});
test('local provider emits only the permitted source transform', () => {
  const patch = proposePatch(source);
  assert.equal(patch?.after, patched);
  assert.equal(patch?.provider, 'local-rule');
  assert.match(patch?.diff ?? '', /\+  return z.partialRecord/);
  assert.equal(validatePatch(source, patched), true);
});
test('source injection is rejected at generation boundary', () => {
  assert.throws(() => proposePatch(source + 'process.exit(0);'), {code: 'PATCH_REJECTED'});
});
test('patch allowlist rejects downgrade, validation bypass, and unrelated edits', () => {
  for (const invalid of [source, patched + 'process.exit(0);', patched.replace('z.boolean()', 'z.any()'), patched.replace('push', 'sms')]) {
    assert.throws(() => validatePatch(source, invalid), {code: 'PATCH_REJECTED'});
  }
});
test('evaluator checks deep output and acceptance against application oracle', () => {
  const cases = [{id:'one', input:{email:false}, control:'control', expected:{baseline:{accept:true,data:{email:false}}}}];
  const rows = evaluateRows(cases, [{id:'one', accept:true, data:{email:true}, issues:[]}]);
  assert.equal(rows[0]?.matched, false);
  assert.equal(rows[0]?.matches, false, 'UI row match flag must reflect deep structural comparison');
  assert.throws(() => evaluateRows(cases, []), {code:'INFRA_ERROR'});
});
test('three real subprocess phases preserve controls and expose regressions', async () => {
  const result = await runVerification();
  assert.equal(result?.verdict, 'LOCAL_VERIFIED');
  const oracle = JSON.parse(oracleText);
  assert.deepEqual(result.phases.map(p => [p.name,p.matched,p.total]), ['baseline','upgraded','patched'].map(name => [name, oracle.expected_summary[`${name}_matched`], oracle.cases.length]));
  assert.deepEqual(result.regressions, oracle.expected_summary.regression_case_ids);
  for (const phase of result.phases) {
    assert.equal(phase.rows.length, oracle.cases.length);
    assert.equal(phase.rows.find(r => r.id === 'unknown-key').actual.accept, false);
    assert.equal(phase.rows.find(r => r.id === 'array').actual.accept, false);
    assert.ok(phase.rows.find(r => r.id === 'string-value').actual.issues.length);
  }
  assert.deepEqual(result.phases[2].rows.find(r => r.id === 'false-preserved').actual.data, {email:false});
  assert.equal(result.provider, 'local-rule'); assert.equal(result.sponsorUsed, false);
  assert.equal(result.environment, 'local');
  assert.equal(result.evidence.commands.length, 3);
  assert.equal(new Set(result.evidence.commands.map(c => c.pid)).size, 3);
  for (const command of result.evidence.commands) { assert.equal(command.exitCode, 0); assert.ok(command.durationMs >= 0); }
  assert.equal(result.evidence.oracle.hash, hash(canonicalJSON(oracle)));
  assert.match(result.evidence.lockfile.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.packages.baseline, '3.25.76');
  assert.equal(result.evidence.packages.upgraded, '4.1.12');
  assert.equal(result.evidence.packages.patched, '4.1.12');
  assert.equal(result.evidence.invariants.immutableFilesUnchanged, true);
});
test('execution failure is INFRA_ERROR not an assertion or verification success', async () => {
  await assert.rejects(runVerification({nodePath:'/nonexistent/package-upgrade-node'}), error => error.code === 'INFRA_ERROR' && Boolean(error.evidence?.commands?.length));
});
