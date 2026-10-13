import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,symlink,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server.mjs';
import {runVerification,BASE_SOURCE,proposePatch,loadOracle,evaluateRows,ROOT} from '../lib/runner.mjs';
import {readAdapterConfig,buildRemoteBundle} from '../lib/adapters.mjs';
const E=await mkdtemp(join(tmpdir(),'upgrade-recovery-'));
test.after(async()=>{await rm(E,{recursive:true,force:true});});
async function serverTest(options,fn){const s=await startServer({port:0,...options});try{await fn(`http://127.0.0.1:${s.address().port}`);}finally{s.closeAllConnections();s.close();await once(s,'close');}}
const post=b=>fetch(b+'/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fixtureId:'zod-settings'})});
async function wait(b,id){for(let i=0;i<100;i++){const r=await(await fetch(b+'/api/runs/'+id)).json();if(r.status!=='running')return r;await new Promise(r=>setTimeout(r,20));}assert.fail('run timeout');}
test('default local verification makes zero outbound fetch calls',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network prohibited');};
 try{const r=await runVerification();assert.equal(r.verdict,'LOCAL_VERIFIED');assert.equal(calls,0);await writeFile(E+'/local-verification.json',JSON.stringify(r,null,2));}finally{globalThis.fetch=original;}
});
test('remote bundle worker really executes all phases locally without installing or oracle injection',async()=>{
 const bundle=await buildRemoteBundle(),dir=await mkdtemp(E+'/remote-bundle-');
 for(const [n,s]of Object.entries(bundle.files))await writeFile(resolve(dir,n),s);
 await symlink(ROOT+'/node_modules',resolve(dir,'node_modules'));
 const {oracle}=await loadOracle(),phases=[];
 for(const phase of ['baseline','upgraded','patched']){
  await writeFile(resolve(dir,'input.json'),JSON.stringify({phase,source:phase==='patched'?proposePatch(BASE_SOURCE).after:BASE_SOURCE,cases:oracle.cases.map(c=>({id:c.id,input:c.input}))}));
  const observed=JSON.parse(execFileSync(process.execPath,['remote-worker.mjs'],{cwd:dir,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,HOME:dir,NODE_ENV:'production'}}));
  assert.equal(observed.version,oracle.versions[phase]);assert.equal(observed.lockSha256,bundle.lockSha256);
  const rows=evaluateRows(oracle.cases,observed.rows);phases.push({phase,matched:rows.filter(r=>r.matches).length,observed});
 }
 assert.deepEqual(phases.map(p=>p.matched),[10,6,10]);await writeFile(E+'/remote-bundle-local-runtime.json',JSON.stringify({scope:'remote worker executed locally; not Daytona or sponsor verification',directory:dir,phases},null,2));
});
test('HTTP readiness blocks remote mode without opt-in before invoking runner and never exposes secrets',async()=>{
 let calls=0;const adapterConfig=readAdapterConfig({PATCH_PROVIDER:'openai-compatible',LLM_API_KEY:'fake-secret'});
 await serverTest({adapterConfig,runner:()=>{calls++;}},async b=>{
  const c=await(await fetch(b+'/api/config')).json();assert.equal(c.provider,'openai-compatible');assert.equal(c.readiness.ready,false);assert.ok(!JSON.stringify(c).includes('fake-secret'));
  assert.equal((await post(b)).status,503);assert.equal(calls,0);
 });
});
for(const verdict of ['LOCAL_VERIFIED','PROVIDER_VERIFIED','TEST_DOUBLE_VERIFIED','PRODUCT_FAIL'])test('HTTP patch gate fails closed for double evidence: '+verdict,async()=>{
 const result={verdict,patch:'must-not-download',evidence:{transportTestDouble:true}};
 await serverTest({runner:async()=>result},async b=>{const {id}=await(await post(b)).json();await wait(b,id);assert.equal((await fetch(b+'/api/runs/'+id+'/patch')).status,409);assert.equal((await fetch(b+'/api/runs/'+id+'/evidence')).status,200);});
});
