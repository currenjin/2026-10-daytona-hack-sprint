import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BASE_SOURCE,ROOT,validatePatch,proposePatch,failure} from './runner.mjs';
export const hashText = text => createHash('sha256').update(text).digest('hex');
// Pinned, reviewed migration excerpt; runtime never fetches documentation.
const REFERENCE='Zod 4 enum-key z.record requires all enum keys. z.partialRecord restores optional enum keys and still validates values and rejects unknown keys.';
function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
export function readAdapterConfig(env={}) {
 const provider=env.PATCH_PROVIDER||'local-rule',environment=env.EXECUTION_PROVIDER||'local',externalCallsAllowed=env.ALLOW_EXTERNAL_CALLS==='1';
 const c={provider,environment,externalCallsAllowed,llmBaseUrl:env.LLM_BASE_URL||'',llmModel:env.LLM_MODEL||'',llmApiKey:env.LLM_API_KEY||'',daytonaApiKey:env.DAYTONA_API_KEY||'',daytonaApiUrl:env.DAYTONA_API_URL||'https://app.daytona.io/api',daytonaTarget:env.DAYTONA_TARGET||'us',llmTimeoutMs:15000};
 const issues=[];
 if(!['local-rule','openai-compatible'].includes(provider))issues.push('Unsupported patch provider');
 if(!['local','daytona'].includes(environment))issues.push('Unsupported execution provider');
 if((provider==='openai-compatible'||environment==='daytona')&&!externalCallsAllowed)issues.push('External calls require explicit ALLOW_EXTERNAL_CALLS=1');
 if(provider==='openai-compatible'){if(!safeURL(c.llmBaseUrl))issues.push('LLM_BASE_URL requires a clean HTTPS endpoint');if(!c.llmModel)issues.push('LLM_MODEL is required');if(!c.llmApiKey)issues.push('LLM_API_KEY is required');}
 if(environment==='daytona'){if(!c.daytonaApiKey)issues.push('DAYTONA_API_KEY is required');if(!safeURL(c.daytonaApiUrl))issues.push('DAYTONA_API_URL requires a clean HTTPS endpoint');if(!/^[a-z0-9-]{1,32}$/.test(c.daytonaTarget))issues.push('Invalid DAYTONA_TARGET');}
 c.readiness={ready:issues.length===0,issues,externalCallsAllowed};return c;
}
export function publicAdapterConfig(c){return {provider:c.provider,environment:c.environment,readiness:c.readiness};}
export function assertReady(c){if(!c?.readiness?.ready)throw failure('CONFIG_ERROR','Adapter configuration is not ready; inspect /api/config readiness');}
async function boundedResponse(response,maxBytes){
 if(!response.body)throw failure('PROVIDER_ERROR','Provider response is empty');
 const reader=response.body.getReader();let bytes=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw failure('PROVIDER_ERROR','Provider response exceeds limit');chunks.push(Buffer.from(value));}return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function generateAIPatch({before,observations,config,fetchImpl}){
 assertReady(config);if(config.provider!=='openai-compatible')throw failure('CONFIG_ERROR','AI provider is not selected');
 if(before!==BASE_SOURCE)throw failure('PATCH_REJECTED','Unsupported source');
 const requirement=JSON.parse(await readFile(ROOT+'/contracts/demo-oracle-v1.json','utf8')).requirement;
 const controller=new AbortController();let timer;
 const transport=fetchImpl||globalThis.fetch;
 const work=async()=>{
  const response=await transport(config.llmBaseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json',authorization:`Bearer ${config.llmApiKey}`},body:JSON.stringify({model:config.llmModel,temperature:0,max_tokens:2048,messages:[{role:'system',content:'Return only JSON with a single source string. Repair only the synthetic schema using the provided migration reference. Never modify tests, expected values, commands or dependencies.'},{role:'user',content:JSON.stringify({before,observations,requirement,baselineVersion:'3.25.76',targetVersion:'4.1.12',reference:REFERENCE})}]})});
  if(!response.ok){await response.body?.cancel();throw failure('PROVIDER_ERROR',`Model HTTP ${response.status}`);}
  let parsed,content;try{parsed=JSON.parse(await boundedResponse(response,65536));content=JSON.parse(parsed.choices[0].message.content);}catch{throw failure('PROVIDER_ERROR','Model returned invalid or oversized JSON');}
  if(!content||Object.keys(content).length!==1||typeof content.source!=='string')throw failure('PROVIDER_ERROR','Model response must contain only source');
  validatePatch(before,content.source);
  const usage={};for(const k of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(parsed.usage?.[k])&&parsed.usage[k]>=0)usage[k]=parsed.usage[k];
  return {...proposePatch(before),after:content.source,provider:'openai-compatible',evidence:{model:config.llmModel,transportTestDouble:!!fetchImpl,usage,referenceSha256:hashText(REFERENCE),reference:'https://zod.dev/v4/changelog#improves-enum-support'}};
 };
 try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('PROVIDER_ERROR','Model request timed out'));},config.llmTimeoutMs);})]);}catch(e){if(['PROVIDER_ERROR','PATCH_REJECTED'].includes(e.code))throw e;throw failure('PROVIDER_ERROR','Model transport failed');}finally{clearTimeout(timer);controller.abort();}
}
const REMOTE_WORKER=`import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const input=JSON.parse(await readFile('input.json','utf8'));
const alias=input.phase==='baseline'?'zod3':'zod4';
const {z}=await import(alias);
const {createSchema}=await import('data:text/javascript;base64,'+Buffer.from(input.source).toString('base64'));
const schema=createSchema(z);
const rows=input.cases.map(({id,input})=>{const r=schema.safeParse(input);return {id,accept:r.success,data:r.success?r.data:null,issues:r.success?[]:r.error.issues};});
const packages={};for(const a of ['zod3','zod4'])packages[a]=JSON.parse(await readFile('node_modules/'+a+'/package.json','utf8')).version;
console.log(JSON.stringify({node:process.version,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),version:packages[alias],packages,lockSha256:createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),rows}));
`;
export async function buildRemoteBundle({lock}={}){
 const original=lock||JSON.parse(await readFile(ROOT+'/package-lock.json','utf8'));
 const deps={zod3:'npm:zod@3.25.76',zod4:'npm:zod@4.1.12'};
 const packages={'':{name:'upgrade-lab-remote',version:'1.0.0',dependencies:deps}};
 const trusted=JSON.parse(await readFile(ROOT+'/package-lock.json','utf8'));
 for(const [alias,version] of [['zod3','3.25.76'],['zod4','4.1.12']]){
  const key='node_modules/'+alias,p=original.packages?.[key],anchor=trusted.packages?.[key];
  if(!p||p.version!==version||p.resolved!==`https://registry.npmjs.org/zod/-/zod-${version}.tgz`||!/^sha512-[A-Za-z0-9+/]+=*$/.test(p.integrity||'')||p.integrity!==anchor?.integrity)throw failure('INFRA_ERROR','Remote dependency lock does not match pinned integrity contract');
  packages[key]={name:'zod',version,resolved:p.resolved,integrity:p.integrity};
 }
 const files={'package.json':JSON.stringify({name:'upgrade-lab-remote',version:'1.0.0',private:true,type:'module',dependencies:deps}),'package-lock.json':JSON.stringify({name:'upgrade-lab-remote',version:'1.0.0',lockfileVersion:3,requires:true,packages}),'remote-worker.mjs':REMOTE_WORKER};
 return {files,lockSha256:hashText(files['package-lock.json'])};
}
export async function executeDaytonaPhase({config,phase,source,cases,daytonaClient}){
 assertReady(config);if(config.environment!=='daytona')throw failure('CONFIG_ERROR','Daytona not selected');
 if(phase==='patched')validatePatch(BASE_SOURCE,source);else if(source!==BASE_SOURCE)throw failure('PATCH_REJECTED','Unsupported source');
 const bundle=await buildRemoteBundle();let client=daytonaClient,sandbox,problem,observed;
 const record={phase,id:null,transportTestDouble:!!daytonaClient,commands:[],cleanup:{verified:false,pending:false}};
 try{
  if(!client){const {Daytona}=await import('@daytona/sdk');client=new Daytona({apiKey:config.daytonaApiKey,apiUrl:config.daytonaApiUrl,target:config.daytonaTarget,otelEnabled:false,requestTimeoutMs:30000});}
  record.createAttempted=true;
  sandbox=await client.create({language:'typescript',ephemeral:true,autoStopInterval:5,autoDeleteInterval:0,ttlMinutes:10,networkBlockAll:false,domainAllowList:'registry.npmjs.org',envVars:{NODE_ENV:'production'},labels:{app:'package-upgrade-lab',phase}},{timeout:60});
  if(!sandbox||typeof sandbox.id!=='string'||!sandbox.id)throw Error('Missing sandbox id');record.id=sandbox.id;
  const home=await sandbox.getUserHomeDir();
  if(typeof home!=='string'||!/^\/(?:home\/[A-Za-z0-9_.-]+|root)$/.test(home))throw Error('Unsupported sandbox home');
  const cwd=home+'/upgrade-lab';
  const command=async(cmd,timeout)=>{const r=await sandbox.process.executeCommand(cmd,cmd.startsWith('mkdir')?undefined:cwd,{},timeout);record.commands.push({command:cmd,exitCode:r.exitCode});if(r.exitCode!==0||typeof r.result!=='string'||Buffer.byteLength(r.result)>1048576)throw Error('Remote command failed or exceeded bound');return r.result;};
  await command('mkdir -p '+cwd,15);
  const files={...bundle.files,'input.json':JSON.stringify({phase,source,cases:cases.map(c=>({id:c.id,input:c.input}))})};
  for(const [name,bytes] of Object.entries(files))await sandbox.fs.uploadFile(Buffer.from(bytes),cwd+'/'+name,30);
  await command('npm ci --ignore-scripts --no-audit --no-fund',60);
  observed=JSON.parse(await command('node remote-worker.mjs',30));
  if(observed.version!==(phase==='baseline'?'3.25.76':'4.1.12')||observed.packages?.zod3!=='3.25.76'||observed.packages?.zod4!=='4.1.12'||observed.lockSha256!==bundle.lockSha256||!/^v\d+\./.test(observed.node||'')||typeof observed.npm!=='string')throw Error('Remote runtime or lock mismatch');
  record.runtime={node:observed.node,npm:observed.npm,packages:observed.packages,lockSha256:observed.lockSha256};
 }catch{problem=failure('INFRA_ERROR','Daytona phase failed; remote error text omitted');record.executionError={code:problem.code,message:problem.message};if(record.createAttempted&&!record.id)record.cleanup={verified:false,pending:true,reason:'Create failed before id was known; remote resource absence unverified; requested TTL 10 minutes'};}
 finally{
  if(record.id){record.cleanup.pending=true;try{await client.delete(sandbox,30,true);try{await client.get(record.id);throw Error('Resource still present');}catch(e){if((e.status??e.statusCode??e.response?.status)===404){record.cleanup={verified:true,pending:false};}else throw e;}}catch{record.cleanup.error={code:'INFRA_ERROR',message:'Daytona cleanup could not be verified; exact sandbox id retained'};problem=problem??failure('INFRA_ERROR',record.cleanup.error.message);}}
 }
 if(problem)throw failure('INFRA_ERROR',problem.message,{sandboxes:[record]});
 return {observed,record};
}
