import test from 'node:test';
import assert from 'node:assert/strict';
import * as adapters from '../lib/adapters.mjs';
import {BASE_SOURCE,proposePatch,runVerification,loadOracle} from '../lib/runner.mjs';
const env={PATCH_PROVIDER:'openai-compatible',ALLOW_EXTERNAL_CALLS:'1',LLM_BASE_URL:'https://model.example/v1',LLM_MODEL:'fixed-test-model',LLM_API_KEY:'fake-llm-secret',EXECUTION_PROVIDER:'local'};
const cfg=()=>adapters.readAdapterConfig(env);
const response=(content,status=200)=>new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}}),{status});
const generate=(fetchImpl,config=cfg())=>adapters.generateAIPatch({before:BASE_SOURCE,observations:[{id:'empty',actual:{accept:false,issues:[]}}],config,fetchImpl});
test('operator config defaults to ready local and keeps secrets private',()=>{
 assert.equal(typeof adapters.readAdapterConfig,'function');
 const c=adapters.readAdapterConfig({});assert.equal(c.provider,'local-rule');assert.equal(c.environment,'local');assert.deepEqual(adapters.publicAdapterConfig(c).readiness,{ready:true,issues:[],externalCallsAllowed:false});
 assert.ok(!JSON.stringify(adapters.publicAdapterConfig(cfg())).includes('fake-llm-secret'));
});
test('missing opt-in or configuration prevents any transport construction',async()=>{
 for(const bad of [{...env,ALLOW_EXTERNAL_CALLS:''},{...env,LLM_MODEL:''},{...env,LLM_BASE_URL:''},{...env,PATCH_PROVIDER:'unknown'},{...env,EXECUTION_PROVIDER:'unknown'}]){
  const c=adapters.readAdapterConfig(bad);assert.equal(adapters.publicAdapterConfig(c).readiness.ready,false);let calls=0;await assert.rejects(generate(()=>{calls++;},c),{code:'CONFIG_ERROR'});assert.equal(calls,0);
 }
});
for(const url of ['http://model.example','https://user:pass@model.example','https://model.example?a=b','https://model.example/#foo'])test(`unsafe operator endpoint rejected ${url}`,()=>assert.equal(adapters.readAdapterConfig({...env,LLM_BASE_URL:url}).readiness.ready,false));
test('AI uses actual bounded response and sends only synthetic observations',async()=>{
 let request;const patch=await generate(async(url,options)=>{request={url,options};return response(JSON.stringify({source:proposePatch(BASE_SOURCE).after}));});
 assert.equal(patch.after,proposePatch(BASE_SOURCE).after);assert.equal(patch.provider,'openai-compatible');assert.equal(patch.evidence.transportTestDouble,true);assert.deepEqual(patch.evidence.usage,{prompt_tokens:123,completion_tokens:45,total_tokens:168});assert.equal(request.options.redirect,'error');assert.ok(request.options.signal);assert.equal(request.url,'https://model.example/v1/chat/completions');const body=JSON.parse(request.options.body);assert.equal(body.model,env.LLM_MODEL);assert.ok(body.messages[1].content.includes('empty'));assert.ok(!body.messages[1].content.includes('fake-llm-secret'));assert.ok(body.messages[1].content.includes('4.1.12'));assert.equal(body.max_tokens,2048);assert.ok(patch.evidence.referenceSha256);
});
for(const [label,content] of [['wrong JSON','no json'],['wrong shape','{"source":123}'],['extra fields',JSON.stringify({source:proposePatch(BASE_SOURCE).after,command:'curl evil'})],['injected source',JSON.stringify({source:proposePatch(BASE_SOURCE).after+'process.exit(0);'})],['unchanged source',JSON.stringify({source:BASE_SOURCE})]])test(`AI rejects ${label} without local fallback`,async()=>assert.rejects(generate(async()=>response(content))));
for(const status of [401,429,500])test(`AI HTTP ${status} is sanitized and not retried`,async()=>{let count=0;await assert.rejects(generate(async()=>{count++;return new Response('fake-llm-secret unknown-remote-secret',{status});}),e=>e.code==='PROVIDER_ERROR'&&!e.message.includes('secret'));assert.equal(count,1);});
test('AI overlong transport output is refused',async()=>assert.rejects(generate(async()=>new Response('x'.repeat(65537))),{code:'PROVIDER_ERROR'}));
test('AI transport exceptions never expose credentials',async()=>assert.rejects(generate(async()=>{throw Error('fake-llm-secret unknown-secret');}),e=>!JSON.stringify({message:e.message,evidence:e.evidence}).includes('secret')));
test('AI timeout aborts and terminates a nonresponsive injected transport',async()=>assert.rejects(generate(()=>new Promise(()=>{}),{...cfg(),llmTimeoutMs:10}),{code:'PROVIDER_ERROR'}));
test('AI request includes the application requirement and evidence names the model',async()=>{
 let body;const patch=await generate(async(url,options)=>{body=JSON.parse(JSON.parse(options.body).messages[1].content);return response(JSON.stringify({source:proposePatch(BASE_SOURCE).after}));});
 assert.match(body.requirement,/boolean/);assert.equal(patch.evidence.model,env.LLM_MODEL);
});
test('runtime snapshots cover adapter source as well as evaluator',async()=>{
 const result=await runVerification();assert.ok(result.evidence.immutableBefore['lib/adapters.mjs']);assert.equal(result.evidence.immutableBefore['lib/adapters.mjs'],result.evidence.immutableAfter['lib/adapters.mjs']);
});
test('integration uses generated AI patch after real failure observations with honest double verdict',async()=>{
 let observed;const result=await runVerification({adapterConfig:cfg(),fetchImpl:async(url,options)=>{observed=JSON.parse(JSON.parse(options.body).messages[1].content);return response(JSON.stringify({source:proposePatch(BASE_SOURCE).after}));}});
 assert.equal(result.verdict,'TEST_DOUBLE_VERIFIED');assert.equal(result.provider,'openai-compatible');assert.equal(result.environment,'local');assert.equal(result.sponsorUsed,false);assert.ok(observed.observations.some(x=>x.actual.accept===false));assert.equal(result.phases.length,3);assert.equal(result.evidence.transportTestDouble,true);assert.ok(!JSON.stringify(result).includes(env.LLM_API_KEY));
});
test('failed AI preserves early real phases and never returns canned patch',async()=>{
 await assert.rejects(runVerification({adapterConfig:cfg(),fetchImpl:async()=>response('bad')}),e=>e.evidence.phases.length===2&&e.evidence.commands.length>=2&&e.code==='PROVIDER_ERROR');
});
const dc=()=>adapters.readAdapterConfig({EXECUTION_PROVIDER:'daytona',ALLOW_EXTERNAL_CALLS:'1',DAYTONA_API_KEY:'fake-daytona-secret'});
function double(mode='success'){
 const log=[],uploads=new Map();let n=0,deleted=false;
 const sandbox={id:'double-id',async getUserHomeDir(){return '/home/isolated-user';},fs:{async uploadFile(buf,path,timeout){log.push(['upload',path,timeout]);if(mode==='upload')throw Error('fake-daytona-secret');uploads.set(path,buf.toString());}},process:{async executeCommand(cmd,cwd,vars,timeout){log.push(['command',cmd,cwd,vars,timeout]);if(mode==='install'&&cmd.startsWith('npm ci'))return {exitCode:1,result:'install failed'};if(['run','run-and-cleanup'].includes(mode)&&cmd.startsWith('node remote'))return {exitCode:2,result:'worker failed'};if(cmd.startsWith('node remote')){if(mode==='json')return {exitCode:0,result:'invalid'};if(mode==='large')return {exitCode:0,result:'x'.repeat(1048577)};const input=JSON.parse([...uploads.entries()].find(([p])=>p.endsWith('/input.json'))[1]);const {oracle}=await loadOracle();return {exitCode:0,result:JSON.stringify({node:'v22.18.0',npm:'10.9.3',version:oracle.versions[input.phase],packages:{zod3:'3.25.76',zod4:'4.1.12'},lockSha256:adapters.hashText([...uploads.entries()].find(([p])=>p.endsWith('/package-lock.json'))[1]),rows:oracle.cases.map(c=>({id:c.id,accept:c.expected[input.phase].accept,data:c.expected[input.phase].data,issues:[]}))})};}return {exitCode:0,result:''};}}};
 return {log,uploads,get creates(){return n;},client:{async create(params,options){n++;deleted=false;log.push(['create',params,options]);if(mode==='create')throw Error('fake-daytona-secret');return {...sandbox,id:`double-id-${n}`};},async delete(s,timeout,wait){log.push(['delete',s.id,timeout,wait]);if(['cleanup','run-and-cleanup'].includes(mode))throw Error('cleanup secret');deleted=true;},async get(id){log.push(['get',id]);if(mode==='readback')return sandbox;if(deleted)throw Object.assign(Error('not found'),{status:404});return sandbox;}}};
}
test('remote minimal bundle pins only two exact integrity checked dependencies',async()=>{
 const b=await adapters.buildRemoteBundle();const lock=JSON.parse(b.files['package-lock.json']);assert.deepEqual(Object.keys(lock.packages).sort(),['','node_modules/zod3','node_modules/zod4']);assert.equal(lock.packages['node_modules/zod4'].version,'4.1.12');assert.ok(lock.packages['node_modules/zod3'].integrity.startsWith('sha512-'));assert.ok(!JSON.stringify(b).includes('DAYTONA_API_KEY'));assert.ok(!JSON.stringify(b).includes('expected'));
});
test('remote lock validation rejects wrong version integrity URL or missing entry before client creation',async()=>{
 const b=await adapters.buildRemoteBundle();const lock=JSON.parse(b.files['package-lock.json']);
 for(const change of [l=>delete l.packages['node_modules/zod4'],l=>l.packages['node_modules/zod3'].version='3.0.0',l=>l.packages['node_modules/zod4'].integrity='bad',l=>l.packages['node_modules/zod4'].resolved='https://evil.example/zod.tgz']){const l=structuredClone(lock);change(l);await assert.rejects(adapters.buildRemoteBundle({lock:l}),{code:'INFRA_ERROR'});}
});
test('Daytona fresh sandbox phases upload no oracle and verify deletion by exact id',async()=>{
 const d=double();const result=await runVerification({adapterConfig:dc(),daytonaClient:d.client});assert.equal(result.verdict,'TEST_DOUBLE_VERIFIED');assert.equal(result.environment,'daytona');assert.equal(result.sponsorUsed,false);assert.equal(d.creates,3);assert.equal(result.evidence.sandboxes.length,3);assert.equal(result.evidence.sandboxes[0].runtime.node,'v22.18.0');assert.ok(result.evidence.sandboxes.every(s=>s.cleanup.verified));for(const [path,text]of d.uploads){assert.ok(!path.includes('contracts'));assert.ok(!text.includes('fake-daytona-secret'));if(path.endsWith('/input.json'))assert.ok(!text.includes('expected'));}assert.equal(d.log.filter(x=>x[0]==='delete').length,3);assert.equal(d.log.filter(x=>x[0]==='get').length,3);const params=d.log.find(x=>x[0]==='create')[1];assert.equal(params.autoDeleteInterval,0);assert.equal(params.networkBlockAll,false);assert.equal(params.domainAllowList,'registry.npmjs.org');assert.ok(params.ttlMinutes>0);
});
for(const mode of ['create','upload','install','run','json','large','cleanup','readback'])test(`Daytona ${mode} failure is honest and cleans up where id known`,async()=>{
 const d=double(mode);await assert.rejects(runVerification({adapterConfig:dc(),daytonaClient:d.client}),e=>{assert.equal(e.code,'INFRA_ERROR');assert.ok(!JSON.stringify({message:e.message,evidence:e.evidence}).includes('fake-daytona-secret'));if(mode!=='create')assert.equal(d.log.filter(x=>x[0]==='delete').length,1);if(['cleanup','readback'].includes(mode))assert.equal(e.evidence.sandboxes[0].cleanup.pending,true);return true;});
});
test('disabled Daytona config prevents injected SDK invocation',async()=>{
 const d=double();await assert.rejects(runVerification({adapterConfig:adapters.readAdapterConfig({EXECUTION_PROVIDER:'daytona'}),daytonaClient:d.client}),{code:'CONFIG_ERROR'});assert.equal(d.creates,0);
});
test('Daytona resolves the sandbox home instead of assuming a username',async()=>{
 const d=double();await runVerification({adapterConfig:dc(),daytonaClient:d.client});assert.ok([...d.uploads.keys()].every(p=>p.startsWith('/home/isolated-user/upgrade-lab/')));
});
test('Daytona preserves execution failure separately from cleanup failure',async()=>{
 const d=double('run-and-cleanup');await assert.rejects(runVerification({adapterConfig:dc(),daytonaClient:d.client}),e=>{const r=e.evidence.sandboxes[0];assert.ok(r.executionError);assert.ok(r.cleanup.error);assert.equal(r.cleanup.pending,true);return true;});
});
