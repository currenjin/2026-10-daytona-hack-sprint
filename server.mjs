import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {CONFIG, ROOT, runVerification} from './lib/runner.mjs';
import {readAdapterConfig,publicAdapterConfig} from './lib/adapters.mjs';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function httpError(status,code,message) {return Object.assign(new Error(message),{status,code});}
function send(res,status,body,type='application/json; charset=utf-8',headers={}) {
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':CSP,...headers});
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function readJSON(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw httpError(415,'UNSUPPORTED_MEDIA_TYPE','Use application/json');
  if (Number(req.headers['content-length']) > 1024) {req.resume();throw httpError(413,'BODY_TOO_LARGE','Request body exceeds 1024 bytes');}
  return new Promise((resolvePromise,reject) => {
    const chunks=[];let bytes=0;let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',onError);req.removeListener('aborted',aborted);if(error){req.resume();reject(error);}else resolvePromise(value);};
    const data=chunk=>{bytes+=chunk.length;if(bytes>1024)finish(httpError(413,'BODY_TOO_LARGE','Request body exceeds 1024 bytes'));else chunks.push(chunk);};
    const end=()=>{try {finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {finish(httpError(400,'INVALID_JSON','Malformed JSON body'));}};
    const onError=()=>finish(httpError(400,'INVALID_REQUEST','Request body could not be read'));
    const aborted=()=>finish(httpError(400,'INVALID_REQUEST','Request aborted'));
    const timer=setTimeout(()=>finish(httpError(408,'REQUEST_TIMEOUT','Request body timed out')),5000);
    req.on('data',data);req.on('end',end);req.on('error',onError);req.on('aborted',aborted);
  });
}
export function createApp({staticDir=resolve(ROOT,'public'),runner=runVerification,maxConcurrent=2,maxRuns=64,ttlMs=30*60*1000,adapterConfig=readAdapterConfig({})}={}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(maxRuns) || maxRuns < maxConcurrent || ttlMs < 1) throw new TypeError('Invalid bounded run limits');
  const runs=new Map();let active=0;
  const prune=()=>{for(const [id,run] of runs)if(run.status !== 'running' && Date.now()-run.finishedAt > ttlMs)runs.delete(id);};
  const runPublic=run=>({id:run.id,status:run.status,stage:run.stage,events:run.events,result:run.result,error:run.error});
  return async (req,res) => {
    try {
      const port=req.socket.localPort;
      const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
      if (!allowedHosts.has(req.headers.host)) throw httpError(421,'INVALID_HOST','Only this loopback server host is accepted');
      const rawPath=(req.url ?? '').split('?')[0];
      if(!rawPath.startsWith('/') || rawPath.startsWith('//'))throw httpError(400,'INVALID_PATH','Invalid request path');
      let path;try {path=decodeURIComponent(rawPath);}catch {throw httpError(400,'INVALID_PATH','Invalid path encoding');}
      if(path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.'))throw httpError(400,'INVALID_PATH','Path traversal is not allowed');
      prune();
      if(req.method === 'GET' && path === '/health')return send(res,200,{ok:true});
      if(req.method === 'GET' && path === '/api/config')return send(res,200,{...CONFIG,...publicAdapterConfig(adapterConfig)});
      if(path === '/api/runs' && req.method === 'POST') {
        if(req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`)throw httpError(403,'INVALID_ORIGIN','Mutation origin must match this server');
        if(req.headers['sec-fetch-site'] === 'cross-site')throw httpError(403,'INVALID_ORIGIN','Cross-site mutations are not accepted');
        const body=await readJSON(req);
        if(body === null || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 1 || !Object.hasOwn(body,'fixtureId') || typeof body.fixtureId !== 'string')throw httpError(400,'INVALID_REQUEST','Only {fixtureId} is accepted');
        if(body.fixtureId !== CONFIG.fixtureId)throw httpError(400,'UNKNOWN_FIXTURE','Only the supported zod-settings synthetic fixture is available');
        if(!adapterConfig.readiness.ready)throw httpError(503,'CONFIG_ERROR','Adapter configuration not ready; inspect readiness');
        if(active >= maxConcurrent)throw httpError(429,'RUN_CAPACITY','Concurrent run limit reached');
        if(runs.size >= maxRuns) {
          const completed=[...runs.values()].find(run=>run.status !== 'running');
          if(completed)runs.delete(completed.id);else throw httpError(429,'RUN_CAPACITY','Stored run limit reached');
        }
        const id=randomUUID();const run={id,status:'running',stage:'baseline',events:[],result:null,error:null,evidence:null};
        runs.set(id,run);active++;
        send(res,202,{id});
        setImmediate(async()=>{
          try {
            run.result=await runner({adapterConfig,onEvent:event=>{run.stage=event.stage;run.events.push({...event,timestamp:new Date().toISOString()});}});
            run.evidence=run.result.evidence;run.status='completed';run.stage='completed';
          }catch(error){run.status='failed';run.error={code:error.code ?? 'INFRA_ERROR',message:error.message};run.evidence=error.evidence ?? {provider:'local-rule',environment:'local',sponsorUsed:false,error:run.error};run.events.push({stage:run.stage,message:`Execution stopped: ${run.error.code}`,timestamp:new Date().toISOString()});}
          finally{run.finishedAt=Date.now();active--;}
        });
        return;
      }
      if(path.startsWith('/api/runs/')) {
        if(req.method !== 'GET')throw httpError(405,'METHOD_NOT_ALLOWED','Use GET for run status and artifacts');
        const pieces=path.slice('/api/runs/'.length).split('/');
        const [id,artifact]=pieces;
        if(!ID.test(id))throw httpError(400,'INVALID_RUN_ID','Run identifier must be a canonical UUID v4');
        if(pieces.length > 2 || (artifact && !['patch','evidence'].includes(artifact)))throw httpError(404,'NOT_FOUND','Unknown run route');
        const run=runs.get(id);if(!run)throw httpError(404,'RUN_NOT_FOUND','Run was not found or has expired');
        if(!artifact)return send(res,200,runPublic(run));
        if(run.status === 'running')throw httpError(409,'RUN_NOT_READY','Run artifact is not ready');
        if(artifact === 'evidence')return send(res,200,run.evidence,'application/json; charset=utf-8',{'content-disposition':`attachment; filename="${id}-evidence.json"`});
        if(!run.result || !['LOCAL_VERIFIED','PROVIDER_VERIFIED'].includes(run.result.verdict) || run.result.evidence?.transportTestDouble === true)throw httpError(409,'PATCH_UNAVAILABLE','Run has no genuine verified patch artifact');
        return send(res,200,run.result.patch,'text/plain; charset=utf-8',{'content-disposition':`attachment; filename="${id}.patch"`});
      }
      if(path.startsWith('/api/') || path === '/health')throw httpError(req.method === 'GET' ? 404 : 405,'NOT_FOUND','Unknown API route or method');
      if(!['GET','HEAD'].includes(req.method))throw httpError(405,'METHOD_NOT_ALLOWED','Use GET or HEAD for static files');
      if(path.split('/').some(part=>part.startsWith('.')))throw httpError(403,'STATIC_FORBIDDEN','Hidden files are not served');
      const root=await realpath(staticDir);
      const target=await realpath(resolve(root,'.'+(path === '/' ? '/index.html' : path)));
      if(target !== root && !target.startsWith(root+sep))throw httpError(403,'STATIC_FORBIDDEN','Static path is outside public root');
      const info=await stat(target);if(!info.isFile())throw httpError(404,'NOT_FOUND','Static file not found');
      if(info.size > 4*1024*1024)throw httpError(413,'STATIC_TOO_LARGE','Static asset exceeds size limit');
      const type=mime[extname(target)];if(!type)throw httpError(403,'STATIC_FORBIDDEN','Unsupported static file type');
      return send(res,200,req.method === 'HEAD' ? '' : await readFile(target),type);
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const status=error.status ?? (['ENOENT','ENOTDIR'].includes(error.code) ? 404 : 500);
      send(res,status,{error:{code:error.status ? error.code : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',message:error.status ? error.message : status === 404 ? 'Resource not found' : 'Internal server error'}});
    }
  };
}
export async function startServer({port=Number(process.env.PORT ?? 4318),host='127.0.0.1',...options}={}) {
  if(!['127.0.0.1','::1','localhost'].includes(host))throw new TypeError('Only a loopback bind is supported');
  if(!Number.isInteger(port) || port < 0 || port > 65535)throw new TypeError('Invalid port');
  const server=createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:8192},createApp(options));
  server.maxConnections=64;server.keepAliveTimeout=5000;
  await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolvePromise();});});
  return server;
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({adapterConfig:readAdapterConfig(process.env)}).then(server=>{console.log(`Local package upgrade lab: http://127.0.0.1:${server.address().port}`);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections();});}).catch(()=>{console.error('Local server could not start');process.exitCode=1;});
}
