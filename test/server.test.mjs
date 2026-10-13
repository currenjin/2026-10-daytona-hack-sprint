import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import {symlink, rm} from 'node:fs/promises';
import {startServer} from '../server.mjs';
import {runVerification} from '../lib/runner.mjs';
const staticDir = fileURLToPath(new URL('./static/',import.meta.url));
async function withServer(fn,options={}) {
  const server = await startServer({port:0,staticDir,...options});
  const base = `http://127.0.0.1:${server.address().port}`;
  try {await fn(base,server);} finally {server.closeAllConnections(); server.close();await once(server,'close');}
}
const post = (base,body={fixtureId:'zod-settings'},headers={}) => fetch(base+'/api/runs',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
async function waitRun(base,id) {
  for(let i=0;i<200;i++) {const response=await fetch(`${base}/api/runs/${id}`);const run=await response.json();if(run.status !== 'running')return run;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.fail('Run did not finish within four seconds');
}
function rawGet(base,path,headers={}) {return new Promise((resolve,reject)=>{const req=httpRequest(base+path,{headers},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));});req.on('error',reject);req.end();});}
test('health is live JSON',async()=>withServer(async base=>{
  const response=await fetch(base+'/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
}));
test('config declares exact bounded fixture and local provider',async()=>withServer(async base=>{
  const response=await fetch(base+'/api/config');assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{fixtureId:'zod-settings',baselineVersion:'3.25.76',targetVersion:'4.1.12',provider:'local-rule',environment:'local',readiness:{ready:true,issues:[],externalCallsAllowed:false}});
}));
test('real async run, ordered progress, evidence and patch downloads',async()=>withServer(async base=>{
  const created=await post(base);assert.equal(created.status,202);const {id}=await created.json();assert.match(id,/^[a-f0-9-]{36}$/);
  const initial=await (await fetch(`${base}/api/runs/${id}`)).json();assert.equal(initial.id,id);assert.equal(initial.status,'running');assert.equal(initial.result,null);
  const run=await waitRun(base,id);assert.equal(run.status,'completed');assert.equal(run.stage,'completed');assert.equal(run.error,null);assert.equal(run.result.verdict,'LOCAL_VERIFIED');
  assert.deepEqual([...new Set(run.events.map(event=>event.stage))],['baseline','upgraded','patch','patched','completed']);
  const patch=await fetch(`${base}/api/runs/${id}/patch`);assert.equal(patch.status,200);assert.match(patch.headers.get('content-type'),/^text\/plain/);assert.equal(await patch.text(),run.result.patch);
  const evidence=await fetch(`${base}/api/runs/${id}/evidence`);assert.equal(evidence.status,200);assert.match(evidence.headers.get('content-disposition'),/attachment/);assert.deepEqual(await evidence.json(),run.result.evidence);
}));
test('unknown fixture cannot start a run',async()=>withServer(async base=>{
  const response=await post(base,{fixtureId:'https://arbitrary.test/repo'});assert.equal(response.status,400);assert.equal((await response.json()).error.code,'UNKNOWN_FIXTURE');
}));
test('unknown fields cannot inject source or command',async()=>withServer(async base=>{
  const response=await post(base,{fixtureId:'zod-settings',command:'rm -rf /'});assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_REQUEST');
}));
test('oversize JSON body is refused',async()=>withServer(async base=>{
  const response=await post(base,{fixtureId:'x'.repeat(5000)});assert.equal(response.status,413);
}));
test('non-JSON and malformed JSON are refused',async()=>withServer(async base=>{
  const nonJson=await fetch(base+'/api/runs',{method:'POST',headers:{'content-type':'text/plain'},body:'zod-settings'});assert.equal(nonJson.status,415);
  const malformed=await fetch(base+'/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);
}));
test('wrong Origin and cross-site browser requests are refused',async()=>withServer(async base=>{
  assert.equal((await post(base,undefined,{origin:'https://evil.test'})).status,403);
  assert.equal((await post(base,undefined,{'sec-fetch-site':'cross-site'})).status,403);
  const accepted=await post(base,undefined,{origin:base});assert.equal(accepted.status,202);await waitRun(base,(await accepted.json()).id);
}));
test('invalid run id and nonexistent UUID are distinguished',async()=>withServer(async base=>{
  assert.equal((await fetch(base+'/api/runs/not-an-id')).status,400);
  assert.equal((await fetch(base+'/api/runs/00000000-0000-4000-8000-000000000000')).status,404);
}));
test('static HTML gets self-origin CSP without leaking contract or encoded traversal',async()=>withServer(async base=>{
  const index=await fetch(base+'/');assert.equal(index.status,200);assert.match(await index.text(),/Static routing test fixture/);
  const csp=index.headers.get('content-security-policy');assert.match(csp,/script-src 'self'/);assert.match(csp,/style-src 'self'/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);
  for(const path of ['/../contracts/demo-oracle-v1.json','/%2e%2e/contracts/demo-oracle-v1.json','/%2e%2e%2fcontracts/demo-oracle-v1.json','/%5c..%5ccontracts/demo-oracle-v1.json','/.env','/contracts/demo-oracle-v1.json']) {
    const response=await rawGet(base,path);assert.ok([400,403,404].includes(response.status),`${path} returned ${response.status}`);assert.doesNotMatch(response.body,/APP-REQ-1/);
  }
}));
test('static symlink outside root is not served',async()=>{
  const link=new URL('./static/escape',import.meta.url);await symlink(fileURLToPath(new URL('../contracts/demo-oracle-v1.json',import.meta.url)),link);
  try {await withServer(async base=>{const response=await fetch(base+'/escape');assert.equal(response.status,403);});} finally {await rm(link);}
});
test('spoofed Host is refused',async()=>withServer(async base=>{
  const response=await rawGet(base,'/health',{Host:'evil.test'});assert.equal(response.status,421);
}));
test('failed execution publishes honest failure evidence and no patch success',async()=>withServer(async base=>{
  const created=await post(base);assert.equal(created.status,202);const {id}=await created.json();
  const run=await waitRun(base,id);assert.equal(run.status,'failed');assert.equal(run.result,null);assert.equal(run.error.code,'INFRA_ERROR');
  const evidence=await fetch(`${base}/api/runs/${id}/evidence`);assert.equal(evidence.status,200);const data=await evidence.json();assert.equal(data.error.code,'INFRA_ERROR');assert.notEqual(data.commands.at(-1).exitCode,0);assert.match(data.commands.at(-1).error,/ENOENT/);
  assert.equal((await fetch(`${base}/api/runs/${id}/patch`)).status,409);
},{runner:options=>runVerification({...options,nodePath:'/nonexistent/package-upgrade-node'})}));
test('active run capacity is bounded',async()=>withServer(async base=>{
  const first=await post(base);assert.equal(first.status,202);
  const second=await post(base);assert.equal(second.status,429);
  await waitRun(base,(await first.json()).id);
},{maxConcurrent:1}));
