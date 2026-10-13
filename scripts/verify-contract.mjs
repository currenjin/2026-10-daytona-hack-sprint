import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ROOT,runVerification} from '../lib/runner.mjs';
async function save(path,evidence) {
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.${randomUUID()}.tmp`;
  try {await writeFile(temporary,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);}finally {await rm(temporary,{force:true});}
}
export async function verify({outputPath=resolve(ROOT,'.runs/verify-evidence.json'),nodePath=process.execPath}={}) {
  try {
    const result=await runVerification({nodePath});
    await save(outputPath,result.evidence);
    return result;
  }catch(error){if(error.evidence)await save(outputPath,error.evidence);throw error;}
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length && !(args.length === 2 && args[0] === '--output' && args[1])) {console.error('Usage: npm run verify -- [--output path]');process.exitCode=2;}
  else {
    const outputPath=args.length ? resolve(ROOT,args[1]) : resolve(ROOT,'.runs/verify-evidence.json');
    verify({outputPath}).then(result=>console.log(JSON.stringify({verdict:result.verdict,provider:result.provider,environment:result.environment,sponsorUsed:result.sponsorUsed,phases:result.phases.map(({name,matched,total})=>({name,matched,total})),regressions:result.regressions,evidencePath:outputPath},null,2))).catch(error=>{console.error(JSON.stringify({error:{code:error.code ?? 'INFRA_ERROR',message:error.message},evidencePath:error.evidence ? outputPath : null}));process.exitCode=1;});
  }
}
