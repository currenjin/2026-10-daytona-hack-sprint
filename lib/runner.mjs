import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawn } from 'node:child_process';
import {readAdapterConfig,assertReady,generateAIPatch,executeDaytonaPhase} from './adapters.mjs';
import { performance } from 'node:perf_hooks';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = Object.freeze({fixtureId:'zod-settings', baselineVersion:'3.25.76', targetVersion:'4.1.12', provider:'local-rule', environment:'local'});
const ORACLE_HASH = '2411601721e5b0f1829a77a1405efa625df899945d22980389b88a2ee5a25a00';
export const BASE_SOURCE = 'export function createSchema(z) {\n  return z.record(z.enum(["email", "push"]), z.boolean());\n}\n';
const PATCHED_SOURCE = BASE_SOURCE.replace('z.record(', 'z.partialRecord(');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function failure(code, message, evidence) { return Object.assign(new Error(message), {code, ...(evidence ? {evidence} : {})}); }
export function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export async function loadOracle(options = {}) {
  try {
    const oracleText = options.oracleText ?? await readFile(resolve(ROOT,'contracts/demo-oracle-v1.json'),'utf8');
    const contractText = options.contractText ?? await readFile(resolve(ROOT,'contracts/demo-contract-v1.json'),'utf8');
    const oracle = JSON.parse(oracleText), contract = JSON.parse(contractText);
    const hash = sha256(canonicalJSON(oracle));
    if (contract.oracle?.sha256_canonical_json !== ORACLE_HASH || hash !== ORACLE_HASH) throw new Error('Canonical oracle or contract anchor changed');
    return {oracle, contract, hash};
  } catch (error) { throw failure('ORACLE_INVALID', `Oracle authentication failed: ${error.message}`); }
}
export function validatePatch(before, after) {
  if (before !== BASE_SOURCE || after !== PATCHED_SOURCE) throw failure('PATCH_REJECTED','Only the fixed enum record → partialRecord schema transformation is permitted');
  return true;
}
export function proposePatch(before) {
  validatePatch(before, PATCHED_SOURCE);
  return {before, after:PATCHED_SOURCE, provider:'local-rule',
    reason:'Zod 4 enum-key record requires every enum key; partialRecord restores subset-key semantics while retaining boolean values and rejecting unknown keys.',
    reference:'https://zod.dev/v4/changelog#improves-enum-support',
    diff:'--- a/fixtures/zod-settings/schema.mjs\n+++ b/fixtures/zod-settings/schema.mjs\n@@ -1,3 +1,3 @@\n export function createSchema(z) {\n-  return z.record(z.enum(["email", "push"]), z.boolean());\n+  return z.partialRecord(z.enum(["email", "push"]), z.boolean());\n }\n'};
}
export function evaluateRows(cases, actual) {
  if (!Array.isArray(actual) || actual.length !== cases.length) throw failure('INFRA_ERROR','Runner returned an incomplete case set');
  return cases.map((c, i) => {
    const a = actual[i];
    if (a?.id !== c.id || typeof a.accept !== 'boolean' || !Array.isArray(a.issues) || !Object.hasOwn(a,'data') || (!a.accept && a.data !== null)) throw failure('INFRA_ERROR','Runner returned invalid case evidence');
    const expected = c.expected.baseline;
    const matched = a.accept === expected.accept && isDeepStrictEqual(a.data,expected.data);
    return {id:c.id, input:c.input, control:c.control, expected, actual:a, matched, matches:matched};
  });
}
const cleanEnv = () => ({PATH:process.env.PATH ?? '/usr/bin:/bin', HOME:process.env.HOME ?? ROOT, LANG:'en_US.UTF-8', NODE_ENV:'production'});
export function execute(command, args, input, timeoutMs = 10000) {
  return new Promise((resolvePromise, reject) => {
    const started = performance.now(); let stdout = '', stderr = '', size = 0, killed = null, spawnError = null;
    const child = spawn(command,args,{cwd:ROOT,env:cleanEnv(),stdio:['pipe','pipe','pipe'],shell:false});
    const timer = setTimeout(() => {killed = 'timeout'; child.kill('SIGKILL');},timeoutMs);
    const collect = stream => data => {size += data.length; if (size > 1024*1024) {killed = 'output limit'; child.kill('SIGKILL');return;} if(stream === 'out') stdout += data.toString(); else stderr += data.toString();};
    child.stdout.on('data',collect('out')); child.stderr.on('data',collect('err'));
    child.on('error',error => {spawnError = error;});
    child.stdin.on('error',() => {});
    child.on('close',(exitCode,signal) => {
      clearTimeout(timer);
      const evidence = {command:[command,...args], pid:child.pid ?? null, exitCode, signal, durationMs:performance.now()-started, stdout, stderr, ...(spawnError ? {error:spawnError.message} : {}), ...(killed ? {terminated:killed} : {})};
      if (spawnError || killed || exitCode !== 0) reject(failure('INFRA_ERROR', `Execution failed: ${spawnError?.message ?? killed ?? `exit ${exitCode}`}`, {commands:[evidence]}));
      else resolvePromise(evidence);
    });
    child.stdin.end(input ?? '');
  });
}
async function snapshot() {
  const paths = ['contracts/demo-oracle-v1.json','contracts/demo-contract-v1.json','fixtures/zod-settings/schema.mjs','lib/runner.mjs','lib/worker.mjs','lib/adapters.mjs','package.json','package-lock.json'];
  // Test files are read-only during a run; include every existing test.
  const {readdir} = await import('node:fs/promises');
  for (const name of (await readdir(resolve(ROOT,'test'))).sort()) if(name.endsWith('.test.mjs')) paths.push(`test/${name}`);
  return Object.fromEntries(await Promise.all(paths.map(async path => [path,sha256(await readFile(resolve(ROOT,path)))])));
}
export async function runVerification({onEvent = () => {}, nodePath = process.execPath,adapterConfig=readAdapterConfig({}),fetchImpl,daytonaClient} = {}) {
  const startedAt = new Date().toISOString();
  const evidence = {startedAt, provider:adapterConfig.provider, environment:adapterConfig.environment, sponsorUsed:false, commands:[],sandboxes:[],phases:[],transportTestDouble:!!fetchImpl||!!daytonaClient};
  try {
    assertReady(adapterConfig);
    const {oracle, hash} = await loadOracle();
    evidence.oracle = {path:'contracts/demo-oracle-v1.json',hash,canonicalization:'sorted-key compact UTF-8 JSON without newline'};
    const before = await readFile(resolve(ROOT,'fixtures/zod-settings/schema.mjs'),'utf8');
    let proposal = proposePatch(before);
    evidence.immutableBefore = await snapshot();
    const npmCommand = await execute('npm',['--version']);
    evidence.runtime = {node:process.version,npm:npmCommand.stdout.trim(),platform:process.platform,arch:process.arch,npmCommand};
    evidence.packages = {};
    for (const [phase,alias] of [['baseline','zod3'],['upgraded','zod4'],['patched','zod4']]) {
      const info = JSON.parse(await readFile(resolve(ROOT,`node_modules/${alias}/package.json`),'utf8'));
      if (info.version !== oracle.versions[phase]) throw failure('INFRA_ERROR',`Installed ${alias} version does not match the fixed contract`);
      evidence.packages[phase] = info.version;
    }
    evidence.lockfile = {path:'package-lock.json',sha256:evidence.immutableBefore['package-lock.json']};
    evidence.sources = {baseline:sha256(before),upgraded:sha256(before),patched:sha256(proposal.after),evaluator:sha256(await readFile(fileURLToPath(import.meta.url))),worker:sha256(await readFile(resolve(ROOT,'lib/worker.mjs')))};
    evidence.patch = {provider:proposal.provider,reason:proposal.reason,reference:proposal.reference,scope:'fixtures/zod-settings/schema.mjs',kind:'deterministic official-doc-based transformation; not LLM generation'};
    const phases = evidence.phases;
    for (const name of ['baseline','upgraded','patched']) {
      if(name === 'patched') {
        onEvent({stage:'patch',message:'Generating a source-only patch candidate'});
        if(adapterConfig.provider==='openai-compatible')proposal=await generateAIPatch({before,observations:phases[1].rows.map(r=>({id:r.id,input:r.input,actual:r.actual})),config:adapterConfig,fetchImpl});
        validatePatch(before,proposal.after);
        evidence.patch={...evidence.patch,provider:proposal.provider,kind:proposal.provider==='local-rule'?'deterministic official-doc-based transformation; not LLM generation':'model-generated allowlisted candidate',...proposal.evidence};
        evidence.sources.patched=sha256(proposal.after);
      }
      onEvent({stage:name,message:`Starting ${name} in ${adapterConfig.environment} with Zod ${evidence.packages[name]}`});
      const source = name === 'patched' ? proposal.after : before;
      let observed;
      if(adapterConfig.environment==='daytona'){
        const remote=await executeDaytonaPhase({config:adapterConfig,phase:name,source,cases:oracle.cases,daytonaClient});
        evidence.sandboxes.push(remote.record);observed=remote.observed;
      }else{
        const command = await execute(nodePath,[resolve(ROOT,'lib/worker.mjs'),name],JSON.stringify({source,cases:oracle.cases.map(c => ({id:c.id,input:c.input}))}));
        evidence.commands.push({...command,phase:name,sourceSha256:sha256(source)});
        try {observed = JSON.parse(command.stdout);} catch {throw failure('INFRA_ERROR','Runner emitted invalid JSON');}
        if(observed.node!==process.version)throw failure('INFRA_ERROR','Worker runtime does not match');
      }
      if (observed.version !== oracle.versions[name]) throw failure('INFRA_ERROR','Worker package version does not match');
      const rows = evaluateRows(oracle.cases,observed.rows);
      phases.push({name,matched:rows.filter(row => row.matched).length,total:rows.length,rows});
      onEvent({stage:name,message:`Completed ${name}: ${phases.at(-1).matched}/${rows.length} match the application requirement`});
    }
    evidence.immutableAfter = await snapshot();
    evidence.invariants = {immutableFilesUnchanged:isDeepStrictEqual(evidence.immutableBefore,evidence.immutableAfter),sourceOnlyPatch:validatePatch(before,proposal.after),sameInputs:true,noDowngrade:true};
    if (!evidence.invariants.immutableFilesUnchanged) throw failure('INVARIANT_VIOLATION','Immutable files changed during execution');
    const regressions = phases[1].rows.filter(row => !row.matched && phases[0].rows.find(base => base.id === row.id).matched).map(row => row.id);
    const migrationMatches = phases.every(phase => phase.rows.every(row => {
      const expected = oracle.cases.find(c => c.id === row.id).expected[phase.name];
      return row.actual.accept === expected.accept && isDeepStrictEqual(row.actual.data,expected.data);
    }));
    if (!migrationMatches || phases[0].matched !== oracle.cases.length || phases[2].matched !== oracle.cases.length || !regressions.length) throw failure('PRODUCT_FAIL','Executed behavior did not satisfy the frozen scenario');
    const remote=adapterConfig.provider==='openai-compatible'||adapterConfig.environment==='daytona';
    const verdict=evidence.transportTestDouble?'TEST_DOUBLE_VERIFIED':remote?'PROVIDER_VERIFIED':'LOCAL_VERIFIED';
    evidence.sponsorUsed=adapterConfig.environment==='daytona'&&!evidence.transportTestDouble;
    evidence.completedAt = new Date().toISOString();
    evidence.regressions = regressions; evidence.verdict = verdict;
    onEvent({stage:'completed',message:`${verdict}: frozen fixture contract checked; no general compatibility claim`});
    return {verdict,phases,regressions,patch:proposal.diff,before,after:proposal.after,provider:adapterConfig.provider,environment:adapterConfig.environment,sponsorUsed:evidence.sponsorUsed,evidence};
  } catch (error) {
    if(error.evidence?.sandboxes)evidence.sandboxes.push(...error.evidence.sandboxes);
    if(error.evidence?.commands) evidence.commands.push(...error.evidence.commands);
    evidence.failedAt = new Date().toISOString(); evidence.error = {code:error.code ?? 'INFRA_ERROR',message:error.message};
    throw failure(error.code ?? 'INFRA_ERROR',error.message,evidence);
  }
}
