import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BASE_SOURCE,proposePatch,validatePatch,runVerification,sha256} from '../lib/runner.mjs';
import {generateAIPatch,readAdapterConfig} from '../lib/adapters.mjs';

const canonical = proposePatch(BASE_SOURCE).after;
const config = readAdapterConfig({PATCH_PROVIDER:'openai-compatible',EXECUTION_PROVIDER:'local',ALLOW_EXTERNAL_CALLS:'1',LLM_BASE_URL:'https://model.example/v1',LLM_MODEL:'formatting-test-double',LLM_API_KEY:'fake-secret'});
const transport = source => async () => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({source})}}]}));
const formatted = "// schema only\r\nexport function createSchema ( z ) {\r\n\treturn /* harmless */ z.partialRecord(\r\n\t\tz.enum(['email', 'push']), z.boolean()\r\n\t)\r\n}";
const positives = [
 ['canonical',canonical], ['tabs',canonical.replace('  return','\treturn')],
 ['CRLF',canonical.replaceAll('\n','\r\n')], ['single quotes',canonical.replaceAll('"',"'")],
 ['no semicolon',canonical.replace(';','')], ['no EOF newline',canonical.slice(0,-1)],
 ['compact',"export function createSchema(z){return z.partialRecord(z.enum(['email','push']),z.boolean())}"],
 ['comments and multiline calls',formatted],
 ['token separating comments',canonical.replace('export function','export/* harmless */function').replace('return z','return/* harmless */z')],
 ['trailing harmless comment',canonical+'// harmless explanation'],
 ['trailing enum key comma',canonical.replace('"push"]','"push",]')],
 ['trailing enum argument comma',canonical.replace(']),','],),')],
 ['trailing partialRecord argument comma',canonical.replace('z.boolean())','z.boolean(),)')],
 ['all harmless trailing commas',canonical.replace('"push"]','"push",]').replace(']),','],),').replace('z.boolean())','z.boolean(),)')],
 ['Unicode line separators outside return',canonical.replaceAll('\n','\u2028')]
];
for (const [label,source] of positives) test(`allow fixed schema: ${label}`,()=>assert.equal(validatePatch(BASE_SOURCE,source),true));
const negatives = [
 ['unchanged',BASE_SOURCE], ['extra statement',canonical+'process.exit(0);'],
 ['extra import',"import 'evil';\n"+canonical], ['extra export',canonical+'export const other = 1;'],
 ['directive statement',canonical.replace('return','"use strict"; return')],
 ['computed access',canonical.replace('z.partialRecord','z["partialRecord"]')],
 ['wrong value type',canonical.replace('z.boolean()','z.any()')],
 ['wrong method',canonical.replace('partialRecord','record')], ['wrong enum',canonical.replace('push','sms')],
 ['enum order',canonical.replace('"email", "push"','"push", "email"')],
 ['extra argument',canonical.replace('z.boolean()','z.boolean(), process.exit()')],
 ['assignment',canonical.replace('return z','return globalThis.x = z')],
 ['identifier merging',canonical.replace('export function','exportfunction')],
 ['return merging',canonical.replace('return z','returnz')],
 ['string merging',canonical.replace('"email", "push"','"email" "push"')],
 ['string escapes',canonical.replace('email','em\\u0061il')],
 ['unterminated comment',canonical+'/* unfinished'], ['unterminated string',canonical.replace('"push"','"push')],
 ['source URL directive',canonical+'//# sourceURL=evil.mjs'],
 ['annotation directive',canonical.replace('return','/* @__PURE__ */ return')],
 ['hashbang','#!/usr/bin/env node\n'+canonical],
 ['oversized source',' '.repeat(8193)+canonical],
 ['nonstring',null], ['boxed string',new String(canonical)]
];
for (const separator of ['\n','\r','\r\n','\u2028','\u2029','/*\n*/','/*\r*/','/*\u2028*/','/*\u2029*/','// hidden\n']) negatives.push([`return ASI ${JSON.stringify(separator)}`,canonical.replace('return z',`return${separator}z`)]);
for (const [label,source] of negatives) test(`reject unsupported schema: ${label}`,()=>assert.throws(()=>validatePatch(BASE_SOURCE,source),{code:'PATCH_REJECTED'}));
test('before remains byte-exact even for accepted candidate formatting',()=>assert.throws(()=>validatePatch(BASE_SOURCE.replaceAll('\n','\r\n'),canonical),{code:'PATCH_REJECTED'}));

// Apply this source-only full-replacement unified hunk without invoking Git.
function applySourceDiff(before,diff) {
 const lines=diff.split('\n');
 assert.equal(lines.shift(),'--- a/fixtures/zod-settings/schema.mjs');
 assert.equal(lines.shift(),'+++ b/fixtures/zod-settings/schema.mjs');
 const hunk=lines.shift().match(/^@@ -1,(\d+) \+1,(\d+) @@$/); assert.ok(hunk);
 const old=[],next=[]; let previous;
 for(const line of lines) {
  if(line==='')continue;
  if(line==='\\ No newline at end of file') { assert.ok(previous);previous[previous.length-1]=previous.at(-1).slice(0,-1);continue; }
  assert.ok(['-','+',' '].includes(line[0]));
  if(line[0]===' ') {old.push(line.slice(1)+'\n');next.push(line.slice(1)+'\n');previous=null;continue;}
  previous=line[0]==='-'?old:next; previous.push(line.slice(1)+'\n');
 }
 assert.equal(old.length,Number(hunk[1]));assert.equal(next.length,Number(hunk[2]));
 assert.equal(old.join(''),before);return next.join('');
}
for(const [label,source] of positives) test(`AI preserves candidate and downloadable diff bytes: ${label}`,async()=>{
 const patch=await generateAIPatch({before:BASE_SOURCE,observations:[],config,fetchImpl:transport(source)});
 assert.equal(patch.after,source);
 assert.equal(applySourceDiff(BASE_SOURCE,patch.diff),source);
});
test('formatted injected candidate executes real Zod workers with honest provenance',async()=>{
 const result=await runVerification({adapterConfig:config,fetchImpl:transport(formatted)});
 assert.equal(result.verdict,'TEST_DOUBLE_VERIFIED'); assert.equal(result.sponsorUsed,false);
 assert.equal(result.after,formatted); assert.equal(applySourceDiff(BASE_SOURCE,result.patch),formatted);
 assert.equal(result.evidence.sources.patched,sha256(formatted));
 assert.equal(result.evidence.commands.length,3);
 assert.ok(result.evidence.commands.every(c=>c.exitCode===0 && c.pid));
 assert.equal(result.evidence.commands[2].sourceSha256,sha256(formatted));
 assert.equal(result.phases[0].matched,result.phases[0].total);
 assert.equal(result.phases[2].matched,result.phases[2].total);
 assert.ok(result.regressions.length>0);
 assert.equal(result.evidence.transportTestDouble,true);
 assert.equal(result.evidence.invariants.immutableFilesUnchanged,true);
});
test('runtime snapshots include the fixed source grammar and diff helper',async()=>{
 const result=await runVerification();
 assert.ok(result.evidence.immutableBefore['lib/patch-source.mjs']);
 assert.equal(result.evidence.immutableBefore['lib/patch-source.mjs'],result.evidence.immutableAfter['lib/patch-source.mjs']);
});
for(const [label,source] of positives) test(`system patch reproduces actual UTF-8 candidate bytes: ${label}`,async()=>{
 const dir=await mkdtemp(fileURLToPath(new URL('./patch-application-',import.meta.url)));
 try {
  await mkdir(dir+'/fixtures/zod-settings',{recursive:true});
  const target=dir+'/fixtures/zod-settings/schema.mjs';
  await writeFile(target,BASE_SOURCE);
  const candidate=await generateAIPatch({before:BASE_SOURCE,observations:[],config,fetchImpl:transport(source)});
  const applied=spawnSync('/usr/bin/patch',['-p1'],{cwd:dir,input:candidate.diff,encoding:'utf8',timeout:5000});
  assert.equal(applied.status,0,applied.stdout+applied.stderr);
  assert.deepEqual(await readFile(target),Buffer.from(source,'utf8'));
 } finally {await rm(dir,{recursive:true,force:true});}
});
